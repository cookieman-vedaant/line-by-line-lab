"use client";

import { useState } from "react";
import CardView from "@/components/CardView";
import { requestCut } from "@/lib/apiClient";
import { CARD_LENGTHS, type Card, type CardLength } from "@/types";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const labelClasses = "mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface CardCutterPanelProps {
  /** Prefill the claim from the last search, if any. */
  initialClaim?: string;
}

/** The standalone Card Cutter: bring your own article (URL or pasted text). */
export default function CardCutterPanel({ initialClaim }: CardCutterPanelProps) {
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publication, setPublication] = useState("");
  const [date, setDate] = useState("");
  const [claim, setClaim] = useState(initialClaim ?? "");
  const [cardLength, setCardLength] = useState<CardLength>("Medium");

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
  }

  const modeButton = (value: "url" | "text", label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        mode === value
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Article from:</span>
          {modeButton("url", "A link (URL)")}
          {modeButton("text", "Pasted text")}
        </div>

        {mode === "url" ? (
          <div>
            <label htmlFor="cutter-url" className={labelClasses}>
              Article URL <span className="text-red-500">*</span>
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
                Article text <span className="text-red-500">*</span>
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
              <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
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
              Claim the card must support <span className="text-red-500">*</span>
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
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition
            hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60
            dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {busy ? "Cutting card…" : "Cut Card"}
        </button>
      </form>

      {busy && (
        <p className="animate-pulse text-center text-sm text-zinc-500 dark:text-zinc-400">
          Reading the article and cutting your card…
        </p>
      )}

      {card && <CardView card={card} sourceUrl={cutFromUrl} sourceName={publication || undefined} />}
    </div>
  );
}
