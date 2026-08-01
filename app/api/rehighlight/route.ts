import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { ArticleUnreadableError, rehighlight } from "@/services/rehighlighter";

// Fetching an article + one AI call can take a while; don't cut it off early.
export const maxDuration = 120;

const rehighlightRequestSchema = z.object({
  source: z
    .object({
      card: z.string().max(100000).optional(),
      // Any http(s) string — the fetch validates it functionally.
      url: z.string().trim().startsWith("http").max(2000).optional(),
      text: z.string().max(300000).optional(),
      title: z.string().max(500).optional(),
      author: z.string().max(300).optional(),
      publication: z.string().max(300).optional(),
      date: z.string().max(50).optional(),
    })
    .refine((s) => Boolean(s.card?.trim() || s.url || s.text?.trim()), {
      message: "Provide the opponent's card, a source URL, or the article text.",
    }),
  opponentClaim: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  // A pasted card/article can be large — allow a bigger body than the default.
  const blocked = await guardApi(req, {
    name: "rehighlight",
    bodyLimitBytes: 1024 * 1024,
    requireAuth: true,
  });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = rehighlightRequestSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => {
        const field = i.path.join(".").replace(/^source\./, "");
        return field ? `${field}: ${i.message}` : i.message;
      })
      .join("; ");
    return NextResponse.json(
      {
        error: `Request rejected — ${detail}. If you filled everything in, hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R).`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await rehighlight(parsed.data);
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof ArticleUnreadableError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("rehighlight failed", err);
    return NextResponse.json(
      { error: "Something went wrong while re-highlighting. Please try again." },
      { status: 500 },
    );
  }
}
