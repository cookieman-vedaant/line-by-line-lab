"use client";

import { useRef, useState } from "react";
import ArticleResults from "@/components/ArticleResults";
import CardCutterPanel from "@/components/CardCutterPanel";
import CardView from "@/components/CardView";
import CoachPanel from "@/components/CoachPanel";
import HistoryPanel from "@/components/HistoryPanel";
import RehighlighterPanel from "@/components/RehighlighterPanel";
import RoundLogPanel from "@/components/RoundLogPanel";
import SearchForm from "@/components/SearchForm";
import SearchIntro from "@/components/SearchIntro";
import SearchProgress from "@/components/SearchProgress";
import WikiPanel from "@/components/WikiPanel";
import { requestCut, requestSearch } from "@/lib/apiClient";
import { articlesToContext, cardToContext } from "@/lib/coachContext";
import { nextTabIndex } from "@/lib/tabNav";
import type {
  Article,
  AssistantContext,
  Card,
  CardLength,
  SearchParams,
  SearchStage,
} from "@/types";

type SearchState =
  | { status: "idle" }
  // `stage` stays null until the server reports one — a cached search returns
  // before there is any phase to show.
  | { status: "searching"; stage: SearchStage | null }
  | { status: "results"; articles: Article[] }
  | { status: "empty"; notice: string }
  | { status: "error"; message: string };

type Tab = "find" | "cut" | "wiki" | "rehighlight" | "coach" | "record";

/**
 * The tools, and ONLY the tools. Declared once, in the order they appear, so the
 * tablist markup and the arrow-key order can never drift apart.
 *
 * My Cards is deliberately NOT here. This row is for things that do work —
 * things you open to produce something. Your card library is a record of work
 * already done, so it sits above the row as its own control rather than
 * competing for attention with six verbs.
 */
const TABS: readonly { value: Tab; label: string }[] = [
  { value: "find", label: "Find Articles" },
  { value: "cut", label: "Cut a Card" },
  { value: "wiki", label: "Wiki" },
  { value: "rehighlight", label: "Re-Highlight" },
  { value: "coach", label: "Coach" },
  { value: "record", label: "Record" },
];

const tabId = (t: Tab) => `tool-tab-${t}`;
const panelId = (t: Tab) => `tool-panel-${t}`;

export default function EvidenceWorkbench() {
  const [tab, setTab] = useState<Tab>("find");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [lastParams, setLastParams] = useState<SearchParams | null>(null);
  const [cutLength, setCutLength] = useState<CardLength>("Medium");
  const [cuttingUrl, setCuttingUrl] = useState<string | null>(null);
  const [cutError, setCutError] = useState<string | null>(null);
  const [result, setResult] = useState<{ card: Card; article: Article } | null>(null);
  // The most recent card cut ANYWHERE (Finder or Cut-a-Card), so the Coach can
  // pick it up as context. Seed the Coach's input on a "Discuss in Coach" jump.
  const [lastCut, setLastCut] = useState<{ card: Card; source: string } | null>(null);
  const [coachSeed, setCoachSeed] = useState<{ prompt: string; nonce: number } | undefined>(
    undefined,
  );
  // Counts cuts from BOTH entry points. The server already filed the card in the
  // account's history by the time we get here, so this is only the nudge that
  // tells the My Cards tab its list is one card out of date.
  const [cutCount, setCutCount] = useState(0);
  // The card library, opened from above the tool row rather than from it.
  const [libraryOpen, setLibraryOpen] = useState(false);

  /** Single place both cut paths report through, so neither can forget one half. */
  function noteCut(card: Card, source: string) {
    setLastCut({ card, source });
    setCutCount((n) => n + 1);
  }

  async function handleSearch(params: SearchParams) {
    setSearch({ status: "searching", stage: null });
    setLastParams(params);
    setCutLength(params.cardLength ?? "Medium");
    setResult(null);
    setCutError(null);

    const outcome = await requestSearch(params, (stage) =>
      // Guard against a late event from a superseded search overwriting the
      // state of the one the user is actually waiting on.
      setSearch((prev) => (prev.status === "searching" ? { status: "searching", stage } : prev)),
    );
    if (!outcome.ok) {
      setSearch({ status: "error", message: outcome.error });
    } else if (outcome.articles.length === 0) {
      setSearch({ status: "empty", notice: "notice" in outcome ? outcome.notice : "" });
    } else {
      setSearch({ status: "results", articles: outcome.articles });
    }
  }

  async function handleCut(article: Article) {
    if (!lastParams) return;
    setCuttingUrl(article.url);
    setCutError(null);
    setResult(null);

    const outcome = await requestCut({
      source: {
        url: article.url,
        title: article.title,
        author: article.author,
        // The real people + affiliations, so the cite is built from names the
        // database stated rather than from the "X et al." display string.
        authors: article.authors,
        authorInstitutions: article.authorInstitutions,
        publication: article.publication,
        date: article.date,
        // Fallback for when the (often paywalled) URL can't be fetched —
        // real, verbatim abstract text the search already retrieved.
        text: article.abstract,
      },
      claim: lastParams.claim,
      cardLength: cutLength,
    });
    setCuttingUrl(null);

    if (!outcome.ok) {
      setCutError(outcome.error);
      return;
    }
    setResult({ card: outcome.card, article });
    noteCut(outcome.card, `${article.title} (${article.url})`);
  }

  // Everything the Coach should know from the other tabs: the current claim, the
  // Article Finder results, and the last card cut. Profile + rounds are merged in
  // by the Coach itself from local storage.
  const foundArticles = search.status === "results" ? search.articles : null;
  const coachContext: AssistantContext | undefined = (() => {
    const ctx: AssistantContext = {};
    if (lastParams) {
      ctx.claim = lastParams.claim;
      ctx.evidenceType = lastParams.evidenceType;
    }
    if (foundArticles && foundArticles.length > 0) {
      ctx.foundArticles = articlesToContext(foundArticles);
    }
    if (lastCut) ctx.lastCard = cardToContext(lastCut.card, lastCut.source);
    return Object.keys(ctx).length > 0 ? ctx : undefined;
  })();

  function discussInCoach(article?: Article) {
    if (article) {
      setCoachSeed({
        prompt: `I found this in the Article Finder — help me use it: "${article.title}" (${article.url})`,
        nonce: Date.now(),
      });
    }
    setTab("coach");
  }

  // Roving tabindex: only the selected tab is in the Tab order, and Left/Right
  // (plus Home/End) move between tools — the WAI-ARIA tabs pattern. Activation
  // is automatic because every panel is already mounted, so selecting one costs
  // nothing.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const current = TABS.findIndex((t) => t.value === tab);
    const next = nextTabIndex(event.key, current, TABS.length);
    if (next === null) return;

    event.preventDefault();
    const value = TABS[next].value;
    setTab(value);
    tabRefs.current[value]?.focus();
  }

  const tabButton = ({ value, label }: { value: Tab; label: string }) => (
    <button
      key={value}
      type="button"
      role="tab"
      id={tabId(value)}
      aria-selected={tab === value}
      aria-controls={panelId(value)}
      tabIndex={tab === value ? 0 : -1}
      ref={(el) => {
        tabRefs.current[value] = el;
      }}
      onClick={() => setTab(value)}
      onKeyDown={onTabKeyDown}
      // Tighter on small screens so the tools stay in two rows instead of three
      // — the masthead already costs most of a phone's first screen.
      className={`btn-press frame px-3 py-2 font-display text-xs font-bold uppercase tracking-wide sm:px-5 sm:py-2.5 sm:text-sm ${
        tab === value ? "bg-accent text-paper" : "bg-paper-2 text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Your card library, above the tools and separate from them. A disclosure
          button, NOT a seventh tab: the tab row is the list of things you can do,
          and this is the record of what you've already done. */}
      <div className="flex items-center justify-between gap-3 border-b-2 border-ink/15 pb-4">
        <button
          type="button"
          onClick={() => setLibraryOpen((open) => !open)}
          aria-expanded={libraryOpen}
          aria-controls="card-library"
          className={`btn-press frame inline-flex items-center gap-2 px-4 py-2 font-display text-xs font-bold uppercase tracking-wide sm:text-sm ${
            libraryOpen ? "bg-ink text-paper" : "bg-paper-2 text-ink"
          }`}
        >
          <span aria-hidden>▤</span> My Cards
        </button>
        <p className="label-mono hidden text-[10px] text-ink/50 sm:block">
          {libraryOpen ? "every card you've cut" : "saved automatically as you cut"}
        </p>
      </div>

      <div id="card-library" className={libraryOpen ? "tab-panel" : "hidden"}>
        <HistoryPanel active={libraryOpen} refreshKey={cutCount} />
      </div>

      {/* The tools. Hidden rather than unmounted while the library is open, so
          search results and half-typed text are still there on the way back. */}
      <div className={libraryOpen ? "hidden" : "flex flex-col gap-8"}>
        <div role="tablist" aria-label="Tool" className="flex flex-wrap gap-2 sm:gap-3">
          {TABS.map(tabButton)}
        </div>

      <div
        role="tabpanel"
        id={panelId("record")}
        aria-labelledby={tabId("record")}
        className={tab === "record" ? "" : "hidden"}
      >
        <div className="tab-panel">
          <RoundLogPanel />
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId("coach")}
        aria-labelledby={tabId("coach")}
        className={tab === "coach" ? "" : "hidden"}
      >
        <div className="tab-panel">
          <CoachPanel context={coachContext} seed={coachSeed} />
        </div>
      </div>

      {/* Both panels stay mounted (typed text survives a tab switch); the
          hidden one is display:none, so its content replays the tab-in
          animation each time it's shown. */}
      <div
        role="tabpanel"
        id={panelId("cut")}
        aria-labelledby={tabId("cut")}
        className={tab === "cut" ? "" : "hidden"}
      >
        <div className="tab-panel">
          <CardCutterPanel initialClaim={lastParams?.claim} onCardCut={noteCut} />
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId("wiki")}
        aria-labelledby={tabId("wiki")}
        className={tab === "wiki" ? "" : "hidden"}
      >
        <div className="tab-panel">
          <WikiPanel />
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId("rehighlight")}
        aria-labelledby={tabId("rehighlight")}
        className={tab === "rehighlight" ? "" : "hidden"}
      >
        <div className="tab-panel">
          <RehighlighterPanel />
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId("find")}
        aria-labelledby={tabId("find")}
        className={tab === "find" ? "" : "hidden"}
      >
        <div className="tab-panel flex flex-col gap-10">
          <SearchForm onSearch={handleSearch} busy={search.status === "searching"} />

          {search.status === "idle" && (
            <SearchIntro onCutCard={() => setTab("cut")} onSearchWiki={() => setTab("wiki")} />
          )}

          {search.status === "searching" && <SearchProgress stage={search.stage} />}

          {search.status === "empty" && (
            <p role="status" className="frame bg-yellow px-4 py-3 text-sm font-medium text-black">
              {search.notice} Try broadening the claim or relaxing the filters — or paste an
              article you already have into the Cut a Card tab.
            </p>
          )}

          {search.status === "error" && (
            <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
              {search.message}
            </p>
          )}

          {search.status === "results" && (
            <div key={search.articles[0]?.url} className="tab-panel">
              <ArticleResults
                articles={search.articles}
                cutLength={cutLength}
                onCutLengthChange={setCutLength}
                onCut={handleCut}
                cuttingUrl={cuttingUrl}
                onDiscuss={discussInCoach}
              />
            </div>
          )}

          {cuttingUrl && (
            <p role="status" className="label-mono animate-pulse text-center text-sm text-accent">
              <span aria-hidden>▸ </span>reading the article and cutting your card…
            </p>
          )}

          {cutError && (
            <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
              {cutError}
            </p>
          )}

          {result && (
            <div key={result.card.cite + result.article.url} className="tab-panel">
              <CardView
                card={result.card}
                sourceUrl={result.article.url}
                sourceName={result.article.publication}
              />
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
