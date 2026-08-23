import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { sharpenClaim } from "@/services/claimSharpener";

// One Gemini call on a short prompt; the global throttle in lib/gemini smooths
// load across users.
export const maxDuration = 30;

const requestSchema = z.object({
  claim: z.string().trim().min(1).max(600),
  evidenceType: z.string().trim().max(60).optional(),
});

/**
 * Sharpen a claim before it is searched.
 *
 * No quota bucket and no usage record yet, deliberately. This is one short
 * prompt on the cheap model — an order of magnitude below a search or a cut —
 * and charging it would make sharpening a claim cost the debater the search
 * they were about to run. `guardApi` with `requireAuth` is the bound: it gates
 * the session and rate-limits per IP. When the metering work lands, give this
 * a proper bucket and wrap the call in `withUsage`.
 */
export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  const blocked = await guardApi(req, { name: "sharpen", requireAuth: true });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Type the claim you need evidence for." }, { status: 400 });
  }

  try {
    const result = await sharpenClaim(parsed.data.claim, parsed.data.evidenceType);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json(
        { error: "The AI is busy right now — search what you typed, or try again in a moment." },
        { status: 429 },
      );
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: "The AI isn't configured." }, { status: 503 });
    }
    console.error("sharpen: unexpected failure", err);
    return NextResponse.json({ error: "Couldn't sharpen that claim." }, { status: 500 });
  }
}
