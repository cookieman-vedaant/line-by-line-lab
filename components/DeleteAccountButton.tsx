"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteAccount } from "@/lib/apiClient";

/**
 * Self-service account deletion.
 *
 * The privacy policy already told users they could delete their data (a TDPSA
 * right, and a COPPA/SCOPE-Act obligation given the app's under-18 users), but
 * nothing implemented it. A stated right with no mechanism is a compliance gap,
 * not a missing nice-to-have.
 *
 * Deletion is irreversible, so the confirmation is deliberately high-friction:
 * the user must type DELETE. A plain "are you sure?" is too easy to click
 * through by muscle memory.
 */
export default function DeleteAccountButton() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CONFIRM_WORD = "DELETE";
  const canDelete = confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  function open() {
    setConfirmText("");
    setError(null);
    dialogRef.current?.showModal();
  }

  async function onConfirm() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    const res = await deleteAccount();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    dialogRef.current?.close();
    // Full reload rather than a client transition: the session is gone, and any
    // cached user data in memory must go with it.
    window.location.href = "/";
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="label-mono self-start text-[11px] text-ink/50 underline hover:text-red"
      >
        Delete my account
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="delete-account-title"
        className="frame shadow-hard m-auto w-[min(26rem,92vw)] bg-paper-2 p-0 text-ink backdrop:bg-black/60"
      >
        <div className="p-6">
          <h2 id="delete-account-title" className="font-display text-xl font-extrabold tracking-tight">
            Delete your account?
          </h2>
          <p className="mt-3 text-sm font-medium leading-relaxed text-ink/80">
            This erases your account, your Round Log, and your debater profile. It
            cannot be undone.
          </p>

          <label htmlFor="delete-confirm" className="label-mono mt-5 block text-xs text-ink">
            Type <span className="text-red">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            className="mt-2 w-full frame bg-paper px-3 py-2 text-sm font-medium text-ink focus:border-red focus:outline-none focus:ring-2 focus:ring-red/35"
          />

          {error && (
            <p role="alert" className="frame mt-4 bg-red px-3 py-2 text-xs font-semibold text-white">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="btn-press frame flex-1 bg-paper px-4 py-2.5 font-display text-sm font-bold text-ink"
            >
              Keep my account
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canDelete}
              className="btn-press frame flex-1 bg-red px-4 py-2.5 font-display text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
