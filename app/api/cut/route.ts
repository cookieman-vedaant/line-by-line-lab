import { NextResponse } from "next/server";
import { z } from "zod";
import { MissingApiKeyError } from "@/lib/claude";
import {
  ArticleUnreadableError,
  NoWarrantFoundError,
  cutCard,
} from "@/services/cardCutter";
import { CARD_LENGTHS } from "@/types";

// Reading a full article + cutting can take a while; don't cut it off early.
export const maxDuration = 120;

const cutRequestSchema = z.object({
  article: z.object({
    title: z.string().min(1),
    author: z.string().min(1),
    url: z.string().url().startsWith("http"),
    publication: z.string().min(1),
    date: z.string().min(1),
    explanation: z.string(),
    credibilityScore: z.number(),
  }),
  claim: z.string().trim().min(3).max(500),
  cardLength: z.enum(CARD_LENGTHS),
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
      { error: "An article, claim, and card length are required." },
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
