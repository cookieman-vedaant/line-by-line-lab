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

/** Riso-sticker color for the credibility badge, keyed to the score. */
function credibilityBadgeClass(score: number): string {
  if (score >= 85) return "bg-accent text-paper";
  if (score >= 70) return "bg-ink text-paper";
  if (score >= 50) return "bg-yellow text-black";
  return "bg-red text-white";
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
    <section aria-label="Search results" className="flex flex-col gap-5">
      <div className="divide-b flex flex-wrap items-center justify-between gap-4 pb-3">
        <h2 className="font-display text-2xl font-extrabold">
          {articles.length} article{articles.length === 1 ? "" : "s"}{" "}
          <span className="text-accent">found</span>
        </h2>
        <label className="label-mono flex items-center gap-2 text-xs">
          Card length
          <select
            value={cutLength}
            onChange={(e) => onCutLengthChange(e.target.value as CardLength)}
            className="frame bg-paper-2 px-2 py-1 font-mono text-xs font-medium
              text-ink focus:border-accent focus:outline-none"
          >
            {CARD_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="flex flex-col gap-5">
        {articles.map((article) => {
          const isCutting = cuttingUrl === article.url;
          return (
            <li
              key={article.url}
              className="shadow-hard frame bg-paper-2 p-5 transition
                hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-display text-lg font-bold leading-tight text-ink
                      underline-offset-2 hover:text-accent hover:underline"
                  >
                    {article.title}
                  </a>
                  <p className="label-mono mt-1.5 text-[11px] text-ink/70">
                    {article.author} · {article.publication} · {article.date}
                  </p>
                </div>
                <span
                  title={`Credibility score: ${article.credibilityScore}/100`}
                  className={`label-mono frame shrink-0 px-2 py-1 text-[10px] font-medium
                    ${credibilityBadgeClass(article.credibilityScore)}`}
                >
                  {credibilityLabel(article.credibilityScore)}
                </span>
              </div>

              <p className="mt-3 text-sm font-medium leading-relaxed text-ink/90">
                {article.explanation}
              </p>

              <button
                type="button"
                onClick={() => onCut(article)}
                disabled={busy}
                className={`btn-press frame mt-4 px-4 py-2 font-display text-xs
                  font-bold uppercase tracking-wide text-paper ${isCutting ? "bg-accent" : "bg-ink"}`}
              >
                {isCutting ? `Cutting ${cutLength.toLowerCase()} card…` : "✂ Cut Card"}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
