"use client";

import { useState } from "react";
import ArticleResults from "@/components/ArticleResults";
import CardCutterPanel from "@/components/CardCutterPanel";
import CardView from "@/components/CardView";
import SearchForm from "@/components/SearchForm";
import { requestCut, requestSearch } from "@/lib/apiClient";
import type { Article, Card, CardLength, SearchParams } from "@/types";

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "results"; articles: Article[] }
  | { status: "empty"; notice: string }
  | { status: "error"; message: string };

type Tab = "find" | "cut";

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
      className={`border-b-2 px-4 py-2 text-sm font-semibold transition ${
        tab === value
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
          : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      <nav
        aria-label="Tool"
        className="flex justify-center border-b border-zinc-200 dark:border-zinc-800"
      >
        {tabButton("find", "Find Articles")}
        {tabButton("cut", "Cut a Card")}
      </nav>

      {tab === "cut" ? (
        <CardCutterPanel initialClaim={lastParams?.claim} />
      ) : (
        <div className="flex flex-col gap-10">
          <SearchForm onSearch={handleSearch} busy={search.status === "searching"} />

          {search.status === "searching" && (
            <p className="animate-pulse text-center text-sm text-zinc-500 dark:text-zinc-400">
              Searching scholarly databases…
            </p>
          )}

          {search.status === "empty" && (
            <p role="status" className="text-center text-sm text-zinc-600 dark:text-zinc-400">
              {search.notice} Try broadening the claim or relaxing the filters — or paste an
              article you already have into the Cut a Card tab.
            </p>
          )}

          {search.status === "error" && (
            <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
              {search.message}
            </p>
          )}

          {search.status === "results" && (
            <ArticleResults
              articles={search.articles}
              cutLength={cutLength}
              onCutLengthChange={setCutLength}
              onCut={handleCut}
              cuttingUrl={cuttingUrl}
            />
          )}

          {cuttingUrl && (
            <p className="animate-pulse text-center text-sm text-zinc-500 dark:text-zinc-400">
              Reading the article and cutting your card…
            </p>
          )}

          {cutError && (
            <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
              {cutError}
            </p>
          )}

          {result && (
            <CardView
              card={result.card}
              sourceUrl={result.article.url}
              sourceName={result.article.publication}
            />
          )}
        </div>
      )}
    </div>
  );
}
