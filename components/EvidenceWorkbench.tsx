"use client";

import { useState } from "react";
import ArticleResults from "@/components/ArticleResults";
import CardCutterPanel from "@/components/CardCutterPanel";
import CardView from "@/components/CardView";
import CoachPanel from "@/components/CoachPanel";
import SearchForm from "@/components/SearchForm";
import { requestCut, requestSearch } from "@/lib/apiClient";
import type { Article, Card, CardLength, SearchParams } from "@/types";

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "results"; articles: Article[] }
  | { status: "empty"; notice: string }
  | { status: "error"; message: string };

type Tab = "find" | "cut" | "coach";

export default function EvidenceWorkbench() {
  const [tab, setTab] = useState<Tab>("find");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [lastParams, setLastParams] = useState<SearchParams | null>(null);
  const [cutLength, setCutLength] = useState<CardLength>("Medium");
  const [cuttingUrl, setCuttingUrl] = useState<string | null>(null);
  const [cutError, setCutError] = useState<string | null>(null);
  const [result, setResult] = useState<{ card: Card; article: Article } | null>(null);

  async function handleSearch(params: SearchParams) {
    setSearch({ status: "searching" });
    setLastParams(params);
    setCutLength(params.cardLength ?? "Medium");
    setResult(null);
    setCutError(null);

    const outcome = await requestSearch(params);
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
  }

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      aria-pressed={tab === value}
      className={`btn-press frame px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide ${
        tab === value ? "bg-accent text-paper" : "bg-paper-2 text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Tool" className="flex flex-wrap gap-3">
        {tabButton("find", "Find Articles")}
        {tabButton("cut", "Cut a Card")}
        {tabButton("coach", "Coach")}
      </nav>

      <div className={tab === "coach" ? "" : "hidden"}>
        <div className="tab-panel">
          <CoachPanel
            context={
              lastParams
                ? { claim: lastParams.claim, evidenceType: lastParams.evidenceType }
                : undefined
            }
          />
        </div>
      </div>

      {/* Both panels stay mounted (typed text survives a tab switch); the
          hidden one is display:none, so its content replays the tab-in
          animation each time it's shown. */}
      <div className={tab === "cut" ? "" : "hidden"}>
        <div className="tab-panel">
          <CardCutterPanel initialClaim={lastParams?.claim} />
        </div>
      </div>

      <div className={tab === "find" ? "" : "hidden"}>
        <div className="tab-panel flex flex-col gap-10">
          <SearchForm onSearch={handleSearch} busy={search.status === "searching"} />

          {search.status === "searching" && (
            <p className="label-mono animate-pulse text-center text-sm text-accent">
              ▸ searching scholarly databases…
            </p>
          )}

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
              />
            </div>
          )}

          {cuttingUrl && (
            <p className="label-mono animate-pulse text-center text-sm text-accent">
              ▸ reading the article and cutting your card…
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
  );
}
