import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import Scales from "@/components/marketing/Scales";
import SourceField from "@/components/marketing/SourceField";
import Tear from "@/components/marketing/Tear";
import Verifier from "@/components/marketing/Verifier";
import TheRound from "@/components/marketing/TheRound";
import {
  FinalCta,
  LandingFooter,
  Mission,
  Pricing,
  StatBar,
  Toolkit,
  ToolStrip,
} from "@/components/marketing/LandingSections";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Line by Line Lab: prep like the biggest program in the room",
  description:
    "Find reputable evidence, cut verbatim debate-ready cards, re-highlight opponents, and get a real AI coach. Free to start. Built to close the prep gap for every LD, PF, and Policy debater.",
};

type SearchParams = Promise<{ next?: string | string[]; error?: string | string[] }>;

/**
 * The only part of this page that varies by request: which box the hero shows.
 * It reads the auth cookie and the search params, so it is deliberately the one
 * thing behind a Suspense boundary — everything around it is identical for every
 * visitor and prerenders into the static shell. Keep request-scoped reads
 * (cookies, headers, searchParams) inside here or the whole page goes dynamic.
 */
async function HeroSlot({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return (
      <div className="frame shadow-hard w-full max-w-sm bg-paper-2 p-6">
        <p className="label-mono text-[11px] text-ink/60">Signed in as {user.email}</p>
        <Link
          href="/lab"
          className="btn-press frame shadow-hard mt-4 inline-flex w-full items-center justify-center gap-2 bg-accent px-7 py-4 font-display text-lg font-bold uppercase tracking-wide text-paper"
        >
          Enter the Lab <span aria-hidden>→</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <p className="label-mono text-center text-[11px] text-ink/60 lg:text-right">
        Start free. No credit card.
      </p>
      {error && (
        <p role="alert" className="frame bg-red px-3 py-2 text-xs font-semibold text-white">
          {error}
        </p>
      )}
      <AuthForm next={next} />
    </div>
  );
}

/**
 * Holds the hero slot's footprint while it streams, so the shell doesn't reflow
 * when the real box arrives. Sized to the sign-in form, which is the case almost
 * every visitor lands in.
 */
function HeroSlotFallback() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3" aria-hidden>
      <p className="label-mono text-center text-[11px] text-ink/60 lg:text-right">
        Start free. No credit card.
      </p>
      <div className="frame shadow-hard w-full bg-paper-2 p-6">
        <div className="mb-4 flex gap-2">
          <div className="frame h-8 flex-1 bg-paper" />
          <div className="frame h-8 flex-1 bg-paper" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-[70px] rounded-sm bg-ink/5" />
          <div className="h-[70px] rounded-sm bg-ink/5" />
          <div className="h-4 w-32 rounded-sm bg-ink/5" />
          <div className="h-[46px] rounded-sm bg-ink/10" />
          <div className="h-6 rounded-sm bg-ink/5" />
        </div>
      </div>
    </div>
  );
}

/**
 * Home page (route "/") — the marketing + sign-in surface. The marketing shell is
 * the same for everyone and prerenders; only <HeroSlot /> is request-scoped.
 * Route protection lives in proxy.ts.
 */
export default function Landing({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex w-full flex-1 flex-col">
      {/* ---- HERO ---------------------------------------------------------- */}
      <section className="hero-atmos mx-auto w-full max-w-6xl overflow-hidden px-5 pb-10 pt-14 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Pitch */}
          <div>
            <p className="reveal reveal-1 label-mono flex items-center gap-2 text-xs text-accent">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
              line by line lab · free to start
            </p>

            <h1 className="reveal reveal-2 mt-5 font-display text-5xl font-extrabold leading-[0.9] tracking-tight sm:text-7xl">
              Prep like the
              <br />
              biggest program{" "}
              <span className="lab-mark frame shadow-hard inline-block -rotate-1 bg-accent px-3 pb-1 text-paper">
                in the room.
              </span>
            </h1>

            <p className="reveal reveal-3 mt-7 max-w-xl text-lg font-medium leading-snug sm:text-xl">
              Find reputable evidence, cut verbatim debate-ready cards, re-highlight your
              opponents, and get a real coach.{" "}
              <span className="bg-yellow box-decoration-clone px-1 font-semibold text-black">
                In minutes.
              </span>
            </p>

            <div className="reveal reveal-3 mt-8">
              <ToolStrip />
            </div>

            <div className="reveal reveal-4 mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="#start"
                className="btn-press frame shadow-hard inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-display text-base font-bold uppercase tracking-wide text-paper lg:hidden"
              >
                Start free <span aria-hidden>→</span>
              </Link>
              <Link
                href="#tools"
                className="btn-press frame inline-flex items-center gap-2 bg-paper-2 px-6 py-3.5 font-display text-base font-bold uppercase tracking-wide text-ink"
              >
                See the tools <span aria-hidden>→</span>
              </Link>
            </div>
          </div>

          {/* Sign-up / enter (the actual conversion) */}
          <div id="start" className="reveal reveal-3 flex flex-col items-center lg:items-end">
            <Suspense fallback={<HeroSlotFallback />}>
              <HeroSlot searchParams={searchParams} />
            </Suspense>
          </div>
        </div>

        {/* Accomplishments strip */}
        <div className="reveal reveal-4 mt-16 sm:mt-20">
          <StatBar />
        </div>
      </section>

      {/* The page comes apart here — full bleed, between the pitch and the argument. */}
      <Tear />

      <Scales />
      <Mission />
      <TheRound />
      <SourceField />
      <Verifier />
      <Toolkit />
      <Pricing />
      <FinalCta />
      <LandingFooter />
    </main>
  );
}
