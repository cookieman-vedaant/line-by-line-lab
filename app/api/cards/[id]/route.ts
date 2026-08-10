import { NextResponse } from "next/server";
import { guardApi } from "@/lib/apiGuard";
import { CUT_CARD_FULL_COLUMNS, rowToSavedCard, type CutCardRow } from "@/lib/cutCardMap";
import { requireUser } from "@/lib/supabase/user";

/**
 * ONE saved card, with its text.
 *
 * Split out from the list because the two have opposite shapes: a list row is
 * ~200 bytes and you want a hundred of them, while a body averages ~20KB and you
 * want exactly the one you are reading. Bundling them made the list scale with
 * how LONG people's cards were rather than how many they had, which is the wrong
 * variable — an Entire Article cut is worth 100 list rows on its own.
 *
 * Isolation is enforced twice, as everywhere else in this table: RLS scopes the
 * read to auth.uid(), and the query also filters user_id explicitly. `id` comes
 * from the URL and is therefore attacker-controlled, so this is precisely the
 * place a missing policy would turn into "read any card by guessing its id".
 */

const GUARD = { name: "card", requireHuman: false, countGlobal: false, perMinute: 120 } as const;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guardApi(req, GUARD);
  if (blocked) return blocked;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Missing card id." }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("cut_cards")
    .select(CUT_CARD_FULL_COLUMNS)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    console.error("card GET failed", error);
    return NextResponse.json({ error: "Couldn't open that card." }, { status: 500 });
  }
  // Not found and not-yours are the SAME response on purpose: distinguishing
  // them would confirm that a given id exists in someone else's library.
  if (!data) return NextResponse.json({ error: "That card is no longer here." }, { status: 404 });

  return NextResponse.json({ card: rowToSavedCard(data as unknown as CutCardRow) });
}
