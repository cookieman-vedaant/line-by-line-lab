import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";

/**
 * Server-side half of Vercel BotID (basic mode — free). Returns a 403 response
 * when the caller is a detected automated bot, else null (proceed). Pair every
 * call with the matching path in instrumentation-client.ts.
 *
 * FAIL-OPEN by design: if BotID isn't configured on the project or the check
 * errors, we log and allow the request through — a misconfigured bot check must
 * never lock real debaters out. The per-IP rate limit + global capacity breaker
 * (lib/apiGuard) remain the always-on backstop underneath.
 *
 * No-op in local dev (checkBotId returns isBot:false), so local testing is
 * unaffected; it only bites automated traffic once deployed to Vercel.
 */
export async function botBlock(): Promise<NextResponse | null> {
  try {
    const verification = await checkBotId();
    if (verification.isBot) {
      return NextResponse.json(
        {
          error:
            "This request was flagged as automated. If you're a person, reload the page and try again.",
        },
        { status: 403 },
      );
    }
  } catch (err) {
    console.warn("botid check failed; allowing request (rate limit still applies)", String(err));
  }
  return null;
}
