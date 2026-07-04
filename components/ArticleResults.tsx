"use client";

import { CARD_LENGTHS, type Article, type CardLength } from "@/types";

interface ArticleResultsProps {
  articles: Article[];
  cutLength: CardLength;
  onCutLengthChange: (length: CardLength) => void;
  onCut: (article: Article) => void;
  /** URL of the article currently being cut, if any. */
  cuttingUrl: string | null;
}

function credibilityLabel(score: number): string {
  if (score >= 85) return "Very high credibility";
  if (score >= 70) return "High credibility";
  if (score >= 50) return "Medium credibility";
  return "Lower credibility";
}

export default function ArticleResults({
  articles,
  cutLength,
  onCutLengthChange,
  onCut,
  cuttingUrl,
}: ArticleResultsProps) {
  const busy = cuttingUrl !== null;

  return (
    <section aria-label="Search results" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">
          {articles.length} article{articles.length === 1 ? "" : "s"} found
        </h2>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          Card length
          <select
            value={cutLength}
            onChange={(e) => onCutLengthChange(e.target.value as CardLength)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900
              dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {CARD_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="flex flex-col gap-3">
        {articles.map((article) => {
          const isCutting = cuttingUrl === article.url;
          return (
            <li
              key={article.url}
              className="rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-400
                dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                  >
                    {article.title}
                  </a>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                    {article.author} · {article.publication} · {article.date}
                  </p>
                </div>
                <span
                  title={`Credibility score: ${article.credibilityScore}/100`}
                  className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700
                    dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {credibilityLabel(article.credibilityScore)}
                </span>
              </div>

              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{article.explanation}</p>

              <button
                type="button"
                onClick={() => onCut(article)}
                disabled={busy}
                className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition
                  hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60
                  dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {isCutting ? `Cutting ${cutLength.toLowerCase()} card…` : "Cut Card"}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
