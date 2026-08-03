"use client";

import { useRef, useState } from "react";
import { submitFeedback } from "@/lib/apiClient";
import { SITE } from "@/lib/siteContent";

/**
 * "Feedback" → a real in-app form.
 *
 * Replaces a `mailto:` link, which silently did nothing for any user whose OS
 * has no registered mail client — the default on Windows 11. There was no error
 * and no navigation, so the button simply appeared broken.
 *
 * Uses a native <dialog> with showModal(): it renders in the browser's TOP
 * LAYER, so it can't be trapped beneath the page's .reveal transforms the way an
 * in-tree dropdown would be (the stacking-context problem that forced
 * ThemeStudio to portal into document.body). Focus trapping, Escape-to-close,
 * and the backdrop all come for free.
 */

type Kind = "bug" | "idea" | "other";

const KINDS: { value: Kind; label: string }[] = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "I have an idea" },
  { value: "other", label: "Something else" },
];

export default function FeedbackButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function open() {
    setError(null);
    setSent(false);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    // Reset only after a successful send, so a failed attempt doesn't lose what
    // the user typed.
    if (sent) {
      setMessage("");
      setContactEmail("");
      setKind("bug");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 5) {
      setError("Tell us a bit more — at least a sentence.");
      return;
    }
    // Validate the optional email OURSELVES. The form is noValidate (see the
    // <form> below) precisely so the browser's native validation can't block
    // submission with a tooltip we don't control and can't style.
    const trimmedEmail = contactEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("That email doesn't look right. Fix it, or clear the field to send without one.");
      return;
    }
    setBusy(true);
    const res = await submitFeedback({
      kind,
      message: message.trim(),
      // Which tool they were on. Saves a round trip of "where were you?".
      page: typeof window !== "undefined" ? window.location.pathname : undefined,
      contactEmail: trimmedEmail || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  }

  const inputClasses =
    "w-full frame bg-paper px-3 py-2 text-sm font-medium text-ink " +
    "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="label-mono frame btn-press inline-flex bg-paper-2 px-2.5 py-1.5 text-[10px] font-bold text-ink hover:text-accent"
      >
        {/* Visible at EVERY width. It was previously `hidden sm:inline-flex`,
            which meant the only way to report a bug vanished on the narrow
            windows where bugs are most likely to show up. The label shortens on
            mobile instead of the control disappearing. */}
        <span className="sm:hidden" aria-hidden>
          ⚑
        </span>
        <span className="hidden sm:inline">Feedback</span>
        <span className="sr-only">Send feedback</span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={close}
        aria-labelledby="feedback-title"
        className="frame shadow-hard m-auto w-[min(28rem,92vw)] bg-paper-2 p-0 text-ink backdrop:bg-black/50"
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="feedback-title" className="font-display text-xl font-extrabold tracking-tight">
                {sent ? "Thanks — got it." : "Tell us what's up"}
              </h2>
              {!sent && (
                <p className="mt-1 text-xs font-medium text-ink/70">
                  Bugs, ideas, complaints. It goes straight to the person who builds this.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="label-mono frame btn-press bg-paper px-2 py-1 text-[10px] font-bold text-ink hover:text-accent"
            >
              ✕
            </button>
          </div>

          {sent ? (
            <div className="mt-6">
              <p className="text-sm font-medium leading-relaxed text-ink/80">
                Your report is logged. If you left an email we&apos;ll reply when it&apos;s sorted.
              </p>
              <button
                type="button"
                onClick={close}
                className="btn-press frame shadow-hard mt-5 w-full bg-accent px-6 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-paper"
              >
                Done
              </button>
            </div>
          ) : (
            // noValidate: without it, <input type="email"> makes the BROWSER
            // refuse to submit on a half-typed address — silently, with a native
            // tooltip and no call to onSubmit. That reads as "the send button
            // does nothing". We validate in onSubmit instead, where we can show
            // a real message. AuthForm does the same, for the same reason.
            <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4">
              <fieldset>
                <legend className="label-mono mb-2 block text-xs text-ink">Type</legend>
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKind(k.value)}
                      aria-pressed={kind === k.value}
                      className={`btn-press frame px-3 py-1.5 font-display text-xs font-bold ${
                        kind === k.value ? "bg-accent text-paper" : "bg-paper text-ink"
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div>
                <label htmlFor="feedback-message" className="label-mono mb-2 block text-xs text-ink">
                  What happened?
                </label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="The more specific, the faster it gets fixed. What were you doing, and what did you expect instead?"
                  className={`${inputClasses} resize-y`}
                />
              </div>

              <div>
                <label htmlFor="feedback-email" className="label-mono mb-2 block text-xs text-ink">
                  Email for a reply <span className="text-ink/50">(optional)</span>
                </label>
                <input
                  id="feedback-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@school.edu"
                  className={inputClasses}
                />
              </div>

              {error && (
                <div role="alert" className="frame bg-red px-3 py-2 text-xs font-semibold text-white">
                  <p>{error}</p>
                  {/* Never leave a bug report as a dead end. If the endpoint
                      itself is down, give the user a copyable address rather
                      than a mailto: link — a mailto does nothing at all on a
                      machine with no mail client registered, which is what
                      broke the original version of this button. */}
                  <p className="mt-1.5 font-medium opacity-90">
                    Still stuck? Copy your message and email it to{" "}
                    <span className="select-all underline">{SITE.contactEmail}</span>
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="btn-press frame shadow-hard bg-accent px-6 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-paper disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send it →"}
              </button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
