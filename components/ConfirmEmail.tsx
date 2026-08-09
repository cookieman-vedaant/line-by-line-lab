"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTCHA_FAILED_MESSAGE, useCaptcha } from "@/components/useCaptcha";
import { checkAuthAttempt } from "@/lib/apiClient";
import { safeNext } from "@/lib/safeNext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const inputClasses =
  "w-full frame bg-paper-2 px-3 py-2.5 text-sm font-medium text-ink " +
  "placeholder:text-ink/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35";
const cardClasses = "frame shadow-hard w-full max-w-sm bg-paper-2 p-6";

/**
 * "confirmed-only" is the cross-device case and it is a SUCCESS, not a failure.
 * A `?code=` link has already been through Supabase's /verify endpoint by the
 * time it reaches us, which is what marks the address confirmed; the `code` is
 * only the second half, an offer of a session. Exchanging it needs the PKCE
 * verifier held by the browser that signed up, so opening the mail on a phone
 * can never complete it — but the account is confirmed all the same. Reporting
 * that as "that link didn't go through" was the bug: it sent people to a resend
 * form for a confirmation they had already completed.
 */
type Phase = "working" | "ok" | "confirmed-only" | "failed";

/**
 * Where an email-confirmation link lands.
 *
 * This is a CLIENT page on purpose. Supabase can deliver the credential in three
 * different shapes and one of them — `#access_token=…` — lives in the URL
 * fragment, which is never sent to the server. A route handler cannot see it at
 * all, so a link of that shape could only ever fail there. The same lesson was
 * already learned once in this codebase for password recovery (see AuthForm's
 * note on redirectTo); signup confirmation had kept the server-only path.
 *
 * All three are handled here:
 *   ?token_hash=&type=  → verifyOtp   (preferred: no verifier needed, so it works
 *                                      when the email is opened on another device)
 *   ?code=              → exchangeCodeForSession (PKCE; needs the verifier cookie
 *                                      set by the browser that signed up)
 *   #access_token=…     → the browser client picks it up on load
 *
 * Failure is never a dead end: a bad or already-spent link offers a resend rather
 * than telling the user to sign up again, which silently does nothing when the
 * address is already registered.
 */
export default function ConfirmEmail() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("working");
  const [detail, setDetail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const captcha = useCaptcha();
  const ran = useRef(false);

  const succeed = useCallback(
    (next: string) => {
      setPhase("ok");
      // Drop the token from the address bar before moving on, so a back button
      // or a shared URL can't replay a spent credential.
      window.history.replaceState(null, "", "/auth/confirm");
      router.replace(next);
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke would spend the token twice
    ran.current = true;

    const supabase = createSupabaseBrowserClient();
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    // router.replace() resolves a protocol-relative value like "//evil.com" as an
    // external origin, so this must be validated properly, not just for a slash.
    const next = safeNext(params.get("next"));

    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    const code = params.get("code");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    // Supabase reports a refused link in the query or the fragment depending on
    // which leg failed; surface its reason rather than a generic guess.
    const errDescription =
      params.get("error_description") ?? hash.get("error_description") ?? null;

    async function run() {
      if (errDescription) {
        setDetail(errDescription);
        setPhase("failed");
        return;
      }

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type: type as "signup" | "email" | "recovery" | "email_change" | "invite" | "magiclink",
          token_hash: tokenHash,
        });
        if (!error) return succeed(next);
        setDetail(error.message);
        setPhase("failed");
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) return succeed(next);
        // The address IS confirmed at this point — see the Phase note above.
        // All that failed is the automatic sign-in, so ask for the password
        // rather than for another confirmation email.
        setPhase("confirmed-only");
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) return succeed(next);
        setDetail(error.message);
        setPhase("failed");
        return;
      }

      // No recognisable credential in the URL. The browser client processes a
      // fragment token by itself on load, so give that a moment before deciding.
      const { data } = await supabase.auth.getSession();
      if (data.session) return succeed(next);

      const sub = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) succeed(next);
      });
      const timer = setTimeout(() => {
        sub.data.subscription.unsubscribe();
        setPhase("failed");
      }, 3000);
      return () => {
        sub.data.subscription.unsubscribe();
        clearTimeout(timer);
      };
    }

    void run();
  }, [succeed]);

  async function onResend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResendError(null);
    if (!email.trim()) {
      setResendError("Enter the email you signed up with.");
      return;
    }
    setResending(true);
    try {
      // Same preflight as AuthForm's resend — this is the second entry point to
      // the same email-sending call, and an uncapped one would make the other
      // cap pointless.
      const allowed = await checkAuthAttempt("resend", email.trim());
      if (!allowed.ok) return setResendError(allowed.error);

      // Supabase CAPTCHA protection is ON, and resend goes browser → Supabase
      // without touching our server, so the token has to be attached HERE. It
      // wasn't, and this page renders no challenge at all — so every resend from
      // the one screen that exists to recover a failed confirmation was rejected
      // with a captcha error. That is the whole bug.
      let captchaToken: string | undefined;
      try {
        captchaToken = await captcha.token();
      } catch {
        return setResendError(CAPTCHA_FAILED_MESSAGE);
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/confirm`, captchaToken },
      });
      if (error) return setResendError(error.message);
      setResent(true);
    } finally {
      setResending(false);
      captcha.reset(); // single-use, spent either way
    }
  }

  if (phase === "working" || phase === "ok") {
    return (
      <div className={cardClasses}>
        <p className="font-display text-lg font-bold">
          {phase === "ok" ? "Confirmed. Taking you in…" : "Confirming your email…"}
        </p>
        <p className="mt-1 text-xs font-medium text-ink/70">This only takes a second.</p>
      </div>
    );
  }

  // Confirmed, but on a device that can't finish the sign-in itself. One step
  // left, and it's the ordinary one — so say so plainly and point at it.
  if (phase === "confirmed-only") {
    return (
      <div className={cardClasses}>
        <p className="font-display text-lg font-bold">Email confirmed ✓</p>
        <p className="mt-2 text-sm font-medium leading-snug text-ink/70">
          Your account is ready. You opened this link on a different device or browser than you
          signed up on, so sign in with your password to finish.
        </p>
        <Link
          href="/"
          className="btn-press frame shadow-hard mt-4 inline-flex items-center justify-center bg-accent px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-paper"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className={cardClasses}>
      <p className="font-display text-lg font-bold">That link didn&apos;t go through</p>
      <p className="mt-1 text-xs font-medium text-ink/70">
        Confirmation links are single use and expire. If you already confirmed, just sign in.
      </p>
      {detail && (
        <p className="label-mono mt-3 text-[10px] leading-relaxed text-ink/55">{detail}</p>
      )}

      {resent ? (
        <p role="status" className="frame mt-4 bg-accent/10 px-3 py-2 text-xs font-semibold">
          New confirmation email sent — you can open it on any device.
        </p>
      ) : (
        <form onSubmit={onResend} className="mt-4 flex flex-col gap-3">
          <div>
            <label htmlFor="confirm-email" className="label-mono mb-2 block text-xs text-ink">
              Send a new link
            </label>
            <input
              id="confirm-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@school.edu"
              className={inputClasses}
            />
          </div>
          {resendError && (
            <p role="alert" className="frame bg-red px-3 py-2 text-xs font-semibold text-white">
              {resendError}
            </p>
          )}
          {captcha.widget}
          <button
            type="submit"
            disabled={resending}
            className="btn-press frame shadow-hard inline-flex items-center justify-center bg-accent px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-paper disabled:opacity-60"
          >
            {resending ? "Sending…" : "Resend confirmation"}
          </button>
        </form>
      )}

      <Link href="/" className="label-mono mt-4 inline-block text-[11px] text-accent underline">
        Back to sign in
      </Link>
    </div>
  );
}
