"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CardView from "@/components/CardView";
import { requestWikiCaselists, requestWikiSearch } from "@/lib/apiClient";
import { caselistOptionLabel } from "@/lib/caselistLabel";
import type { WikiCardResult, WikiCaselist, WikiSearchResult } from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

/**
 * Wiki mining — search every card debaters have disclosed on opencaselist.
 *
 * opencaselist has no whole-wiki search, so we index it ourselves and search
 * that: the debater types the argument they want and gets matching cards from
 * every caselist and every year at once, instantly. No opencaselist login
 * required. Every card shown is verbatim disclosed content, rendered with the
 * original debater's own highlighting.
 *
 * The caselist filter is optional but does real work. A search returns at most
 * 60 cards out of 200k+, so on a broad claim those slots go to whichever
 * division ranked highest overall — often not the one the debater competes in,
 * which makes prep that exists feel missing. Narrowing spends the 60 on their
 * own event, and is much faster besides (measured 7.9s -> 0.7s).
 */
export default function WikiPanel() {
  const [claim, setClaim] = useState("");
  const [caselist, setCaselist] = useState(""); // "" = every caselist
  const [caselists, setCaselists] = useState<WikiCaselist[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WikiSearchResult | null>(null);
  // Bumped per search so <WikiResults> remounts, clearing its filters and
  // jump-to pointer for the fresh result set.
  const [runId, setRunId] = useState(0);

  // Populate the filter once. Failure is silent by design — requestWikiCaselists
  // returns [] — so a dropdown that can't load leaves search working across
  // everything rather than blocking it.
  useEffect(() => {
    let live = true;
    void requestWikiCaselists().then((list) => {
      if (live) setCaselists(list);
    });
    return () => {
      live = false;
    };
  }, []);

  async function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (claim.trim().length < 2) {
      setError("Describe the prep you're looking for.");
      return;
    }
    setError(null);
    setResult(null);
    setSearching(true);
    const outcome = await requestWikiSearch({
      claim: claim.trim(),
      ...(caselist ? { caselists: [caselist] } : {}),
    });
    setSearching(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setResult(outcome.result);
    setRunId((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSearch} noValidate className="flex flex-col gap-5">
        <div>
          <label htmlFor="wiki-claim" className={labelClasses}>
            What prep are you looking for? <span className="text-red">*</span>
          </label>
          <input
            id="wiki-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            /*
             * An INSTRUCTION, not a sample query. The previous placeholder was a
             * hardcoded example phrased like something a real debater would type,
             * which read to users as another person's search leaking onto their
             * screen. A placeholder is shared by everyone who loads the page, so
             * it must never look like anyone's content.
             */
            placeholder="Describe your claim…"
            className={inputClasses}
          />
          <p className="mt-2 text-xs text-ink/60">
            Describe the argument. This searches the full text of every card debaters have
            disclosed on opencaselist — <strong className="text-ink/80">every caselist, every
            year</strong> — and returns the ones that match, ready to use.
          </p>
        </div>

        {caselists.length > 0 && (
          <div>
            <label htmlFor="wiki-caselist" className={labelClasses}>
              Caselist <span className="text-ink/40">(optional)</span>
            </label>
            <select
              id="wiki-caselist"
              value={caselist}
              onChange={(e) => setCaselist(e.target.value)}
              className={inputClasses}
            >
              <option value="">Every caselist</option>
              {caselists.map((c) => (
                <option key={c.caselist} value={c.caselist}>
                  {caselistOptionLabel(c.caselist, c.cards)}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-ink/60">
              A search returns the 60 best matches. Narrowing to your own event spends all 60
              on prep you can actually hit — and returns them faster.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={searching}
          className="btn-press frame self-start bg-accent px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-paper disabled:opacity-60"
        >
          {searching ? "Searching…" : "Search the wiki"}
        </button>
      </form>

      {searching && (
        <p className="label-mono animate-pulse text-center text-sm text-accent">
          ▸ searching disclosed prep…
        </p>
      )}

      {error && (
        <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
          {error}
        </p>
      )}

      {result && <WikiResults key={runId} result={result} />}
    </div>
  );
}

/**
 * Results, with narrowing that happens AFTER the search.
 *
 * The debater never picks a caselist or year up front — they don't know where
 * their prep lives. But once real cards are on screen, the caselists and years
 * present in those results make useful filters, so they're offered here and
 * nowhere else.
 */
function WikiResults({ result }: { result: WikiSearchResult }) {
  const [caselistFilter, setCaselistFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  // Which result the jump-to index is pointing at. A jump target, not a scroll
  // spy: clicking an index entry sets and scrolls to it. Resets to 0 on a new
  // search (the whole component remounts) or when a filter changes (below).
  const [activeIndex, setActiveIndex] = useState(0);
  // The scrolling column of cards, so a jump can force real heights on it.
  const cardsRef = useRef<HTMLDivElement>(null);

  const caselists = useMemo(
    () => [...new Set(result.cards.map((c) => c.caselist).filter((c): c is string => !!c))].sort(),
    [result],
  );
  const years = useMemo(
    () =>
      [...new Set(result.cards.map((c) => c.year).filter((y): y is number => !!y))].sort(
        (a, b) => b - a,
      ),
    [result],
  );

  const shown = result.cards.filter(
    (c) =>
      (!caselistFilter || c.caselist === caselistFilter) &&
      (!yearFilter || String(c.year) === yearFilter),
  );
  const filtered = caselistFilter !== "" || yearFilter !== "";
  const selectClasses =
    "frame bg-paper-2 px-2 py-1.5 text-xs font-medium text-ink focus:border-accent focus:outline-none";

  function jumpTo(i: number) {
    setActiveIndex(i);
    const el = document.getElementById(`wiki-card-${i}`);
    const container = cardsRef.current;
    if (!el) return;

    // Cards render off-screen with content-visibility:auto, so any card not yet
    // on screen occupies an ESTIMATED height (contain-intrinsic-size: 600px),
    // far shorter than a real, full card. That makes scrollIntoView aim at a
    // position the page doesn't truly have — and as those cards resolve their
    // real heights while the page scrolls, the target slides away and we land in
    // the middle of the wrong card. Force every card to its real height for the
    // duration of the jump so the target is measured against the true layout,
    // then restore lazy rendering once the scroll settles (by then the target is
    // the scroll anchor, so re-collapsing off-screen cards can't move it).
    container?.classList.add("cv-measure");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener("scrollend", restore);
      container?.classList.remove("cv-measure");
    };
    window.addEventListener("scrollend", restore);
    // Fallback for browsers without scrollend, and for the reduced-motion path
    // where the scroll is instant and may fire no scrollend at all.
    window.setTimeout(restore, 1200);
  }

  return (
    // Wiki results break out of the Lab's narrow max-w-3xl column at lg+ so the
    // document-width card and the jump-to index can sit side by side without
    // squeezing the card into a tall, scroll-heavy sliver. Centered on the
    // viewport, capped at 72rem, and clamped to the viewport width so it never
    // introduces a horizontal scrollbar. Below lg it stays in the normal column.
    <div className="flex flex-col gap-6 lg:relative lg:left-1/2 lg:w-[min(100vw_-_2.5rem,72rem)] lg:-translate-x-1/2">
      <p className="label-mono text-xs text-ink/60">
        searched “{result.query}” · {shown.length}
        {filtered ? ` of ${result.cards.length}` : ""} card{shown.length === 1 ? "" : "s"}
      </p>

      {result.notice && (
        <p role="status" className="frame bg-yellow px-4 py-3 text-sm font-medium text-black">
          {result.notice}
        </p>
      )}

      {result.cards.length > 0 && (caselists.length > 1 || years.length > 1) && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-mono text-xs text-ink/60">narrow:</span>
          {caselists.length > 1 && (
            <select
              aria-label="Filter by caselist"
              value={caselistFilter}
              onChange={(e) => {
                setCaselistFilter(e.target.value);
                setActiveIndex(0);
              }}
              className={selectClasses}
            >
              <option value="">all caselists ({caselists.length})</option>
              {caselists.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {years.length > 1 && (
            <select
              aria-label="Filter by year"
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setActiveIndex(0);
              }}
              className={selectClasses}
            >
              <option value="">all years ({years.length})</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          )}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setCaselistFilter("");
                setYearFilter("");
                setActiveIndex(0);
              }}
              className="btn-press frame bg-paper-2 px-2.5 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-ink"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Cards on the left; a jump-to index on the right so a debater can scan 50
          results by tag + team instead of scrolling blind. On mobile the index
          stacks ABOVE the cards (flex-col-reverse) so it's seen first. */}
      <div className="flex flex-col-reverse gap-6 lg:flex-row lg:items-start">
        <div ref={cardsRef} className="flex min-w-0 flex-1 flex-col gap-6">
          {shown.map((item, i) => (
            <WikiCard
              key={`${item.sourceUrl ?? ""}-${i}`}
              id={`wiki-card-${i}`}
              active={i === activeIndex}
              item={item}
            />
          ))}
        </div>

        {shown.length > 1 && (
          <WikiResultsIndex items={shown} activeIndex={activeIndex} onJump={jumpTo} />
        )}
      </div>
    </div>
  );
}

/**
 * Right-hand index of the current results — a table of contents for prep.
 *
 * A claim can match dozens of cards; scrolling through all of them to find the
 * one framed the way you want is the exact tedium this removes. Each entry shows
 * the card's tag and the team it came from; clicking jumps straight to it.
 */
function WikiResultsIndex({
  items,
  activeIndex,
  onJump,
}: {
  items: WikiCardResult[];
  activeIndex: number;
  onJump: (i: number) => void;
}) {
  return (
    <aside
      aria-label="Jump to a result"
      className="frame bg-paper-2 p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-72 lg:shrink-0 lg:overflow-y-auto"
    >
      <p className="label-mono mb-2 text-xs text-ink/60">
        {items.length} results · jump to
      </p>
      <ol className="flex flex-col gap-1">
        {items.map((item, i) => {
          const where = [item.team, item.caselist].filter(Boolean).join(" · ");
          const isActive = i === activeIndex;
          return (
            <li key={`${item.sourceUrl ?? ""}-${i}`}>
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={isActive ? "true" : undefined}
                className={
                  "btn-press flex w-full flex-col gap-0.5 rounded-sm border px-2 py-1.5 text-left transition-colors " +
                  (isActive
                    ? "border-accent bg-accent/10"
                    : "border-transparent hover:bg-paper")
                }
              >
                <span className="flex items-start gap-1.5">
                  <span className="label-mono mt-px shrink-0 text-[10px] text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="line-clamp-2 text-xs font-semibold leading-snug text-ink">
                    {item.card.tag || "(untagged)"}
                  </span>
                </span>
                {where && (
                  <span className="label-mono pl-[1.35rem] text-[10px] text-ink/50">{where}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function WikiCard({ item, id, active }: { item: WikiCardResult; id: string; active?: boolean }) {
  const provenance = [item.school, item.team, item.caselist]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      id={id}
      // content-visibility:auto lets the browser skip layout+paint for cards
      // that aren't on screen — a big deal with up to 60 full, editable cards.
      // contain-intrinsic-size reserves a plausible height so the scrollbar and
      // jump-to offsets stay stable before a card first renders.
      className={
        "flex scroll-mt-24 flex-col gap-2 rounded-sm transition-shadow [content-visibility:auto] [contain-intrinsic-size:auto_600px] " +
        (active ? "ring-2 ring-accent/40 ring-offset-4 ring-offset-paper" : "")
      }
    >
      {(provenance || item.sourceUrl) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="label-mono text-xs text-ink/60">
            {provenance}
            {item.year ? ` · ${item.year}` : ""}
          </p>
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="label-mono text-xs text-accent hover:underline"
            >
              view on opencaselist →
            </a>
          )}
        </div>
      )}
      {/* Same CardView as our own cuts: the disclosed card was read into the same
          internal markup, so it renders, edits and exports identically. */}
      <CardView card={item.card} kicker="⛏ From the wiki" />
    </div>
  );
}
