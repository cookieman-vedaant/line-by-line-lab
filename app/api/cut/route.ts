import { NextResponse } from "next/server";
import { z } from "zod";
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
      url: z.string().url().startsWith("http").optional(),
      text: z.string().max(300000).optional(),
      title: z.string().max(500).optional(),
      author: z.string().max(300).optional(),
      publication: z.string().max(300).optional(),
      date: z.string().max(50).optional(),
    }),
    claim: z.string().trim().min(3).max(500),
    cardLength: z.enum(CARD_LENGTHS),
  })
  .refine((r) => Boolean(r.source.url) || Boolean(r.source.text?.trim()), {
    // At least one source. Search results send BOTH: a URL to fetch plus the
    // abstract as a fallback when that URL is paywalled/unreadable.
    message: "Provide an article URL or pasted article text.",
  });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = cutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A claim, a card length, and either an article URL or pasted text are required." },
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
