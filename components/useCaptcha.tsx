"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useCallback, useRef, useState } from "react";
import { turnstileSiteKey } from "@/lib/humanGate";

/**
 * How long to wait for the widget to produce a token before giving up. Generous
 * on purpose: on a phone the challenge script can take several seconds to load
 * and run, and the old code treated "not solved yet" as "refused".
 */
const SOLVE_TIMEOUT_MS = 25_000;

/** What the caller shows when the check can't produce a token. */
export const CAPTCHA_FAILED_MESSAGE =
  "Couldn't finish the human check. Check your connection and try again.";

export interface Captcha {
  /** True when a site key is configured; false means the gate is off entirely. */
  required: boolean;
  /** Render this where the challenge should appear (null when the gate is off). */
  widget: React.ReactNode;
  /**
   * Resolve a FRESH, unspent token, waiting for the widget to finish if it is
   * still solving. Rejects if it never solves. Returns undefined when the gate
   * is off, which spreads into the Supabase options as "no captchaToken".
   */
  token: () => Promise<string | undefined>;
  /** Discard the spent token and mint a new challenge for the next attempt. */
  reset: () => void;
}

/**
 * One Turnstile handle, shared by every browser → Supabase auth call.
 *
 * Supabase CAPTCHA protection is ON for this project, which means signUp,
 * signInWithPassword, resend and resetPasswordForEmail are ALL rejected unless
 * they carry a token. Those calls go straight from the browser to Supabase and
 * never touch our server, so there is no server-side place to add one — every
 * call site has to pass it itself. Missing it on even one path is a hard,
 * 100%-reproducible failure, which is exactly what happened to the resend on the
 * confirmation page.
 *
 * The token is AWAITED rather than read from state. Reading state forced two bad
 * behaviours: a submit button that stayed disabled forever if the challenge
 * script never loaded (no way to sign in at all, and far more likely on a phone),
 * and a spurious "please complete the human check" the instant a spent token was
 * replaced — because the fresh widget had not finished solving yet.
 */
export function useCaptcha(): Captcha {
  const siteKey = turnstileSiteKey();
  const ref = useRef<TurnstileInstance | null>(null);
  // Remounting is what mints a new challenge; a Turnstile token is single use.
  const [nonce, setNonce] = useState(0);

  const token = useCallback(async () => {
    if (!siteKey) return undefined;
    const instance = ref.current;
    if (!instance) throw new Error("Turnstile is not mounted");
    return await instance.getResponsePromise(SOLVE_TIMEOUT_MS);
  }, [siteKey]);

  const reset = useCallback(() => setNonce((n) => n + 1), []);

  const widget = siteKey ? (
    <div className="flex justify-center">
      <Turnstile
        key={nonce}
        ref={ref}
        siteKey={siteKey}
        // "flexible" fills the container instead of a fixed 300px box, which
        // overflowed the sign-in card on narrow phones.
        options={{ theme: "auto", size: "flexible" }}
      />
    </div>
  ) : null;

  return { required: Boolean(siteKey), widget, token, reset };
}
