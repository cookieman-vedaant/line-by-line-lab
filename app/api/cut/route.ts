import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import {
  ArticleUnreadableError,
  NoWarrantFoundError,
  cutCard,
} from "@/services/cardCutter";
import { CARD_LENGTHS } from "@/types";

// Fetching an article + cutting can take a while; don't cut it off early.
export const maxDuration = 120;

const cutRequestSchema = z
  .object({
    source: z.object({
      // Any http(s) string — the fetch validates it functionally. (Avoids
      // Zod 4's strict/deprecated .url() rejecting unusual-but-valid links.)
      url: z.string().trim().startsWith("http").max(2000).optional(),
      text: z.string().max(300000).optional(),
      title: z.string().max(500).optional(),
      author: z.string().max(300).optional(),
      publication: z.string().max(300).optional(),
      date: z.string().max(50).optional(),
    }),
    claim: z.string().trim().min(3).max(1000),
    cardLength: z.enum(CARD_LENGTHS),
  })
  .refine((r) => Boolean(r.source.url) || Boolean(r.source.text?.trim()), {
    // At least one source. Search results send BOTH: a URL to fetch plus the
    // abstract as a fallback when that URL is paywalled/unreadable.
    message: "Provide an article URL or pasted article text.",
  });

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  // Cut can carry a large pasted article, so allow a bigger body than default.
  const blocked = await guardApi(req, { name: "cut", bodyLimitBytes: 1024 * 1024 });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = cutRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Report exactly what failed (which field), plus a hint for the common
    // cause: an out-of-date page still running old code.
    const detail = parsed.error.issues
      .map((i) => {
        const field = i.path.join(".").replace(/^source\./, "");
        return field ? `${field}: ${i.message}` : i.message;
      })
      .join("; ");
    return NextResponse.json(
      {
        error: `Request rejected — ${detail}. If you filled everything in, hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to load the latest version.`,
      },
      { status: 400 },
    );
  }

  try {
    const card = await cutCard(parsed.data);
    return NextResponse.json({ card });
  } catch (err) {
    // Honest, user-facing failures — surface the exact message.
    if (err instanceof ArticleUnreadableError || err instanceof NoWarrantFoundError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("cut failed", err);
    return NextResponse.json(
      { error: "Something went wrong while cutting the card. Please try again." },
      { status: 500 },
    );
  }
}
