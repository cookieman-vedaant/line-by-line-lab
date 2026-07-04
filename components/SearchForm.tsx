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

export default function SearchForm() {
  const [evidenceType, setEvidenceType] = useState("");
  const [claim, setClaim] = useState("");
  const [sourceType, setSourceType] = useState("Any");
  const [publicationAge, setPublicationAge] = useState("Any");
  const [cardLength, setCardLength] = useState("Medium");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(null);

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

    const params: SearchParams = {
      evidenceType: evidenceType as SearchParams["evidenceType"],
      claim: claim.trim(),
      sourceType: sourceType as SearchParams["sourceType"],
      publicationAge: publicationAge as SearchParams["publicationAge"],
      cardLength: cardLength as SearchParams["cardLength"],
    };

    // Phase 1: capture and display the params. Phase 2 wires this to /api/search.
    setSubmitted(params);
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
        className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition
          hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Search
      </button>

      {submitted && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            Search captured — article search arrives in Phase 2.
          </p>
          <dl className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="inline font-medium">Evidence type:</dt>{" "}
              <dd className="inline">{submitted.evidenceType}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Claim:</dt>{" "}
              <dd className="inline">{submitted.claim}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Filters:</dt>{" "}
              <dd className="inline">
                {submitted.sourceType} · {submitted.publicationAge} · {submitted.cardLength}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </form>
  );
}
