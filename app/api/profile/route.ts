import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { ProfileError, generateProfile } from "@/services/debaterProfile";
import { ROUND_RESULTS, ROUND_SIDES } from "@/types";

// One Gemini call to synthesize the profile.
export const maxDuration = 30;

// The debater's rounds arrive from THEIR device (localStorage). This route is
// STATELESS: it analyzes what it's given and returns the result — it stores
// nothing server-side, so personal data never becomes shared. (See the
// data-isolation principle.)
const roundSchema = z.object({
  id: z.string().max(100),
  tournament: z.string().max(200),
  roundLabel: z.string().max(100),
  side: z.enum(ROUND_SIDES),
  result: z.enum(ROUND_RESULTS),
  opponent: z.string().max(200).optional(),
  report: z.string().max(4000),
  createdAt: z.string().max(40),
});

const requestSchema = z.object({ rounds: z.array(roundSchema).min(1).max(200) });

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  const blocked = await guardApi(req, { name: "profile" });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Log a round or two (with a note on why) before analyzing." },
      { status: 400 },
    );
  }

  try {
    const profile = await generateProfile(parsed.data.rounds);
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof ProfileError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("profile route failed", err);
    return NextResponse.json({ error: "Couldn't build your profile. Please try again." }, { status: 500 });
  }
}
