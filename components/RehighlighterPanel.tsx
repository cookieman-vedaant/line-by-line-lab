"use client";

import { useState } from "react";
import CardView from "@/components/CardView";
import ContradictionCard from "@/components/ContradictionCard";
import { requestRehighlight } from "@/lib/apiClient";
import type { RehighlightResult } from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

export default function RehighlighterPanel() {
  const [mode, setMode] = useState<"card" | "url">("card");
  const [card, setCard] = useState("");
  const [url, setUrl] = useState("");
  const [claim, setClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RehighlightResult | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "card" && card.trim().length < 40) {
      setError("Paste the opponent's full card (tag + cite + body).");
      return;
    }
    if (mode === "url" && !url.trim().startsWith("http")) {
      setError("Paste a full article URL (starting with http).");
      return;
    }
    setError(null);
    setResult(null);
    setBusy(true);

    const source = mode === "card" ? { card: card.trim() } : { url: url.trim() };
    const outcome = await requestRehighlight({
      source,
      opponentClaim: claim.trim() || undefined,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setResult(outcome.result);
  }

  const modeButton = (value: "card" | "url", label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`btn-press frame px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide ${
        mode === value ? "bg-accent text-paper" : "bg-paper-2 text-ink"
      }`}
    >
      {label}
    </button>
  );

  const noContradictions = result !== null && result.contradictions.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono text-xs text-ink/70">Their evidence:</span>
          {modeButton("card", "Paste card")}
          {modeButton("url", "Article URL")}
        </div>

        {mode === "card" ? (
          <div>
            <label htmlFor="rh-card" className={labelClasses}>
              Opponent&apos;s card <span className="text-red">*</span>
            </label>
            <textarea
              id="rh-card"
              value={card}
              onChange={(e) => setCard(e.target.value)}
              rows={10}
              placeholder="Paste their whole card — tag, cite (with the source link), and body…"
              className={`${inputClasses} resize-y font-mono text-xs`}
            />
          </div>
        ) : (
          <div>
            <label htmlFor="rh-url" className={labelClasses}>
              Source article URL <span className="text-red">*</span>
            </label>
            <input
              id="rh-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/the-article-they-cut"
              className={inputClasses}
            />
          </div>
        )}

        <div>
          <label htmlFor="rh-claim" className={labelClasses}>
            Their tag / claim{" "}
            <span className="text-ink/50 normal-case">(optional — auto-read from a pasted card)</span>
          </label>
          <textarea
            id="rh-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={2}
            placeholder='e.g. "Sanctions cripple authoritarian regimes."'
            className={`${inputClasses} resize-y`}
          />
        </div>

        {error && (
          <p role="alert" className="frame bg-red px-4 py-3 text-sm font-semibold text-white">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn-press frame mt-1 w-full bg-accent px-6 py-3.5 font-display
            text-base font-bold uppercase tracking-wide text-paper sm:w-auto sm:self-start"
        >
          {busy ? "Re-highlighting…" : "⚡ Expose contradictions"}
        </button>
      </form>

      {busy && (
        <p className="label-mono animate-pulse text-center text-sm text-accent">
          ▸ reading the whole article and hunting contradictions…
        </p>
      )}

      {result?.notice && (
        <p role="status" className="frame bg-yellow px-4 py-3 text-sm font-medium text-black">
          {result.notice}
        </p>
      )}

      {noContradictions && (
        <p role="status" className="frame bg-paper-2 px-4 py-3 text-sm font-medium text-ink">
          No clear contradictions found — this card holds up. (Worth knowing.)
        </p>
      )}

      {result && result.contradictions.length > 0 && (
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="label-mono mb-3 text-xs text-ink/70">Their card, re-cut against them</h3>
            <CardView
              card={result.card}
              sourceUrl={result.sourceUrl}
              sourceName={result.articleTitle || undefined}
              kicker="⚡ Re-Highlight"
            />
          </div>
          <div>
            <h3 className="label-mono mb-3 text-xs text-ink/70">
              Contradictions ({result.contradictions.length})
            </h3>
            <div className="flex flex-col gap-4">
              {result.contradictions.map((c, i) => (
                <ContradictionCard key={i} item={c} index={i} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
