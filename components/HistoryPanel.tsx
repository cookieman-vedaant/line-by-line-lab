"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardView from "@/components/CardView";
import { deleteCardFromHistory, fetchCardHistory } from "@/lib/cardHistory";
import { matchesQuery } from "@/lib/cutCardMap";
import type { SavedCard } from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";

/** Where a card was cut, said the way a debater would say it. */
const ORIGIN_LABEL: Record<SavedCard["origin"], string> = {
  finder: "from a search result",
  cutter: "from your own article",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Every card you've ever cut, on this account.
 *
 * The list is written server-side by /api/cut, so it covers BOTH ways to cut —
 * the Article Finder and the Cut a Card panel — without either of them having to
 * remember to save. It follows the account, not the device or the network: a
 * card cut on a school laptop is here on a phone that evening.
 */
export default function HistoryPanel({
  active,
  refreshKey = 0,
}: {
  /** Whether this tab is on screen. Every panel stays mounted, so without this
   *  the history would be fetched on every Lab load for people who never open
   *  it — a needless query per visit and a needless page of card bodies. */
  active: boolean;
  /** Bumped by the workbench whenever a card is cut anywhere, so the list picks
   *  up the new card instead of going stale behind a tab. */
  refreshKey?: number;
}) {
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  /** The cut count this list already reflects. Differs from `refreshKey` exactly
   *  when a card was cut since the last load — including while closed. */
  const seenRefresh = useRef(refreshKey);

  /**
   * Fetch page one.
   *
   * "initial" owns the list and the cursor outright. "refresh" (after a card is
   * cut) only PREPENDS ids we don't already have and leaves the cursor alone —
   * the list may already extend well past page one, and adopting page one's
   * cursor again would re-fetch and duplicate everything the user paged in.
   */
  const loadFirstPage = useCallback(async (mode: "initial" | "refresh") => {
    setLoading(true);
    setError(null);
    const outcome = await fetchCardHistory();
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    loadedOnce.current = true;
    const fresh = outcome.page.cards;

    if (mode === "initial") {
      setCards(fresh);
      setCursor(outcome.page.nextCursor);
      return;
    }
    setCards((prev) => {
      const known = new Set(prev.map((c) => c.id));
      const added = fresh.filter((c) => !known.has(c.id));
      return added.length > 0 ? [...added, ...prev] : prev;
    });
  }, []);

  /**
   * One effect for both "the library was opened" and "a card was cut".
   *
   * Everything is gated on `active`, which is what keeps the query off the Lab's
   * critical path: this component stays mounted while the library is closed, so
   * an ungated fetch would pull a page of card bodies on every Lab load for
   * people who never open it.
   *
   * `seenRefresh` carries a pending refresh across a closed period instead of
   * fetching in the background — cut ten cards in a row with the library shut
   * and it costs zero requests, then exactly one when you open it.
   */
  useEffect(() => {
    if (!active) return;
    if (!loadedOnce.current) {
      seenRefresh.current = refreshKey;
      void loadFirstPage("initial");
      return;
    }
    if (seenRefresh.current !== refreshKey) {
      seenRefresh.current = refreshKey;
      void loadFirstPage("refresh");
    }
  }, [active, refreshKey, loadFirstPage]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    const outcome = await fetchCardHistory(cursor);
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setCards((prev) => [...prev, ...outcome.page.cards]);
    setCursor(outcome.page.nextCursor);
  }

  async function remove(card: SavedCard) {
    const label = card.tag.trim() || card.cite || "this card";
    if (!window.confirm(`Delete “${label}” from your history? This can't be undone.`)) return;

    setDeletingId(card.id);
    const outcome = await deleteCardFromHistory(card.id);
    setDeletingId(null);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setCards((prev) => prev.filter((c) => c.id !== card.id));
    if (openId === card.id) setOpenId(null);
  }

  const shown = cards.filter((c) => matchesQuery(c, query));
  const filtering = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl font-extrabold leading-tight">
          Every card you&apos;ve cut
        </h2>
        <p className="mt-2 max-w-lg text-sm font-medium leading-snug text-ink/70">
          Saved automatically — from the Article Finder and from Cut a Card alike. Tied to your
          account, so it&apos;s the same list on every device you sign in on.
        </p>
      </div>

      {cards.length > 0 && (
        <div>
          <label htmlFor="history-filter" className="label-mono mb-2 block text-xs text-ink">
            Find a card
          </label>
          <input
            id="history-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="tag, cite, claim, or article title"
            className={inputClasses}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
          {error}
        </p>
      )}

      {loading && cards.length === 0 && (
        <p className="label-mono animate-pulse text-center text-sm text-accent">
          <span aria-hidden>▸ </span>opening your card library…
        </p>
      )}

      {!loading && cards.length === 0 && !error && (
        <p className="frame bg-paper-2 px-4 py-6 text-sm font-medium leading-snug text-ink/70">
          Nothing here yet. Cut a card in <strong className="text-ink">Find Articles</strong> or{" "}
          <strong className="text-ink">Cut a Card</strong> and it lands here automatically — you
          never have to remember to save it.
        </p>
      )}

      {cards.length > 0 && (
        // Precise about what the number covers: the filter only sees cards that
        // have actually been loaded, so claiming a bare total would be a lie the
        // moment a library runs past one page.
        <p className="label-mono text-xs text-ink/60">
          {filtering
            ? `${shown.length} of ${cards.length} loaded card${cards.length === 1 ? "" : "s"} match`
            : `${cards.length} card${cards.length === 1 ? "" : "s"}${cursor ? " loaded so far" : ""}`}
        </p>
      )}

      {filtering && shown.length === 0 && (
        <p role="status" className="frame bg-yellow px-4 py-3 text-sm font-medium text-black">
          No card matches “{query.trim()}”. The filter looks at tags, cites, the claim you cut for,
          and article titles — not the card body.
          {cursor ? " Older cards may not be loaded yet — try Load more." : ""}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {shown.map((card) => (
          <HistoryRow
            key={card.id}
            card={card}
            open={openId === card.id}
            deleting={deletingId === card.id}
            onToggle={() => setOpenId((id) => (id === card.id ? null : card.id))}
            onDelete={() => remove(card)}
          />
        ))}
      </div>

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="btn-press frame self-start bg-paper-2 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-ink disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function HistoryRow({
  card,
  open,
  deleting,
  onToggle,
  onDelete,
}: {
  card: SavedCard;
  open: boolean;
  deleting: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const panelId = `history-card-${card.id}`;
  const meta = [formatWhen(card.createdAt), ORIGIN_LABEL[card.origin], card.cardLength]
    .filter(Boolean)
    .join(" · ");

  return (
    // content-visibility:auto so a long library doesn't pay layout + paint for
    // cards nobody has scrolled to — the same treatment the wiki results needed.
    <div className="frame flex flex-col bg-paper-2 [contain-intrinsic-size:auto_120px] [content-visibility:auto]">
      <div className="flex items-start justify-between gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="btn-press flex min-w-0 flex-1 flex-col gap-1 text-left"
        >
          <span className="label-mono text-[10px] text-ink/55">{meta}</span>
          <span className="line-clamp-2 font-display text-sm font-bold leading-snug text-ink">
            {card.tag.trim() || "(untagged card)"}
          </span>
          <span className="label-mono text-[11px] text-accent">
            {card.cite || "no cite"} {open ? "▾" : "▸"}
          </span>
          {card.claim && (
            <span className="line-clamp-1 text-[11px] font-medium text-ink/55">
              cut for: {card.claim}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="label-mono btn-press frame shrink-0 bg-paper px-3 py-2 text-[10px] font-bold text-ink hover:text-red disabled:opacity-60"
        >
          {deleting ? "…" : "Delete"}
        </button>
      </div>

      {open && (
        <div id={panelId} className="tab-panel border-t-2 border-ink/15 p-4">
          {/* The same CardView as a fresh cut, so a saved card edits and exports
              exactly like one you just made. Edits stay in the browser — the
              history is a record of what was cut, and never writes back. */}
          <CardView
            card={card}
            sourceUrl={card.sourceUrl}
            sourceName={card.sourcePublication ?? card.sourceTitle}
            kicker="✂ From your history"
          />
        </div>
      )}
    </div>
  );
}
