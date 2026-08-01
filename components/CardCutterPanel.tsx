"use client";

import { useState } from "react";
import CardView from "@/components/CardView";
import { requestCut } from "@/lib/apiClient";
import { CARD_LENGTHS, type Card, type CardLength } from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";

const labelClasses = "label-mono mb-2 block text-xs text-ink";

interface CardCutterPanelProps {
  /** Prefill the claim from the last search, if any. */
  initialClaim?: string;
  /** Report a freshly cut card up so the Coach can pick it up as context. */
  onCardCut?: (card: Card, sourceLabel: string) => void;
}

/** The standalone Card Cutter: bring your own article (URL or pasted text). */
export default function CardCutterPanel({ initialClaim, onCardCut }: CardCutterPanelProps) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publication, setPublication] = useState("");
  const [date, setDate] = useState("");
  const [claim, setClaim] = useState(initialClaim ?? "");
  const [cardLength, setCardLength] = useState<CardLength>("Medium");

  // The panel stays mounted across tab switches, so when a later search supplies
  // a new claim, seed the field from it — but only while it's still empty, never
  // clobbering typed text. Done during render (React's prop-change pattern), so
  // no effect is needed.
  const [seededClaim, setSeededClaim] = useState(initialClaim ?? "");
  if (initialClaim && initialClaim !== seededClaim) {
    setSeededClaim(initialClaim);
    if (!claim) setClaim(initialClaim);
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [cutFromUrl, setCutFromUrl] = useState<string | undefined>(undefined);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (mode === "url" && !url.trim().startsWith("http")) {
      setError("Paste a full article URL (starting with http).");
      return;
    }
    if (mode === "text" && text.trim().length < 200) {
      setError("Paste the full article text (at least a few paragraphs).");
      return;
    }
    if (!claim.trim()) {
      setError("Enter the claim the card must support.");
      return;
    }

    setError(null);
    setCard(null);
    setBusy(true);

    const source =
      mode === "url"
        ? { url: url.trim() }
        : {
            text,
            title: title.trim() || undefined,
            author: author.trim() || undefined,
            publication: publication.trim() || undefined,
            date: date.trim() || undefined,
          };

    const outcome = await requestCut({ source, claim: claim.trim(), cardLength });
    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    setCutFromUrl(mode === "url" ? url.trim() : undefined);
    setCard(outcome.card);
    const sourceLabel =
      mode === "url" ? url.trim() : title.trim() || publication.trim() || "pasted article";
    onCardCut?.(outcome.card, sourceLabel);
  }

  const modeButton = (value: "url" | "text", label: string) => (
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

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono text-xs text-ink/70">Article from:</span>
          {modeButton("url", "A link (URL)")}
          {modeButton("text", "Pasted text")}
        </div>

        {mode === "url" ? (
          <div>
            <label htmlFor="cutter-url" className={labelClasses}>
              Article URL <span className="text-red">*</span>
            </label>
            <input
              id="cutter-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className={inputClasses}
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="cutter-text" className={labelClasses}>
                Article text <span className="text-red">*</span>
              </label>
              <textarea
                id="cutter-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Paste the full article text here…"
                className={`${inputClasses} resize-y font-mono text-xs`}
              />
            </div>
            <details className="text-sm">
              <summary className="label-mono cursor-pointer text-xs text-ink/70 hover:text-accent">
                Source details (optional — used for the cite)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <input
                  aria-label="Article title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Article title"
                  className={inputClasses}
                />
                <input
                  aria-label="Author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Author (and qualifications)"
                  className={inputClasses}
                />
                <input
                  aria-label="Publication"
                  value={publication}
                  onChange={(e) => setPublication(e.target.value)}
                  placeholder="Publication"
                  className={inputClasses}
                />
                <input
                  aria-label="Publication date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="Date (e.g. 26 Apr. 2016)"
                  className={inputClasses}
                />
              </div>
            </details>
          </>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="cutter-claim" className={labelClasses}>
              Claim the card must support <span className="text-red">*</span>
            </label>
            <textarea
              id="cutter-claim"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              rows={2}
              placeholder='e.g. "Authoritarian governments evade sanctions."'
              className={`${inputClasses} resize-y`}
            />
          </div>
          <div>
            <label htmlFor="cutter-length" className={labelClasses}>
              Card Length
            </label>
            <select
              id="cutter-length"
              value={cardLength}
              onChange={(e) => setCardLength(e.target.value as CardLength)}
              className={inputClasses}
            >
              {CARD_LENGTHS.map((length) => (
                <option key={length} value={length}>
                  {length}
                </option>
              ))}
            </select>
          </div>
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
          {busy ? "Cutting card…" : "✂ Cut Card"}
        </button>
      </form>

      {busy && (
        <p className="label-mono animate-pulse text-center text-sm text-accent">
          ▸ reading the article and cutting your card…
        </p>
      )}

      {card && <CardView card={card} sourceUrl={cutFromUrl} sourceName={publication || undefined} />}
    </div>
  );
}
