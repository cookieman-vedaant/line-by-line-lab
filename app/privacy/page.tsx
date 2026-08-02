import Link from "next/link";
import type { Metadata } from "next";
import { SITE } from "@/lib/siteContent";

export const metadata: Metadata = {
  title: "Privacy Policy — Line by Line Lab",
  description:
    "How Line by Line Lab collects, uses, shares, and protects your information, and your rights under the Texas Data Privacy and Security Act.",
};

/*
 * TDPSA-structured privacy notice. The disclosures below describe the app's ACTUAL
 * data practices (read from the codebase), so the representations are accurate.
 * TODO(before launch): (1) set SITE.contactEmail to a monitored inbox; (2) have
 * counsel review, especially the Minors section — your users are high-schoolers,
 * which implicates COPPA + the Texas SCOPE Act (HB 18) beyond the TDPSA.
 */

const PROCESSORS: { name: string; purpose: string; data: string }[] = [
  {
    name: "Supabase",
    purpose: "Account sign-in and database hosting",
    data: "Email, hashed password, your Round Log, and profile data",
  },
  {
    name: "Google (Gemini API)",
    purpose: "Generates search rankings, cards, re-highlights, and Coach replies",
    data: "The claims, article text, pasted text, uploaded files, and messages you submit",
  },
  {
    name: "Tavily",
    purpose: "Open-web article search",
    data: "Your search query",
  },
  {
    name: "OpenAlex & Semantic Scholar",
    purpose: "Scholarly article search",
    data: "Your search query",
  },
  {
    name: "Cloudflare (Turnstile)",
    purpose: "Human verification / anti-abuse",
    data: "IP address and challenge data",
  },
  {
    name: "Vercel",
    purpose: "Application hosting and infrastructure",
    data: "Request logs, including IP address",
  },
  {
    name: "Upstash (if enabled)",
    purpose: "Caching and rate limiting",
    data: "IP-derived keys and cached results",
  },
];

function H2({ id, n, children }: { id: string; n: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 flex items-baseline gap-3 font-display text-2xl font-extrabold tracking-tight">
      <span className="label-mono text-sm text-accent">{n}</span>
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-sm font-medium leading-relaxed text-ink/80">{children}</p>;
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm font-medium leading-relaxed text-ink/80">
          <span aria-hidden className="mt-0.5 font-display font-bold text-accent">
            ·
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:py-20">
      <Link href="/" className="label-mono btn-press frame inline-flex items-center gap-1.5 bg-paper-2 px-3 py-1.5 text-[10px] font-bold text-ink hover:text-accent">
        <span aria-hidden>←</span> Home
      </Link>

      <header className="mt-8">
        <p className="label-mono flex items-center gap-2 text-xs text-accent">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
          privacy policy
        </p>
        <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
          Your data, <span className="text-accent">plainly explained.</span>
        </h1>
        <p className="label-mono mt-4 text-[11px] text-ink/50">Last updated: {SITE.privacyUpdated}</p>
      </header>

      <div className="masthead-rule mt-8 h-[3px] w-full bg-ink" />

      <P>
        This Privacy Policy explains what information {SITE.name} (&quot;we&quot;, &quot;us&quot;)
        collects, why, who we share it with, and the rights you have — including your rights under
        the <strong>Texas Data Privacy and Security Act (TDPSA)</strong>. We built this tool to help
        debaters, most of whom are students, so we collect as little as we can and never sell your
        data.
      </P>

      <H2 id="collect" n="01">
        Information we collect
      </H2>
      <P>We only collect what the tools need to work:</P>
      <Bullets
        items={[
          <>
            <strong>Account information</strong> — your email address and a password. Your password
            is stored hashed by our auth provider; we never see it.
          </>,
          <>
            <strong>Content you submit</strong> — the claims and search queries you enter, article
            URLs, article text you paste, case files (PDFs) you upload to the Coach, messages you
            send the Coach, and your Round Log entries (tournament, side, result, opponent name, and
            your notes).
          </>,
          <>
            <strong>Data we derive</strong> — an AI-generated &quot;debater profile&quot; summarizing
            your logged rounds, used only to make coaching specific to you.
          </>,
          <>
            <strong>Technical data</strong> — your IP address, timestamps (including a
            &quot;last active&quot; time used for the live online count), and standard request/device
            logs.
          </>,
          <>
            <strong>Cookies</strong> — a single essential cookie that keeps you signed in. We do{" "}
            <strong>not</strong> use advertising or cross-site tracking cookies.
          </>,
        ]}
      />

      <H2 id="use" n="02">
        How we use your information
      </H2>
      <Bullets
        items={[
          "To provide the tools — search, card cutting, re-highlighting, coaching, and your Round Log.",
          "To keep you signed in and to secure your account.",
          "To prevent abuse (rate limiting and bot detection), which uses your IP address.",
          "To show an aggregate 'online now' count — a number only, never who is online.",
          "To maintain and improve the reliability of the service.",
        ]}
      />
      <P>
        We do <strong>not</strong> sell your personal data, use it for targeted advertising, or use
        it to profile you for decisions that produce legal or similarly significant effects.
      </P>

      <H2 id="share" n="03">
        How we share your information
      </H2>
      <P>
        We share data only with the service providers (&quot;processors&quot;) that make the app
        work. They may process your data only on our instructions:
      </P>
      <div className="mt-5 flex flex-col gap-3">
        {PROCESSORS.map((p) => (
          <div key={p.name} className="frame bg-paper-2 p-4">
            <p className="font-display text-base font-bold">{p.name}</p>
            <p className="mt-1 text-xs font-medium text-ink/70">{p.purpose}</p>
            <p className="label-mono mt-2 text-[10px] text-ink/50">Receives: {p.data}</p>
          </div>
        ))}
      </div>
      <P>
        We may also disclose data if required by law, or to protect the rights, safety, and security
        of our users and the service. We do not sell personal data or share it for cross-context
        behavioral advertising.
      </P>

      <H2 id="ai" n="04">
        AI processing (please read)
      </H2>
      <P>
        The content you submit is processed by Google&apos;s Gemini API to generate results.
        Depending on our Gemini service tier, Google&apos;s terms govern whether submitted content
        may be used to improve Google&apos;s services — and on free tiers it may be. For that
        reason, <strong>do not paste anything confidential</strong>, and only submit material you
        have the right to share. The app never fabricates evidence: cards are the author&apos;s real,
        verbatim words.
      </P>

      <H2 id="rights" n="05">
        Your rights under the TDPSA
      </H2>
      <P>If you are a Texas resident, you have the right to:</P>
      <Bullets
        items={[
          "Confirm whether we process your personal data and access it;",
          "Correct inaccuracies in your personal data;",
          "Delete personal data you provided or that we obtained;",
          "Obtain a portable copy of the data you provided; and",
          "Opt out of the sale of personal data, targeted advertising, and profiling for decisions with legal or similarly significant effects.",
        ]}
      />
      <P>
        We do not sell data, serve targeted ads, or run such profiling, so those opt-outs do not
        apply in practice — but you may still exercise the access, correction, deletion, and
        portability rights above. You can delete Round Log entries yourself at any time in the app.
      </P>
      <P>
        To make a request, email{" "}
        <a href={`mailto:${SITE.contactEmail}`} className="text-accent hover:underline">
          {SITE.contactEmail}
        </a>
        . We will respond within <strong>45 days</strong> (we may extend once by another 45 days
        with notice). If we decline your request, you may appeal by replying to our response; if you
        remain unsatisfied, you may contact the Texas Attorney General&apos;s office.
      </P>

      <H2 id="minors" n="06">
        Minors
      </H2>
      <P>
        Line by Line Lab is built for high-school debaters, many of whom are under 18. We take that
        seriously:
      </P>
      <Bullets
        items={[
          <>
            <strong>Under 13 (COPPA):</strong> we do not knowingly collect personal data from
            children under 13 without verifiable parental consent. If you are under 13, please do not
            create an account. A parent or guardian may contact us to review or delete a child&apos;s
            data.
          </>,
          <>
            <strong>Under 18 (Texas SCOPE Act):</strong> we do not sell or share minors&apos;
            personal data, do not use it for targeted advertising, and collect only what is needed to
            run the service.
          </>,
          <>
            <strong>Parental rights:</strong> a parent or guardian may contact us to review, correct,
            or delete their child&apos;s data, or to delete the account.
          </>,
        ]}
      />

      <H2 id="retention" n="07">
        Data retention
      </H2>
      <P>
        We keep your account and content while your account is active. When you delete your account
        or ask us to, we delete or de-identify your personal data, except where we must retain it for
        security or legal reasons.
      </P>

      <H2 id="security" n="08">
        Security
      </H2>
      <P>
        We protect your data with encryption in transit (HTTPS), hashed passwords, access controls
        that scope your data to your own account, and rate limiting plus bot detection to deter
        abuse. No method of storage or transmission is 100% secure, but we work to protect your
        information.
      </P>

      <H2 id="location" n="09">
        Where your data is processed
      </H2>
      <P>
        Your data is processed on U.S.-based cloud infrastructure operated by the providers listed
        above.
      </P>

      <H2 id="changes" n="10">
        Changes to this policy
      </H2>
      <P>
        We may update this policy as the app evolves. The &quot;last updated&quot; date at the top
        reflects the current version, and we will surface material changes in the app.
      </P>

      <H2 id="contact" n="11">
        Contact us
      </H2>
      <P>
        Questions or requests? Email{" "}
        <a href={`mailto:${SITE.contactEmail}`} className="text-accent hover:underline">
          {SITE.contactEmail}
        </a>
        .
      </P>

      <div className="masthead-rule mt-12 h-[3px] w-full bg-ink" />
      <Link
        href="/"
        className="btn-press frame shadow-hard mt-8 inline-flex items-center gap-2 bg-accent px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-paper"
      >
        <span aria-hidden>←</span> Back to Line by Line Lab
      </Link>
    </main>
  );
}
