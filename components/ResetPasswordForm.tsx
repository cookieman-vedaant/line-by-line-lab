"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PASSWORD_HINT, passwordProblem } from "@/lib/passwordPolicy";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";
const cardClasses = "frame shadow-hard w-full max-w-sm bg-paper-2 p-6";

/**
 * Set a new password. Reached from a password-reset email, which can deliver the
 * credential in three shapes:
 *
 *   ?token_hash=&type=recovery → verifyOtp. The ONLY shape that works when the
 *                                email is opened somewhere other than the
 *                                browser that asked for the reset — which on a
 *                                phone is the normal case, not the edge case.
 *   ?code=                     → PKCE. Needs the verifier cookie held by the
 *                                requesting browser; the client exchanges it
 *                                automatically via detectSessionInUrl.
 *   #access_token=             → picked up by the client on load.
 *
 * Whichever lands, the result is a recovery session, and that session is what
 * lets updateUser change the password. No session → "invalid/expired".
 */
export default function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke would spend the token twice
    ran.current = true;

    const supabase = createSupabaseBrowserClient();
    let settled = false;
    const markReady = () => {
      settled = true;
      setPhase("ready");
    };

    // A recovery token in the URL fires PASSWORD_RECOVERY; a cookie session (from
    // the /auth/callback exchange) is already present. Either means we can reset.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session || event === "PASSWORD_RECOVERY") markReady();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });

    // The device-independent shape. Handled explicitly because nothing else
    // does: detectSessionInUrl covers `?code=` and the hash, but a token_hash
    // has to be redeemed by hand.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      void supabase.auth
        .verifyOtp({ type: "recovery", token_hash: tokenHash })
        .then(({ error }) => {
          if (!error) {
            // Drop the single-use token from the address bar so a back button
            // or a shared URL can't replay it.
            window.history.replaceState(null, "", window.location.pathname);
            markReady();
          }
        });
    }

    // No session shortly after load → the link was bad, expired, or opened in a
    // different browser than it was requested from.
    const timer = setTimeout(() => {
      if (!settled) setPhase("invalid");
    }, 3500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Shared with the sign-up form and kept >= Supabase's password_min_length.
    // This form allowed 6 while the server demanded 8, so a 6- or 7-character
    // reset sailed past our own validation and was rejected at the last step.
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true);
    setTimeout(() => {
      router.push("/lab");
      router.refresh();
    }, 1200);
  }

  if (phase === "checking") {
    return (
      <div className={cardClasses}>
        <p className="label-mono animate-pulse text-sm text-accent">▸ verifying your reset link…</p>
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className={`${cardClasses} text-center`}>
        <p className="font-display text-lg font-bold">Reset link invalid or expired</p>
        <p className="mt-2 text-sm font-medium text-ink/70">
          This password-reset link didn&apos;t work — it may have expired, already been used, or
          been opened in a different browser than you requested it from. Request a new one.
        </p>
        <Link
          href="/"
          className="btn-press frame mt-4 inline-block bg-accent px-5 py-2.5 font-display text-sm
            font-bold uppercase tracking-wide text-paper"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className={cardClasses}>
      <p className="font-display text-lg font-bold">Set a new password</p>
      <p className="mt-1 text-xs font-medium text-ink/70">Choose a new password for your account.</p>

      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <div>
          <label htmlFor="new-password" className={labelClasses}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={PASSWORD_HINT}
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className={labelClasses}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="re-enter your password"
            className={inputClasses}
          />
        </div>

        {error && (
          <p role="alert" className="frame bg-red px-3 py-2 text-xs font-semibold text-white">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="frame bg-yellow px-3 py-2 text-xs font-medium text-black">
            Password updated — taking you to the Lab…
          </p>
        )}

        <button
          type="submit"
          disabled={busy || done}
          className="btn-press frame bg-accent px-6 py-3 font-display text-base font-bold
            uppercase tracking-wide text-paper disabled:opacity-60"
        >
          {busy ? "…" : "Update password →"}
        </button>
      </form>
    </div>
  );
}
