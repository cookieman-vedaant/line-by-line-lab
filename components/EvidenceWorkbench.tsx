"use client";

import { useState } from "react";
import ArticleResults from "@/components/ArticleResults";
import CardView from "@/components/CardView";
import SearchForm from "@/components/SearchForm";
import type { Article, Card, CardLength, SearchParams } from "@/types";

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "results"; articles: Article[] }
  | { status: "empty"; notice: string }
  | { status: "error"; message: string };

export default function EvidenceWorkbench() {
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

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();

      if (!res.ok) {
        setSearch({ status: "error", message: data.error ?? "Search failed. Please try again." });
        return;
      }
      if (!data.articles || data.articles.length === 0) {
        setSearch({
          status: "empty",
          notice: data.notice ?? "No reputable sources were found matching your criteria.",
        });
        return;
      }
      setSearch({ status: "results", articles: data.articles });
    } catch {
      setSearch({ status: "error", message: "Could not reach the server. Is it running?" });
    }
  }

  async function handleCut(article: Article) {
    if (!lastParams) return;
    setCuttingUrl(article.url);
    setCutError(null);
    setResult(null);

    try {
      const res = await fetch("/api/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article, claim: lastParams.claim, cardLength: cutLength }),
      });
      const data = await res.json();

      if (!res.ok || !data.card) {
        setCutError(data.error ?? "Card cutting failed. Try another article.");
        return;
      }
      setResult({ card: data.card, article });
    } catch {
      setCutError("Could not reach the server. Is it running?");
    } finally {
      setCuttingUrl(null);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <SearchForm onSearch={handleSearch} busy={search.status === "searching"} />

      {search.status === "searching" && (
        <p className="animate-pulse text-center text-sm text-zinc-500 dark:text-zinc-400">
          Searching reputable sources… this can take up to a minute.
        </p>
      )}

      {search.status === "empty" && (
        <p role="status" className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          {search.notice} Try broadening the claim or relaxing the filters.
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
          Reading the article and cutting your card… this can take up to a minute.
        </p>
      )}

      {cutError && (
        <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
          {cutError}
        </p>
      )}

      {result && <CardView card={result.card} article={result.article} />}
    </div>
  );
}
