"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkAuthAttempt } from "@/lib/apiClient";
import { turnstileSiteKey } from "@/lib/humanGate";
import { safeNext } from "@/lib/safeNext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

type Mode = "signin" | "signup" | "reset";

/**
 * Must stay >= Supabase's `password_min_length` (set to 8 in the project's auth
 * config). If the client allows a shorter password than the server accepts, the
 * user gets a rejection from Supabase for a rule our own form told them they'd
 * satisfied — so these two numbers have to move together.
 */
const MIN_PASSWORD = 8;

/**
 * Email + password sign-in / sign-up, plus a "forgot password" flow. Uses the
 * browser Supabase client, which sets the shared session cookie the server +
 * proxy read. On success it routes into the app (or the `next` path the
 * proxy wanted).
 *
 * Both email flows deliberately land on CLIENT pages — "reset" on
 * /reset-password, signup confirmation on /auth/confirm. Supabase can deliver
 * the credential in the URL fragment, which no server route handler can read;
 * recovery learned this first and confirmation was still paying for it.
 */
export default function AuthForm({ next }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Shown once we know an unconfirmed account exists for this address. Survives a
  // mode switch on purpose: the user is usually sent from signup to signin, and
  // the offer to resend has to travel with them.
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);

  // Turnstile anti-brute-force gate (no-op when no site key is configured). A
  // fresh, single-use token is required for each sign-in / sign-up / reset
  // attempt, so the endpoints can't be scripted or brute-forced.
  const siteKey = turnstileSiteKey();
  const [token, setToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);

  function resetCaptcha() {
    setToken(null);
    setCaptchaNonce((n) => n + 1); // remount the widget → new token for the next try
  }

  /**
   * The Turnstile token is handed to SUPABASE, not to our own /api/verify-human.
   *
   * This is the key detail: a Turnstile token is SINGLE-USE. We previously spent
   * it verifying against Cloudflare ourselves to mint the `lbl-human` cookie,
   * which meant the token was already redeemed by the time Supabase saw it — so
   * turning on Supabase's own CAPTCHA protection would have rejected every
   * single auth attempt.
   *
   * Supabase CAPTCHA is the defense that actually matters here, because
   * signUp/signIn/resend go BROWSER → SUPABASE directly and never touch our
   * server; it's the only layer an attacker using the public anon key can't
   * skip. So the token goes there. The `lbl-human` cookie that guards our AI
   * endpoints is still minted by <HumanGate> on /lab, which runs its own
   * challenge — no coverage is lost.
   */
  function captchaOptions(): { captchaToken?: string } {
    return siteKey && token ? { captchaToken: token } : {};
  }

  /** Block the attempt early if the gate is on but unsolved. */
  function ensureSolved(): boolean {
    if (!siteKey) return true;
    if (!token) {
      setError("Please complete the human check below.");
      return false;
    }
    return true;
  }

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  /**
   * Send a fresh confirmation link. This is the recovery path that was missing:
   * the old copy told users to "sign up again", which for an address that is
   * already registered does nothing at all except mint a new password that
   * Supabase silently discards.
   */
  async function onResend() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("Enter your email first, then resend.");
      return;
    }
    // Resend also goes browser → Supabase, so with CAPTCHA on it needs its own
    // unspent token, exactly like the main form.
    if (!ensureSolved()) return;

    setResending(true);

    // Ask our own limiter first. The resend below goes straight from this
    // browser to Supabase, so this preflight is the only place we can cap how
    // many confirmation emails one address (or one network) can trigger.
    const allowed = await checkAuthAttempt("resend", email.trim());
    if (!allowed.ok) {
      setResending(false);
      return setError(allowed.error);
    }

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=%2Flab`,
        ...captchaOptions(),
      },
    });
    setResending(false);
    // The token is spent either way — force a fresh solve before the next try.
    resetCaptcha();
    if (error) return setError(error.message);
    setNotice("New confirmation link sent. Open it on this device if you can.");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Validate fields first, so a user fixes inputs before spending a token.
    if (mode === "reset") {
      if (!email.trim()) {
        setError("Enter your email to get a reset link.");
        return;
      }
    } else if (!email.trim() || password.length < MIN_PASSWORD) {
      setError(`Enter your email and a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    if (!ensureSolved()) {
      setBusy(false);
      return;
    }

    // Rate-limit the two modes that make Supabase SEND AN EMAIL. Sign-in is
    // excluded on purpose: it sends nothing, and throttling it per-email would
    // hand an attacker a way to lock a known victim out of their own account.
    if (mode === "signup" || mode === "reset") {
      const allowed = await checkAuthAttempt(mode, email.trim());
      if (!allowed.ok) {
        setBusy(false);
        resetCaptcha();
        return setError(allowed.error);
      }
    }

    const supabase = createSupabaseBrowserClient();
    const dest = safeNext(next);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          // Land the recovery link DIRECTLY on the reset page (a client page). The
          // recovery token comes back in the URL #hash, which the server route
          // handler /auth/callback can't read — so routing through it bounced the
          // user back to login. The client page reads the token itself (hash OR a
          // PKCE ?code) and requires a new password before letting them proceed.
          redirectTo: `${window.location.origin}/reset-password`,
          ...captchaOptions(),
        });
        if (error) return setError(error.message);
        // Generic message either way — never reveal whether an account exists.
        setNotice("If an account exists for that email, a reset link is on its way. Check your inbox.");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          // Land on the CLIENT confirm page, not the server callback: one of the
          // shapes Supabase sends the credential in lives in the URL fragment,
          // which a route handler can never see. Requires this origin to be in
          // Supabase's Redirect URLs, or it falls back to the Site URL.
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=%2Flab`,
            ...captchaOptions(),
          },
        });
        if (error) return setError(error.message);

        // With confirmations on, signing up with an address that ALREADY exists
        // returns a success carrying an obfuscated user — Supabase does that so
        // an attacker can't enumerate accounts. It does not set the password.
        // Reporting it as "account created" is what stranded people: told to
        // "sign up again" after a failed confirmation, they'd re-register with a
        // new password that was never stored, and every subsequent sign-in came
        // back "Invalid login credentials" against an account that plainly
        // existed in the dashboard.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setMode("signin");
          setCanResend(true);
          setNotice(
            "That email is already registered. Sign in below with your original password — or resend the confirmation link if you never confirmed it.",
          );
          return;
        }

        if (!data.session) {
          setMode("signin");
          setCanResend(true);
          setNotice("Account created. Check your email for the confirmation link, then sign in.");
          return;
        }
        router.push(dest);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
          options: captchaOptions(),
        });
        if (error) {
          // An unconfirmed account is a fixable state, not a bad password. Say so
          // and offer the fix, rather than leaving the user to guess.
          if (error.code === "email_not_confirmed") {
            setCanResend(true);
            return setError("This email hasn't been confirmed yet — resend the link below.");
          }
          return setError(error.message);
        }
        router.push(dest);
        router.refresh();
      }
    } finally {
      setBusy(false);
      resetCaptcha(); // token is single-use — a retry needs a fresh solve
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
              placeholder={`at least ${MIN_PASSWORD} characters`}
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

        {canResend && mode !== "reset" && (
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="label-mono self-start text-[11px] text-accent hover:underline disabled:opacity-60"
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </button>
        )}

        {siteKey && (
          <div className="flex justify-center">
            <Turnstile
              key={captchaNonce}
              siteKey={siteKey}
              onSuccess={setToken}
              onError={() => {
                setToken(null);
                setError("The check couldn't load. Refresh and try again.");
              }}
              onExpire={() => setToken(null)}
              options={{ theme: "auto" }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={busy || (!!siteKey && !token)}
          className="btn-press frame bg-accent px-6 py-3 font-display text-base font-bold
            uppercase tracking-wide text-paper disabled:opacity-60"
        >
          {busy ? "…" : submitLabel}
        </button>

        {mode !== "reset" && (
          <p className="label-mono text-center text-[10px] leading-relaxed text-ink/50">
            By continuing, you agree to our{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>{" "}
            and confirm you&apos;re 13 or older.
          </p>
        )}

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
