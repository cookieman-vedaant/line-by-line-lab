"use client";

import { useState } from "react";
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
  const [sourceType, setSourceType] = useState("Any");
  const [publicationAge, setPublicationAge] = useState("Any");
  const [cardLength, setCardLength] = useState("Medium");
  const [error, setError] = useState<string | null>(null);

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
          onChange={(e) => setClaim(e.target.value)}
          rows={3}
          placeholder='e.g. "Authoritarian governments evade sanctions."'
          className={`${inputClasses} resize-y`}
          required
        />
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
