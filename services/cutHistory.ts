import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Card, CutOrigin, CutRequest } from "@/types";

/**
 * Saving a cut card to the account's history.
 *
 * Written HERE, on the server, rather than by the browser after it receives the
 * card. Two reasons, and the second is the one that matters:
 *   1. /api/cut is the single choke point every cut passes through — the Article
 *      Finder and the standalone Cut a Card panel both call it — so one write
 *      covers both entry points and any future one automatically.
 *   2. A client-side save is optional by construction. Close the tab, lose the
 *      network, or block the request and the card silently never lands. History
 *      that is usually complete is worse than no history, because you stop
 *      checking whether the thing you're looking for is actually missing.
 */

/** What the caller passes so the row carries context, not just the card text. */
export interface RecordCutInput {
  userId: string;
  card: Card;
  request: CutRequest;
}

/**
 * Which tool cut it, inferred rather than passed. The Finder always has a URL to
 * fetch AND supplies the article's title, because it already knows the source;
 * a bring-your-own cut may have a URL but never arrives with search metadata.
 * Inferring keeps the client from having to be trusted about it (and from having
 * to be updated in lockstep with the server).
 */
export function inferOrigin(request: CutRequest): CutOrigin {
  return request.source.url && request.source.title ? "finder" : "cutter";
}

/**
 * Persist one cut. NEVER throws: the caller has already produced a real card and
 * the user must get it. A history write failing is worth a log line, not a
 * failed cut — losing the card the user waited two minutes for, in order to
 * report that we couldn't file a copy of it, would be the wrong trade.
 *
 * Returns whether the row landed, so a caller that wants to tell the user
 * "couldn't save this to your history" can.
 */
export async function recordCut(
  supabase: SupabaseClient,
  { userId, card, request }: RecordCutInput,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("cut_cards").insert({
      user_id: userId,
      tag: card.tag,
      cite: card.cite,
      cite_details: card.citeDetails,
      body: card.body,
      claim: request.claim,
      card_length: request.cardLength,
      origin: inferOrigin(request),
      source_url: request.source.url ?? null,
      source_title: request.source.title ?? null,
      source_publication: request.source.publication ?? null,
    });
    if (error) {
      console.error("cut history save failed", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("cut history save threw", err);
    return false;
  }
}
