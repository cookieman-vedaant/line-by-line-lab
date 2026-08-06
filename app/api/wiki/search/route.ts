import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { requireUser } from "@/lib/supabase/user";
import { searchPrep } from "@/services/wikiMining";

/**
 * Search the indexed wiki for disclosed cards matching a claim.
 *
 * Thin: all logic is in `services/wikiMining.ts`, which queries our own
 * `wiki_cards` index (built by `services/wikiIngest.ts`). No opencaselist login,
 * no rate limit, no caselist to pick — one query over the whole indexed corpus.
 */

export const maxDuration = 30;

const searchSchema = z.object({
  claim: z.string().trim().min(2).max(500),
});

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;

  const blocked = await guardApi(req, { name: "wikiSearch", requireAuth: true });
  if (blocked) return blocked;

  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Describe the prep you're looking for." },
      { status: 400 },
    );
  }

  try {
    const result = await searchPrep(parsed.data.claim);
    return NextResponse.json({ result });
  } catch (err) {
    console.error("wiki/search failed", err);
    return NextResponse.json(
      { error: "Something went wrong searching the wiki. Please try again." },
      { status: 500 },
    );
  }
}
