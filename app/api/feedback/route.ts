import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, guardApi } from "@/lib/apiGuard";
import { audit } from "@/lib/audit";
import { emailEnabled, sendEmail } from "@/lib/email";
import { SITE } from "@/lib/siteContent";
import { requireUser } from "@/lib/supabase/user";

/**
 * In-app bug reports and feature requests.
 *
 * Replaces a `mailto:` link that did nothing at all for users without an
 * OS-registered mail client (the default on Windows 11) — the click was a
 * silent no-op with no error to explain it.
 *
 * Not an AI route: `countGlobal:false` keeps it out of the AI budget, and
 * `requireHuman:false` avoids demanding a Turnstile solve to report that
 * something is broken. Auth plus a tight rate limit is the gate.
 */

export const maxDuration = 10;

const schema = z.object({
  kind: z.enum(["bug", "idea", "other"]),
  message: z.string().trim().min(5).max(4000),
  page: z.string().trim().max(200).optional(),
  // Optional: only if they want a reply.
  contactEmail: z.string().trim().email().max(320).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  const blocked = await guardApi(req, {
    name: "feedback",
    requireHuman: false,
    countGlobal: false,
    requireAuth: true,
    // Generous enough for someone reporting several bugs in one session, tight
    // enough that the table can't be used as free storage.
    perMinute: 5,
    perDay: 40,
  });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Tell us a little more — at least a sentence about what happened." },
      { status: 400 },
    );
  }

  const { kind, message, page, contactEmail } = parsed.data;

  // Insert through the USER's RLS client, not the admin client: the row is
  // written as them, and the `with check ((select auth.uid()) = user_id)` policy
  // is what proves it. user_id comes from the verified session — never the body.
  const { error } = await auth.supabase.from("feedback").insert({
    user_id: auth.user.id,
    kind,
    message,
    page: page ?? null,
    contact_email: contactEmail || null,
    // Truncated: enough to reproduce a browser-specific bug, not a fingerprint.
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
  });

  if (error) {
    console.error("feedback insert failed", error);
    return NextResponse.json(
      { error: "Couldn't send that. Please try again in a moment." },
      { status: 500 },
    );
  }

  void audit({
    action: "feedback.submitted",
    userId: auth.user.id,
    ip: clientIp(req),
    detail: { kind },
  });

  /*
   * Notify the operator. AWAITED, not fire-and-forget: on serverless the
   * function can be frozen the moment the response is returned, which would
   * drop an un-awaited send silently — the exact "it says sent but nothing
   * arrives" failure this is meant to fix. sendEmail never throws and is
   * capped at 8s, so the worst case is a slightly slower submit.
   *
   * Delivery failure is NOT surfaced to the user: their report is already
   * committed to the database, so the submission genuinely did succeed.
   */
  const sent = await sendEmail({
    to: SITE.contactEmail,
    subject: `[${kind}] Line by Line Lab feedback`,
    text: [
      `Kind:    ${kind}`,
      `From:    ${auth.user.email ?? "(unknown)"} (${auth.user.id})`,
      `Reply to:${contactEmail || auth.user.email || "(none given)"}`,
      `Page:    ${page ?? "(not recorded)"}`,
      "",
      message,
    ].join("\n"),
    // Hitting Reply should reach the debater, not the noreply sender.
    replyTo: contactEmail || auth.user.email || undefined,
  });
  if (!sent && emailEnabled()) {
    console.warn("feedback: stored but email notification failed");
  }

  return NextResponse.json({ ok: true });
}
