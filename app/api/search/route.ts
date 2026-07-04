import { NextResponse } from "next/server";
import { z } from "zod";
import { MissingApiKeyError } from "@/lib/claude";
import { NoSourcesFoundError, findArticles } from "@/services/articleFinder";
import { CARD_LENGTHS, EVIDENCE_TYPES, PUBLICATION_AGES, SOURCE_TYPES } from "@/types";

// Search can take a while (Claude + real web searches); don't let the platform cut it off early.
export const maxDuration = 60;

const searchRequestSchema = z.object({
  evidenceType: z.enum(EVIDENCE_TYPES),
  claim: z.string().trim().min(3, "Claim is too short").max(500),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  publicationAge: z.enum(PUBLICATION_AGES).optional(),
  cardLength: z.enum(CARD_LENGTHS).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Evidence type and a claim are required." },
      { status: 400 },
    );
  }

  try {
    const articles = await findArticles(parsed.data);
    return NextResponse.json({ articles });
  } catch (err) {
    // An honest empty result, not a server failure.
    if (err instanceof NoSourcesFoundError) {
      return NextResponse.json({ articles: [], notice: err.message });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    // Everything else: user-safe message; developer detail stays server-side.
    console.error("search failed", err);
    return NextResponse.json(
      { error: "Something went wrong while searching. Please try again." },
      { status: 500 },
    );
  }
}
