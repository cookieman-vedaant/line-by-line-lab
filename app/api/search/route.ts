import { NextResponse } from "next/server";
import { z } from "zod";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { clientKeyFromRequest } from "@/lib/requestClient";
import { NoSourcesFoundError, findArticles } from "@/services/articleFinder";
import { CARD_LENGTHS, EVIDENCE_TYPES, PUBLICATION_AGES, SOURCE_TYPES } from "@/types";

// Search fans out to two databases + two AI calls; don't cut it off early.
export const maxDuration = 60;

const searchRequestSchema = z.object({
  evidenceType: z.enum(EVIDENCE_TYPES),
  claim: z.string().trim().min(3, "Claim is too short").max(1000),
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
    const detail = parsed.error.issues
      .map((i) => {
        const field = i.path.join(".");
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
    const articles = await findArticles(parsed.data, clientKeyFromRequest(req));
    return NextResponse.json({ articles });
  } catch (err) {
    // An honest empty result, not a server failure.
    if (err instanceof NoSourcesFoundError) {
      return NextResponse.json({ articles: [], notice: err.message });
    }
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
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
