"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

type Mode = "signin" | "signup" | "reset";

/**
 * Email + password sign-in / sign-up, plus a "forgot password" flow. Uses the
 * browser Supabase client, which sets the shared session cookie the server +
 * middleware read. On success it routes into the app (or the `next` path the
 * middleware wanted). "Reset" emails a recovery link that lands on
 * /auth/callback → /reset-password (see components/ResetPasswordForm).
 */
export default function AuthForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const supabase = createSupabaseBrowserClient();

    // Forgot password: email a recovery link, no password needed.
    if (mode === "reset") {
      if (!email.trim()) {
        setError("Enter your email to get a reset link.");
        return;
      }
      setBusy(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        // Land the recovery link DIRECTLY on the reset page (a client page). The
        // recovery token comes back in the URL #hash, which the server route
        // handler /auth/callback can't read — so routing through it bounced the
        // user back to login. The client page reads the token itself (hash OR a
        // PKCE ?code) and requires a new password before letting them proceed.
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setBusy(false);
      if (error) return setError(error.message);
      // Generic message either way — never reveal whether an account exists.
      setNotice("If an account exists for that email, a reset link is on its way. Check your inbox.");
      return;
    }

    if (!email.trim() || password.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    const dest = next && next.startsWith("/") ? next : "/lab";

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // Send the confirmation link back to THIS origin's callback (prod when
        // signing up on prod). Requires the origin to be in Supabase's allowed
        // Redirect URLs; otherwise Supabase falls back to the Site URL.
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Flab` },
      });
      setBusy(false);
      if (error) return setError(error.message);
      if (!data.session) {
        setNotice("Account created — check your email to confirm, then sign in.");
        setMode("signin");
        return;
      }
      router.push(dest);
      router.refresh();
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (error) return setError(error.message);
      router.push(dest);
      router.refresh();
    }
  }

  const submitLabel =
    mode === "signin" ? "Sign in →" : mode === "signup" ? "Create account →" : "Send reset link →";

  return (
    <div className="frame shadow-hard w-full max-w-sm bg-paper-2 p-6">
      {mode === "reset" ? (
        <div className="mb-4">
          <p className="font-display text-lg font-bold">Reset your password</p>
          <p className="mt-1 text-xs font-medium text-ink/70">
            Enter your email and we&apos;ll send you a link to set a new password.
          </p>
        </div>
      ) : (
        <div className="mb-4 flex gap-2">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              className={`btn-press frame flex-1 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide ${
                mode === m ? "bg-accent text-paper" : "bg-paper text-ink"
              }`}
            >
              {m === "signin" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="auth-email" className={labelClasses}>
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            className={inputClasses}
          />
        </div>

        {mode !== "reset" && (
          <div>
            <label htmlFor="auth-password" className={labelClasses}>
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="at least 6 characters"
              className={inputClasses}
            />
          </div>
        )}

        {mode === "signin" && (
          <button
            type="button"
            onClick={() => switchMode("reset")}
            className="label-mono self-start text-[11px] text-accent hover:underline"
          >
            Forgot your password?
          </button>
        )}

        {error && (
          <p role="alert" className="frame bg-red px-3 py-2 text-xs font-semibold text-white">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="frame bg-yellow px-3 py-2 text-xs font-medium text-black">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn-press frame bg-accent px-6 py-3 font-display text-base font-bold
            uppercase tracking-wide text-paper disabled:opacity-60"
        >
          {busy ? "…" : submitLabel}
        </button>

        {mode === "reset" && (
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="label-mono self-center text-[11px] text-ink/60 hover:text-accent hover:underline"
          >
            ← Back to sign in
          </button>
        )}
      </form>
    </div>
  );
}
