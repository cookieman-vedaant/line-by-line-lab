"use client";

/**
 * The Find tab before its first search of the session.
 *
 * It exists because the tab used to render a form above dead space, which told
 * a first-time debater nothing about what the tool does or where else to go.
 * Deliberately short: this is a tool, not a landing page, and it disappears for
 * good the moment a search runs.
 */
export default function SearchIntro({
  onCutCard,
  onSearchWiki,
}: {
  onCutCard: () => void;
  onSearchWiki: () => void;
}) {
  return (
    <div className="frame bg-paper-2 px-4 py-5 sm:px-6">
      <p className="label-mono text-[10px] text-ink/45">What happens when you search</p>

      <p className="mt-3 max-w-prose text-sm leading-relaxed">
        Your claim goes out to scholarly databases and the open web. Everything that comes back
        is a <span className="font-semibold">real paper</span> — the AI ranks them and explains
        why each one fits, but it never writes an article or a citation.
      </p>

      <div className="divide-t mt-5 flex flex-col gap-2.5 pt-4 sm:flex-row sm:gap-6">
        <button
          type="button"
          onClick={onCutCard}
          className="label-mono text-left text-[10px] text-ink/60 underline decoration-ink/25 underline-offset-4 hover:text-accent hover:decoration-accent"
        >
          Already have the article? Cut a card <span aria-hidden>→</span>
        </button>
        <button
          type="button"
          onClick={onSearchWiki}
          className="label-mono text-left text-[10px] text-ink/60 underline decoration-ink/25 underline-offset-4 hover:text-accent hover:decoration-accent"
        >
          Want prep someone disclosed? Search the wiki <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
