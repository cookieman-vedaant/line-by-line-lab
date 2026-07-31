"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useState } from "react";
import { verifyHuman } from "@/lib/apiClient";
import { turnstileSiteKey } from "@/lib/humanGate";

/**
 * Gates its children behind a Cloudflare Turnstile check. The check runs EVERY
 * time a visitor enters the Lab — verification lives in component state only, so
 * a reload or navigating away and back re-challenges. A bot can't solve it, so
 * it never gets the cookie the protected API routes require. When no Turnstile
 * site key is configured the gate is off and children render straight through.
 */
export default function HumanGate({ children }: { children: React.ReactNode }) {
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const siteKey = turnstileSiteKey();

  if (!siteKey || verified) return <>{children}</>;

  async function onToken(token: string) {
    setError(null);
    setVerifying(true);
    const outcome = await verifyHuman(token);
    setVerifying(false);
    if (outcome.ok) setVerified(true);
    else setError(outcome.error);
  }

  return (
    <section className="frame shadow-hard bg-paper-2 p-6 sm:p-8" aria-live="polite">
      <p className="label-mono flex items-center gap-2 text-[10px] text-accent">
        <span className="inline-block h-2 w-2 rotate-45 bg-red" />
        quick check
      </p>
      <h2 className="mt-3 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
        Verify you&apos;re human
      </h2>
      <p className="mt-2 max-w-md text-sm font-medium leading-snug text-ink/70">
        One quick check keeps bots from draining the free AI. It runs each time you open the Lab
        and only takes a second.
      </p>

      <div className="mt-5">
        <Turnstile
          siteKey={siteKey}
          onSuccess={onToken}
          onError={() => setError("The check couldn't load. Refresh and try again.")}
          onExpire={() => setError("The check expired — please solve it again.")}
          options={{ theme: "auto" }}
        />
      </div>

      {verifying && (
        <p className="label-mono mt-3 animate-pulse text-xs text-accent">▸ verifying…</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[11px] font-semibold text-red">
          {error}
        </p>
      )}
    </section>
  );
}
