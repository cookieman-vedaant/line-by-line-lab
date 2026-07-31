import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { requireUser } from "@/lib/supabase/user";
import { SKILL_TIERS, type DebaterProfile } from "@/types";

/**
 * The debater's saved AI profile (the "read on your game" from the Record tab),
 * stored per-account in Supabase (`debater_profile`, one row per user). This is
 * what makes the AI analysis follow the user across devices — same isolation as
 * rounds (RLS scopes it to `auth.uid()`).
 *
 *   GET → { stored | null }   my saved profile
 *   PUT → { stored }          upsert my profile (one row; replaces on re-analyze)
 *   DELETE                    clear my profile
 *
 * Distinct from `/api/profile`, which is the STATELESS analyzer that turns rounds
 * into a fresh profile via Gemini. This route only persists the result.
 */

const profileSchema = z.object({
  skillTier: z.enum(SKILL_TIERS),
  summary: z.string().max(2000),
  strengths: z.array(z.string().max(400)).max(30),
  weaknesses: z.array(z.string().max(400)).max(30),
  focusAreas: z.array(z.string().max(400)).max(30),
});
const putSchema = z.object({ profile: profileSchema, signature: z.string().max(200) });

interface ProfileRow {
  profile: DebaterProfile;
  signature: string | null;
  generated_at: string;
}

function toStored(row: ProfileRow) {
  return { profile: row.profile, signature: row.signature ?? "", generatedAt: row.generated_at };
}

const GUARD = { name: "debater-profile", requireHuman: false, countGlobal: false, perMinute: 60 } as const;

export async function GET(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("debater_profile")
    .select("profile,signature,generated_at")
    .maybeSingle();
  if (error) {
    console.error("debater-profile GET failed", error);
    return NextResponse.json({ error: "Couldn't load your profile." }, { status: 500 });
  }
  return NextResponse.json({ stored: data ? toStored(data as unknown as ProfileRow) : null });
}

export async function PUT(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile payload." }, { status: 400 });
  }

  const row = {
    user_id: auth.user.id,
    profile: parsed.data.profile,
    signature: parsed.data.signature,
    generated_at: new Date().toISOString(),
  };
  const { data, error } = await auth.supabase
    .from("debater_profile")
    .upsert(row, { onConflict: "user_id" })
    .select("profile,signature,generated_at")
    .single();
  if (error) {
    console.error("debater-profile PUT failed", error);
    return NextResponse.json({ error: "Couldn't save your profile." }, { status: 500 });
  }
  return NextResponse.json({ stored: toStored(data as unknown as ProfileRow) });
}

export async function DELETE(req: Request) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { error } = await auth.supabase
    .from("debater_profile")
    .delete()
    .eq("user_id", auth.user.id);
  if (error) {
    console.error("debater-profile DELETE failed", error);
    return NextResponse.json({ error: "Couldn't clear your profile." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
