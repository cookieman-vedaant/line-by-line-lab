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
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const labelClasses = "mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

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
          Evidence Type <span className="text-red-500">*</span>
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
          Claim <span className="text-red-500">*</span>
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
        {busy ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
