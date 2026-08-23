"use client";

import { useState } from "react";
import type { SharpenedClaim } from "@/services/claimSharpener";
import {
  CARD_LENGTHS,
  EVIDENCE_TYPES,
  PUBLICATION_AGES,
  SOURCE_TYPES,
  type SearchParams,
} from "@/types";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";

const labelClasses = "label-mono mb-2 block text-xs text-ink";

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  busy: boolean;
}

export default function SearchForm({ onSearch, busy }: SearchFormProps) {
  const [evidenceType, setEvidenceType] = useState("");
  const [claim, setClaim] = useState("");
  const [sharpen, setSharpen] = useState<SharpenedClaim | null>(null);
  const [sharpening, setSharpening] = useState(false);
  const [sharpenError, setSharpenError] = useState("");
  const [sourceType, setSourceType] = useState("Any");
  const [publicationAge, setPublicationAge] = useState("Any");
  const [cardLength, setCardLength] = useState("Medium");
  const [error, setError] = useState<string | null>(null);

  /**
   * Ask what the claim is missing. Deliberately explicit rather than automatic:
   * a suggestion that appears while someone is still typing interrupts the
   * thought they were having, and this is their argument, not ours.
   */
  async function handleSharpen() {
    if (sharpening || claim.trim().length < 3) return;
    setSharpening(true);
    setSharpenError("");
    try {
      const res = await fetch("/api/sharpen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), evidenceType: evidenceType || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSharpenError(typeof data?.error === "string" ? data.error : "Couldn't sharpen that.");
        return;
      }
      setSharpen(data as SharpenedClaim);
    } catch {
      // Never block the search — the debater can always run what they typed.
      setSharpenError("Couldn't reach the AI. Search what you have, or try again.");
    } finally {
      setSharpening(false);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Validate the two required fields at the boundary.
    if (!evidenceType) {
      setError("Please select an evidence type.");
      return;
    }
    if (!claim.trim()) {
      setError("Please enter the claim you need evidence for.");
      return;
    }
    setError(null);

    onSearch({
      evidenceType: evidenceType as SearchParams["evidenceType"],
      claim: claim.trim(),
      sourceType: sourceType as SearchParams["sourceType"],
      publicationAge: publicationAge as SearchParams["publicationAge"],
      cardLength: cardLength as SearchParams["cardLength"],
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-5">
      <div>
        <label htmlFor="evidenceType" className={labelClasses}>
          Evidence Type <span className="text-red">*</span>
        </label>
        <select
          id="evidenceType"
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value)}
          className={inputClasses}
          required
        >
          <option value="" disabled>
            Select an evidence type…
          </option>
          {EVIDENCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="claim" className={labelClasses}>
          Claim <span className="text-red">*</span>
        </label>
        <textarea
          id="claim"
          value={claim}
          onChange={(e) => {
            setClaim(e.target.value);
            // Suggestions belong to the claim that produced them.
            if (sharpen) setSharpen(null);
          }}
          rows={3}
          placeholder='e.g. "Authoritarian governments evade sanctions."'
          className={`${inputClasses} resize-y`}
          required
        />

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSharpen}
            disabled={sharpening || claim.trim().length < 3}
            className="label-mono border-[3px] border-black bg-paper-2 px-3 py-1.5 text-[10px] disabled:opacity-40"
          >
            {sharpening ? "Thinking…" : "✦ Sharpen this claim"}
          </button>
          <span className="text-xs text-neutral-600">
            A vague claim searches badly — this names what&rsquo;s missing.
          </span>
        </div>

        {sharpenError ? (
          <p className="mt-2 text-xs text-red">{sharpenError}</p>
        ) : null}

        {sharpen ? (
          <div className="mt-3 border-[3px] border-black bg-paper-2 p-4">
            {sharpen.missing ? (
              <p className="mb-3 text-sm font-semibold">{sharpen.missing}</p>
            ) : (
              <p className="mb-3 text-sm font-semibold">
                That claim is already specific enough to search.
              </p>
            )}
            {sharpen.options.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {sharpen.options.map((option) => (
                  <li key={option.claim}>
                    {/* Picking REPLACES the claim — the debater stays the author
                        of what gets searched, rather than having it rewritten
                        underneath them. */}
                    <button
                      type="button"
                      onClick={() => {
                        setClaim(option.claim);
                        setSharpen(null);
                      }}
                      className="w-full border-2 border-black/20 bg-white p-3 text-left transition hover:border-black"
                    >
                      <span className="label-mono block text-[10px] text-neutral-600">
                        {option.angle}
                      </span>
                      <span className="mt-1 block text-sm">{option.claim}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => setSharpen(null)}
              className="label-mono mt-3 text-[10px] text-neutral-600 underline"
            >
              Keep what I wrote
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="sourceType" className={labelClasses}>
            Preferred Source
          </label>
          <select
            id="sourceType"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
            className={inputClasses}
          >
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="publicationAge" className={labelClasses}>
            Max Publication Age
          </label>
          <select
            id="publicationAge"
            value={publicationAge}
            onChange={(e) => setPublicationAge(e.target.value)}
            className={inputClasses}
          >
            {PUBLICATION_AGES.map((age) => (
              <option key={age} value={age}>
                {age}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cardLength" className={labelClasses}>
            Card Length
          </label>
          <select
            id="cardLength"
            value={cardLength}
            onChange={(e) => setCardLength(e.target.value)}
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
        {busy ? "Searching…" : "▸ Search"}
      </button>
    </form>
  );
}
