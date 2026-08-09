"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CAPTCHA_FAILED_MESSAGE, useCaptcha } from "@/components/useCaptcha";
import { checkAuthAttempt } from "@/lib/apiClient";
import { MIN_PASSWORD, PASSWORD_HINT } from "@/lib/passwordPolicy";
import { safeNext } from "@/lib/safeNext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const labelClasses = "label-mono mb-2 block text-xs text-ink";

type Mode = "signin" | "signup" | "reset";

/**
 * Where a confirmation link should land. Deliberately carries NO query of its
 * own: the email template appends `?token_hash=…&type=signup`, and /auth/confirm
 * already defaults its destination to the Lab when no `next` is supplied. A
 * `?next=` here would force the template to guess between `?` and `&`.
 */
function confirmRedirect(): string {
  return `${window.location.origin}/auth/confirm`;
}

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
  const captcha = useCaptcha();

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

    setResending(true);
    try {
      // Ask our own limiter first. The resend below goes straight from this
      // browser to Supabase, so this preflight is the only place we can cap how
      // many confirmation emails one address (or one network) can trigger.
      const allowed = await checkAuthAttempt("resend", email.trim());
      if (!allowed.ok) return setError(allowed.error);

      // Resend also goes browser → Supabase, so with CAPTCHA on it needs its own
      // unspent token, exactly like the main form. Awaited rather than read from
      // state: the widget was remounted moments ago by the attempt that revealed
      // this button, so it is usually still solving right when it's clicked.
      let captchaToken: string | undefined;
      try {
        captchaToken = await captcha.token();
      } catch {
        return setError(CAPTCHA_FAILED_MESSAGE);
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: confirmRedirect(), captchaToken },
      });
      if (error) return setError(error.message);
      setNotice("New confirmation link sent — you can open it on any device.");
    } finally {
      setResending(false);
      // The token is spent either way — force a fresh solve before the next try.
      captcha.reset();
    }
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

    const supabase = createSupabaseBrowserClient();
    const dest = safeNext(next);
    try {
      // Rate-limit the two modes that make Supabase SEND AN EMAIL. Sign-in is
      // excluded on purpose: it sends nothing, and throttling it per-email would
      // hand an attacker a way to lock a known victim out of their own account.
      if (mode === "signup" || mode === "reset") {
        const allowed = await checkAuthAttempt(mode, email.trim());
        if (!allowed.ok) return setError(allowed.error);
      }

      // Wait for the challenge rather than refusing when it hasn't finished. The
      // button used to be disabled until a token existed, which meant a Turnstile
      // script that never loaded — a blocked domain, a flaky phone connection —
      // left the user with a permanently dead Sign in button and no explanation.
      let captchaToken: string | undefined;
      try {
        captchaToken = await captcha.token();
      } catch {
        return setError(CAPTCHA_FAILED_MESSAGE);
      }

      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          // Land the recovery link DIRECTLY on the reset page (a client page). The
          // recovery token comes back in the URL #hash, which the server route
          // handler /auth/callback can't read — so routing through it bounced the
          // user back to login. The client page reads the token itself (a
          // token_hash, a PKCE ?code, or a hash) and requires a new password
          // before letting them proceed.
          redirectTo: `${window.location.origin}/reset-password`,
          captchaToken,
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
          options: { emailRedirectTo: confirmRedirect(), captchaToken },
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
          options: { captchaToken },
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
      captcha.reset(); // token is single-use — a retry needs a fresh solve
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
              placeholder={PASSWORD_HINT}
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

        {captcha.widget}

        {/* Disabled only while a request is in flight. It must NOT wait on the
            captcha: the submit handler awaits the token itself, so a challenge
            that is slow (or never loads at all) produces a real error message
            instead of a button that can never be pressed. */}
        <button
          type="submit"
          disabled={busy}
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
