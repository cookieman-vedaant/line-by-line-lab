import { NextResponse } from "next/server";
import { clientIp, guardApi } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { CUT_CARDS_MAX_PER_USER } from "@/lib/cutCardLimit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/user";

/**
 * Account deletion — "the right to delete", which the privacy policy already
 * promised users (TDPSA §541, plus COPPA/SCOPE-Act obligations for the minors
 * who make up most of this app's users) with no code behind it. A stated
 * retention right that can't actually be exercised is a compliance problem, not
 * just a missing feature.
 *
 *   DELETE /api/account  → erase my account and everything attached to it
 *
 * Deletion order matters. `auth.users` is deleted LAST, because every child
 * table's foreign key hangs off it:
 *   - rounds / debater_profile / profiles / cut_cards CASCADE away with the user.
 *   - feedback.user_id and audit_log.user_id are ON DELETE SET NULL, so bug
 *     reports and the security trail survive in anonymized form. That's
 *     deliberate: erasing the audit record of a deletion would defeat the point
 *     of having one, and a real bug report shouldn't vanish with its reporter.
 * We additionally null `feedback.contact_email` by hand, since SET NULL only
 * clears the FK column and that address is the one remaining piece of PII.
 */

export const maxDuration = 20;

/**
 * GET /api/account → download everything we hold about me, as JSON.
 *
 * The other half of the privacy policy's promises: it grants the right to
 * "obtain a portable copy of the data you provided" (TDPSA §541.051, and GDPR
 * Art. 20 for any EU user). Like deletion, that right was stated with nothing
 * behind it.
 *
 * Reads through the USER's RLS client and filters on their own id, so this
 * endpoint is structurally incapable of exporting somebody else's rows even if
 * a policy were misconfigured.
 */
export async function GET(req: Request) {
  const blocked = await guardApi(req, {
    name: "account-export",
    requireHuman: false,
    countGlobal: false,
    requireAuth: true,
    perMinute: 3,
    perDay: 20,
  });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  /*
   * Bounded even though this is an export. An unbounded select would build the
   * whole result in function memory, so a pathological account could OOM the
   * request. The caps are far above any realistic user (a debater logs hundreds
   * of rounds in a career, not tens of thousands) and truncation is DISCLOSED in
   * the payload — silently returning a partial export would undercut the
   * portability right this endpoint exists to satisfy.
   */
  const ROUND_CAP = 10_000;
  const FEEDBACK_CAP = 1_000;
  // Matches the library's own ceiling, so a full export is always the complete
  // library rather than a second, tighter limit nobody was told about. Bodies
  // average ~20KB, so this is ~10MB built in function memory — the reason it is
  // not simply unbounded like it could be for rounds.
  const CARD_CAP = CUT_CARDS_MAX_PER_USER;

  const [rounds, profile, feedback, cards] = await Promise.all([
    auth.supabase
      .from("rounds")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(ROUND_CAP),
    auth.supabase.from("debater_profile").select("*").eq("user_id", userId).maybeSingle(),
    auth.supabase
      .from("feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(FEEDBACK_CAP),
    auth.supabase
      .from("cut_cards")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CARD_CAP),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: {
      id: userId,
      email: auth.user.email ?? null,
      createdAt: auth.user.created_at ?? null,
    },
    rounds: rounds.data ?? [],
    debaterProfile: profile.data ?? null,
    feedback: feedback.data ?? [],
    cutCards: cards.data ?? [],
    ...((rounds.data?.length ?? 0) >= ROUND_CAP ||
    (feedback.data?.length ?? 0) >= FEEDBACK_CAP ||
    (cards.data?.length ?? 0) >= CARD_CAP
      ? {
          truncated:
            `This export was capped at ${ROUND_CAP} rounds, ${FEEDBACK_CAP} feedback entries ` +
            `and ${CARD_CAP} cut cards. Contact us to request the remainder.`,
        }
      : {}),
    // Named explicitly so the export is honest about its own boundaries rather
    // than implying this is everything that exists anywhere.
    notIncluded:
      "Server request logs (retained briefly by our host for security) and the " +
      "security audit trail, which is retained for abuse investigation and is " +
      "not personal content.",
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="line-by-line-lab-data-${userId.slice(0, 8)}.json"`,
      // Never let a CDN or browser cache one user's personal export.
      "Cache-Control": "no-store, private",
    },
  });
}

export async function DELETE(req: Request) {
  const blocked = await guardApi(req, {
    name: "account-delete",
    requireHuman: false,
    countGlobal: false,
    requireAuth: true,
    // Deliberately tight: nobody deletes their account five times a minute, and
    // a low ceiling limits damage if a session is ever hijacked.
    perMinute: 3,
    perDay: 10,
  });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const userId = auth.user.id;
  const ip = clientIp(req);

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (err) {
    // Without the service_role key we cannot delete an auth user at all. Say so
    // honestly rather than reporting a success we didn't perform.
    console.error("account delete: admin client unavailable", err);
    void audit({ action: "account.delete_failed", userId, ip, detail: { reason: "no_admin_client" } });
    return NextResponse.json(
      { error: "Account deletion isn't available right now. Please contact support." },
      { status: 503 },
    );
  }

  // Scrub the contact email before the user row goes — afterwards we'd have no
  // user_id left to find these rows by.
  const scrub = await admin
    .from("feedback")
    .update({ contact_email: null })
    .eq("user_id", userId);
  if (scrub.error) {
    // Non-fatal: proceed with deletion rather than stranding the account.
    console.warn("account delete: feedback scrub failed", scrub.error.message);
  }

  // Record BEFORE deleting: once the row is gone, `user_id` here is set to NULL
  // by the FK, and an audit entry written after the fact would lose the subject.
  await audit({ action: "account.deleted", userId, ip, detail: { self_service: true } });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("account delete failed", error);
    void audit({ action: "account.delete_failed", userId, ip, detail: { reason: error.message } });
    return NextResponse.json(
      { error: "Couldn't delete the account. Please contact support." },
      { status: 500 },
    );
  }

  // Drop the session cookies so the browser isn't left holding a token for a
  // user that no longer exists.
  await auth.supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
