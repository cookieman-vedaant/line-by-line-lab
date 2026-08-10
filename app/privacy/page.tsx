import Link from "next/link";
import type { Metadata } from "next";
import { SITE } from "@/lib/siteContent";

export const metadata: Metadata = {
  title: "Privacy Policy · Line by Line Lab",
  description:
    "How Line by Line Lab collects, uses, shares, and protects your information, and your rights under the GDPR, the EU Data Act, and the Texas Data Privacy and Security Act.",
};

/*
 * TDPSA-structured privacy notice. The disclosures below describe the app's ACTUAL
 * data practices (read from the codebase), so the representations are accurate.
 * TODO(before launch): have counsel review, especially:
 *   - the Minors section — your users are high-schoolers, which implicates COPPA +
 *     the Texas SCOPE Act (HB 18) beyond the TDPSA; and
 *   - the "Content from the opencaselist wiki" section — indexing disclosed cards
 *     into our own DB is a separate legal question (opencaselist's ToS on bulk
 *     copying, copyright of the quoted source material, and processing non-users'
 *     personal data i.e. school/team labels). Disclosure + takedown here is
 *     necessary but not by itself a legal clearance.
 */

const PROCESSORS: { name: string; purpose: string; data: string }[] = [
  {
    name: "Supabase",
    purpose: "Account sign-in and database hosting",
    data: "Email, hashed password, your Round Log, the cards you've cut, and profile data",
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
        the <strong>Texas Data Privacy and Security Act (TDPSA)</strong> and, if you are in Europe,
        the <strong>GDPR</strong> and <strong>EU Data Act</strong>. We built this tool to help
        debaters, most of whom are students, so we collect as little as we can and never sell your
        data.
      </P>

      <section aria-label="At a glance" className="frame shadow-hard mt-8 bg-paper-2 p-6">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">The short version</p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {[
            <>
              We collect your <strong>email</strong>, what you <strong>type into the tools</strong>,
              and basic <strong>technical data</strong> (like your IP) to run the app.
            </>,
            <>
              We <strong>never sell your data</strong>, run ads, or track you across the web.
            </>,
            <>
              Content you submit is processed by <strong>Google&apos;s Gemini AI</strong> to generate
              results, so don&apos;t paste anything confidential.
            </>,
            <>
              You can <strong>access, correct, or delete</strong> your data at any time.
            </>,
            <>
              Built for students, with <strong>extra protections for minors</strong>.
            </>,
          ].map((t, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 text-sm font-medium leading-relaxed text-ink/80"
            >
              <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rotate-45 bg-accent" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] font-medium text-ink/50">
          This summary is a convenience, not a substitute for the full policy below.
        </p>
      </section>

      <nav aria-label="Contents" className="mt-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/65">Contents</p>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {(
            [
              ["collect", "Information we collect"],
              ["use", "How we use it"],
              ["lawful-basis", "Lawful basis (EU/UK)"],
              ["share", "How we share it"],
              ["ai", "AI processing"],
              ["rights", "Your rights"],
              ["eu-rights", "EU & UK rights (GDPR)"],
              ["minors", "Minors"],
              ["retention", "Data retention"],
              ["security", "Security"],
              ["location", "International transfers"],
              ["wiki-content", "Content from the wiki"],
              ["changes", "Changes"],
              ["contact", "Contact us"],
            ] as const
          ).map(([id, label], i) => (
            <li key={id}>
              <a href={`#${id}`} className="text-sm font-medium text-ink/70 hover:text-accent">
                <span className="label-mono text-accent">{String(i + 1).padStart(2, "0")}</span>{" "}
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <H2 id="collect" n="01">
        Information we collect
      </H2>
      <P>We only collect what the tools need to work:</P>
      <Bullets
        items={[
          <>
            <strong>Account information:</strong> your email address and a password. Your password
            is stored hashed by our auth provider; we never see it.
          </>,
          <>
            <strong>Content you submit:</strong> the claims and search queries you enter, article
            URLs, article text you paste, case files (PDFs) you upload to the Coach, messages you
            send the Coach, and your Round Log entries (tournament, side, result, opponent name, and
            your notes).
          </>,
          <>
            <strong>Cards you cut:</strong> every card the Card Cutter produces is saved to your
            account so you can find it again — the card text (the author&apos;s own verbatim
            wording), its cite, the claim you cut it for, and the article it came from. It is
            visible only to you, and you can delete any of it in <strong>My Cards</strong>.
          </>,
          <>
            <strong>Data we derive:</strong> an AI-generated &quot;debater profile&quot; summarizing
            your logged rounds, used only to make coaching specific to you.
          </>,
          <>
            <strong>Technical data:</strong> your IP address, timestamps (including a
            &quot;last active&quot; time used for the live online count), and standard request/device
            logs.
          </>,
          <>
            <strong>Cookies:</strong> a single essential cookie that keeps you signed in. We do{" "}
            <strong>not</strong> use advertising or cross-site tracking cookies.
          </>,
          <>
            <strong>What we don&apos;t collect:</strong> no payment information, no precise
            geolocation, and no third-party advertising trackers.
          </>,
        ]}
      />

      <H2 id="use" n="02">
        How we use your information
      </H2>
      <Bullets
        items={[
          "To provide the tools: search, card cutting, re-highlighting, coaching, and your Round Log.",
          "To keep you signed in and to secure your account.",
          "To prevent abuse (rate limiting and bot detection), which uses your IP address.",
          "To show an aggregate 'online now' count: a number only, never who is online.",
          "To maintain and improve the reliability of the service.",
        ]}
      />
      <P>
        We do <strong>not</strong> sell your personal data, use it for targeted advertising, or use
        it to profile you for decisions that produce legal or similarly significant effects.
      </P>

      <H2 id="lawful-basis" n="03">
        Lawful basis for processing (EU/UK)
      </H2>
      <P>
        If you are in the European Economic Area or the UK, the GDPR requires us to name a lawful
        basis for each purpose. Ours are:
      </P>
      <Bullets
        items={[
          <>
            <strong>Contract (Art. 6(1)(b)):</strong> running your account and delivering the tools
            you asked for — search, card cutting, re-highlighting, the Coach, and your Round Log.
          </>,
          <>
            <strong>Legitimate interests (Art. 6(1)(f)):</strong> keeping the service secure and
            available — rate limiting, bot detection, and a short-lived security log containing IP
            addresses. We balanced this against your rights and limited it to what abuse prevention
            actually needs, with fixed deletion windows (see Data retention).
          </>,
          <>
            <strong>Legal obligation (Art. 6(1)(c)):</strong> responding to lawful requests and
            keeping records where the law requires it.
          </>,
          <>
            <strong>Consent (Art. 6(1)(a)):</strong> only where we ask for it explicitly. You can
            withdraw consent at any time without affecting processing already carried out.
          </>,
        ]}
      />
      <P>
        We do <strong>not</strong> use your data for automated decision-making that produces legal or
        similarly significant effects about you (Art. 22).
      </P>

      <H2 id="share" n="04">
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

      <H2 id="ai" n="05">
        AI processing (please read)
      </H2>
      <P>
        The content you submit is processed by Google&apos;s Gemini API to generate results.
        Depending on our Gemini service tier, Google&apos;s terms govern whether submitted content
        may be used to improve Google&apos;s services, and on free tiers it may be. For that
        reason, <strong>do not paste anything confidential</strong>, and only submit material you
        have the right to share. The app never fabricates evidence: cards are the author&apos;s real,
        verbatim words.
      </P>

      <H2 id="rights" n="06">
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
        apply in practice, but you may still exercise the access, correction, deletion, and
        portability rights above. You can delete Round Log entries and saved cards yourself at any
        time in the app.
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

      <H2 id="eu-rights" n="07">
        Your rights in the EU and UK (GDPR)
      </H2>
      <P>
        If you are in the European Economic Area, the UK, or Switzerland, the GDPR gives you the
        following rights over your personal data. They apply in addition to anything above:
      </P>
      <Bullets
        items={[
          <>
            <strong>Access (Art. 15):</strong> a copy of the personal data we hold about you. You can
            get this instantly yourself — <strong>Record → Download my data</strong> exports your
            account, Round Log, debater profile, the cards you&apos;ve cut, and any feedback you
            sent, as JSON.
          </>,
          <>
            <strong>Rectification (Art. 16):</strong> correct anything inaccurate. Round Log entries
            are editable and deletable in the app, and saved cards are deletable in{" "}
            <strong>My Cards</strong>; email us for anything else.
          </>,
          <>
            <strong>Erasure (Art. 17):</strong> delete your data. Do it yourself at any time via{" "}
            <strong>Record → Delete my account</strong>, which removes your account, rounds, saved
            cards, and profile.
          </>,
          <>
            <strong>Portability (Art. 20):</strong> receive your data in a structured,
            machine-readable format — that is exactly what the JSON export gives you, and you may
            transmit it to another service.
          </>,
          <>
            <strong>Restriction (Art. 18) and objection (Art. 21):</strong> object to processing based
            on legitimate interests, including our security logging, or ask us to restrict it.
          </>,
          <>
            <strong>Withdraw consent (Art. 7(3)):</strong> where processing relies on consent, you can
            withdraw it at any time without affecting processing already carried out.
          </>,
          <>
            <strong>Complain to a supervisory authority (Art. 77):</strong> you may lodge a complaint
            with your national data protection authority, or the UK ICO, at any time. We would rather
            you contact us first so we can put it right.
          </>,
        ]}
      />
      <P>
        We respond to GDPR requests within <strong>one month</strong> (extendable by two further
        months for complex requests, with notice), and we do not charge for them. We may ask you to
        confirm your identity before acting, so that nobody else can request your data.
      </P>
      <P>
        <strong>EU Data Act.</strong> If you use this service from the EU, you may also request that
        the data you provided be exported so you can move to another provider. The JSON export
        satisfies this; contact us if you need it in a different format.
      </P>

      <H2 id="minors" n="08">
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
          <>
            <strong>EU/UK (GDPR Art. 8):</strong> where we rely on consent, a child can only consent
            from age 16 (or the lower age their country sets, down to 13); below that, consent must
            come from a parent or guardian. If you are under that age in your country, please ask a
            parent or guardian before creating an account.
          </>,
        ]}
      />

      <H2 id="retention" n="09">
        Data retention
      </H2>
      <P>
        We keep your account and content while your account is active. When you delete your account,
        your rounds, saved cards, and debater profile are deleted with it. Bug reports you sent are
        kept but
        <strong> anonymized</strong> (detached from your account and stripped of your contact email),
        so a reported problem doesn&apos;t disappear before it&apos;s fixed.
      </P>
      <P>
        Security data has fixed, automatically enforced deletion windows — a scheduled job deletes it,
        rather than us promising to:
      </P>
      <Bullets
        items={[
          <>
            <strong>Security audit log</strong> (including IP address): deleted after{" "}
            <strong>90 days</strong>.
          </>,
          <>
            <strong>Abuse blocks:</strong> expire on their own, and the record is deleted{" "}
            <strong>30 days</strong> after expiry.
          </>,
          <>
            <strong>Rate-limiting counters:</strong> hold a one-way hash of your email, never the
            address itself, and expire within <strong>24 hours</strong>.
          </>,
          <>
            <strong>Host request logs:</strong> retained briefly by our hosting provider under their
            own policy.
          </>,
        ]}
      />
      <P>
        This is what the GDPR calls storage limitation (Art. 5(1)(e)): we do not keep personal data
        indefinitely just because it might one day be useful.
      </P>

      <H2 id="security" n="10">
        Security
      </H2>
      <P>
        We protect your data with encryption in transit (HTTPS), hashed passwords, access controls
        that scope your data to your own account, and rate limiting plus bot detection to deter
        abuse. No method of storage or transmission is 100% secure, but we work to protect your
        information.
      </P>

      <H2 id="location" n="11">
        Where your data is processed
      </H2>
      <P>
        Your account database is hosted in <strong>Canada</strong>, which the European Commission
        recognizes as providing adequate protection for personal data. Other providers listed above
        (including our host and the AI provider) process data in the{" "}
        <strong>United States</strong>.
      </P>
      <P>
        Where personal data is transferred out of the EEA or UK to a country without an adequacy
        decision, that transfer relies on the European Commission&apos;s{" "}
        <strong>Standard Contractual Clauses</strong> (and the UK Addendum where applicable), which
        form part of our agreements with those providers. You can ask us for more detail about the
        safeguards for any specific transfer.
      </P>

      <H2 id="wiki-content" n="12">
        Content from the opencaselist wiki
      </H2>
      <P>
        Line by Line Lab includes a wiki search that lets you find debate evidence
        (&quot;cards&quot;) disclosed on <strong>opencaselist.com</strong> — the community wiki where
        debaters openly publish the cards and cases they read in rounds. So that you can search
        across it instantly, we index that <strong>already-public</strong> content into our own
        database rather than querying opencaselist for every search.
      </P>
      <Bullets
        items={[
          <>
            <strong>What we store:</strong> the card&apos;s text (the author&apos;s real, verbatim
            published words), its tag and citation, and the caselist, school, and team it was
            disclosed under. Every result links back to its source on opencaselist.
          </>,
          <>
            <strong>Other people&apos;s data:</strong> because disclosure is attributed, this can
            include labels (school and team, often debaters&apos; initials) identifying the students
            who disclosed it. That information is already public on opencaselist; we store it only to
            attribute the source and help you find prep, and we do <strong>not</strong> use it to
            build profiles of those debaters or contact them.
          </>,
          <>
            <strong>We never alter evidence:</strong> cards are the author&apos;s exact disclosed
            words. Nothing is paraphrased, summarized, or generated.
          </>,
          <>
            <strong>Takedown:</strong> if you disclosed content on opencaselist and want it removed
            from our index, email{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-accent hover:underline">
              {SITE.contactEmail}
            </a>{" "}
            and we will remove it promptly.
          </>,
        ]}
      />

      <H2 id="changes" n="13">
        Changes to this policy
      </H2>
      <P>
        We may update this policy as the app evolves. The &quot;last updated&quot; date at the top
        reflects the current version, and we will surface material changes in the app.
      </P>

      <H2 id="contact" n="14">
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
