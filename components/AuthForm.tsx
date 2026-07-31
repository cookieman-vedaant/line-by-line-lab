"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

/**
 * Email + password sign-in / sign-up. Uses the browser Supabase client, which
 * sets the shared session cookie the server + middleware read. On success it
 * routes into the app (or the `next` path the middleware wanted).
 */
export default function AuthForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim() || password.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const dest = next && next.startsWith("/") ? next : "/lab";

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
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

  return (
    <div className="frame shadow-hard w-full max-w-sm bg-paper-2 p-6">
      <div className="mb-4 flex gap-2">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setNotice(null);
            }}
            aria-pressed={mode === m}
            className={`btn-press frame flex-1 px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide ${
              mode === m ? "bg-accent text-paper" : "bg-paper text-ink"
            }`}
          >
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>

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
          {busy ? "…" : mode === "signin" ? "Sign in →" : "Create account →"}
        </button>
      </form>
    </div>
  );
}
