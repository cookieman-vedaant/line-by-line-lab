import type { Metadata } from "next";
import Link from "next/link";
import LandingNav from "@/components/marketing/LandingNav";
import { LandingFooter } from "@/components/marketing/LandingSections";
import {
  CARD_LENGTHS,
  EVIDENCE_TYPES,
  PUBLICATION_AGES,
  SOURCE_TYPES,
} from "@/types";

export const metadata: Metadata = {
  title: "Docs — Line by Line Lab",
  description:
    "How every tool in Line by Line Lab works: Find Articles, Wiki, Cut a Card, Re-Highlight, Coach, Record, and Theme Studio — what each one takes, what it gives back, and where it stops.",
};

/**
 * Documentation for every feature in the Lab.
 *
 * The page is laid out the way a debater already reads: each TOOL opens like a
 * cut card — a tag stating what it does with the one phrase you'd read aloud
 * highlighted, then a cite line saying where it lives and what it runs on, then
 * the body. That treatment is reserved for actual tools; reference sections
 * (Start here, Working with cards, Limits) are plain, so "this is carded" keeps
 * meaning "this is a tool you can open".
 *
 * Sections are grouped by WHEN you reach for a tool, not numbered — a debater
 * doesn't move through these in order, so an index would encode a sequence that
 * doesn't exist.
 *
 * Two rules for anyone editing this page:
 *  1. Document what the app ACTUALLY does. The no-fabrication rule covers docs
 *     as much as evidence — a promised capability is a lie a debater finds
 *     mid-round.
 *  2. Option lists are imported from `types/index.ts`, never retyped, so adding
 *     an evidence type updates this page and the docs can't drift.
 */
const NAV: readonly { group: string; items: readonly { id: string; title: string }[] }[] = [
  { group: "Start", items: [{ id: "start", title: "Start here" }] },
  {
    group: "Finding evidence",
    items: [
      { id: "find", title: "Find Articles" },
      { id: "wiki", title: "Wiki" },
    ],
  },
  {
    group: "Cutting it",
    items: [
      { id: "cut", title: "Cut a Card" },
      { id: "history", title: "My Cards" },
      { id: "cards", title: "Working with cards" },
    ],
  },
  { group: "Against their case", items: [{ id: "rehighlight", title: "Re-Highlight" }] },
  {
    group: "Over a season",
    items: [
      { id: "coach", title: "Coach" },
      { id: "record", title: "Record" },
    ],
  },
  {
    group: "Reference",
    items: [
      { id: "theme", title: "Theme Studio" },
      { id: "limits", title: "Limits and honest failures" },
    ],
  },
];

/** The highlight layer — the one phrase per tool you'd read if you read nothing else. */
function Hi({ children }: { children: React.ReactNode }) {
  return <span className="bg-yellow box-decoration-clone px-1 text-black">{children}</span>;
}

/**
 * The group rule between clusters of tools. Deliberately just a label and a
 * hairline: the red diamond belongs to the page eyebrow, and repeating it at
 * every divider spends the mark six more times for nothing.
 */
function GroupRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-16 first:pt-0">
      <p className="label-mono text-[10px] text-ink/45">{label}</p>
      <span aria-hidden className="h-px flex-1 bg-ink/15" />
    </div>
  );
}

/**
 * A tool, documented as a card: name, tag, cite, body.
 * `cite` says where to find it and what it takes — navigation, not decoration.
 */
function Tool({
  id,
  name,
  tag,
  cite,
  children,
}: {
  id: string;
  name: string;
  tag: React.ReactNode;
  cite: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 pt-10">
      <h2
        id={`${id}-heading`}
        className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {name}
      </h2>
      <p className="mt-3 max-w-2xl font-display text-lg font-bold leading-snug sm:text-xl">{tag}</p>
      <p className="label-mono mt-3 text-[10px] text-ink/45">{cite}</p>
      <div className="divide-t mt-6 flex flex-col gap-5 pt-6 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

/** Reference material — deliberately not carded. */
function Plain({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 pt-10">
      <h2
        id={`${id}-heading`}
        className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl"
      >
        {title}
      </h2>
      <div className="mt-5 flex flex-col gap-5 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-mono text-[10px] text-ink/45">{label}</p>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-accent"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Inline option list, rendered from the real union types. */
function Options({ label, values }: { label: string; values: readonly string[] }) {
  return (
    <p>
      <span className="font-semibold">{label}:</span>{" "}
      <span className="text-ink/75">{values.join(" · ")}</span>
    </p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="frame bg-paper-2 px-4 py-3 text-[13px] leading-relaxed text-ink/80">{children}</p>
  );
}

export default function Docs() {
  return (
    <main className="flex w-full flex-1 flex-col">
      <LandingNav />

      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:py-16">
        <header>
          <p className="label-mono flex items-center gap-2 text-xs text-accent">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
            documentation
          </p>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
            Every tool, and
            <br />
            what it can do.
          </h1>
          <p className="mt-5 max-w-2xl text-lg font-medium leading-snug">
            Eight tools. What each one takes, what it gives back, and where it stops.
          </p>
          <div className="masthead-rule mt-8 h-[3px] w-full bg-ink" />
        </header>

        <div className="mt-10 lg:grid lg:grid-cols-[210px_1fr] lg:gap-14">
          {/* Contents, grouped by when you'd reach for a tool. */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav aria-label="Documentation sections" className="flex flex-col gap-5">
              {NAV.map((group) => (
                <div key={group.group}>
                  <p className="label-mono text-[10px] text-ink/40">{group.group}</p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 lg:flex-col lg:gap-1.5">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className="text-[13px] font-semibold text-ink/65 underline decoration-ink/20 underline-offset-4 hover:text-accent hover:decoration-accent"
                        >
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          <div className="mt-12 lg:mt-0">
            <GroupRule label="Start" />
            <Plain id="start" title="Start here">
              <p>
                Line by Line Lab does the two slowest parts of prep: finding evidence worth reading,
                and cutting it into a card you can actually read in a round. Everything lives at{" "}
                <Link href="/lab" className="font-semibold text-accent underline underline-offset-4">
                  the Lab
                </Link>
                , one screen with every tool across the top.
              </p>
              <Note>
                <span className="font-semibold">The rule that never bends:</span> the app never
                invents evidence. Articles come from real databases and the open web, and card
                bodies are checked word-for-word against the source before you see them. When
                nothing good exists, it says so instead of padding the list.
              </Note>
              <Block label="Where to start">
                <Bullets
                  items={[
                    "Make an account — free, no card required.",
                    "Need evidence for a claim? Find Articles.",
                    "Already have the article? Cut a Card.",
                    "Need an answer mid-round? Wiki searches prep other schools have disclosed.",
                  ]}
                />
              </Block>
            </Plain>

            <GroupRule label="Finding evidence" />
            <Tool
              id="find"
              name="Find Articles"
              tag={
                <>
                  Describe a claim and get back sources that <Hi>actually argue it</Hi> — ranked
                  for your evidence type and checked to open.
                </>
              }
              cite="lab › find articles · openalex + semantic scholar + open web"
            >
              <Block label="What you give it">
                <Options label="Evidence type (required)" values={EVIDENCE_TYPES} />
                <p>
                  <span className="font-semibold">Claim (required):</span>{" "}
                  <span className="text-ink/75">
                    Write the sentence you want to prove — &ldquo;economic decline causes
                    war&rdquo; beats &ldquo;economy&rdquo;. Debate jargon is fine; it gets stripped
                    before the databases see it.
                  </span>
                </p>
                <Options label="Source type (optional)" values={SOURCE_TYPES} />
                <Options label="Published within (optional)" values={PUBLICATION_AGES} />
              </Block>
              <Block label="What you get back">
                <Bullets
                  items={[
                    "Five to eight ranked articles, best first.",
                    "A sentence or two on what each one supports and why it fits your evidence type.",
                    "A credibility score from venue quality, citations, and author expertise.",
                    "A “Full text” badge on every source the app opened and confirmed is readable.",
                    "A Cut button that sends any result straight into the Card Cutter.",
                    "A Discuss in Coach button that carries the article into a conversation.",
                  ]}
                />
              </Block>
              <Note>
                While it runs you see the three real steps it is working through — searching
                databases, ranking for debate usefulness, then checking each source opens. Run the
                same search twice and the second returns instantly with no steps: that is a cached
                result, not a glitch.
              </Note>
            </Tool>

            <Tool
              id="wiki"
              name="Wiki"
              tag={
                <>
                  Search <Hi>every school&apos;s disclosed prep at once</Hi>, already cut and ready
                  to read.
                </>
              }
              cite="lab › wiki · opencaselist, indexed centrally — no account to connect"
            >
              <p>
                Schools disclose their cases and cards on opencaselist, but you can only click
                through it one school and one round at a time. The Lab indexes over 200,000 of those
                cards into a single search, so you describe an argument and pull on-point cards in
                seconds — including between speeches.
              </p>
              <Block label="What you give it">
                <p className="text-ink/75">
                  A description of the argument you are hitting. You never pick a caselist,
                  division, school, or year — it searches all of them at once.
                </p>
              </Block>
              <Block label="What you get back">
                <Bullets
                  items={[
                    "Pre-cut cards with their tag and body, already formatted.",
                    "The school, team, caselist, and year behind each card.",
                    "A link back to the original page on opencaselist.",
                  ]}
                />
              </Block>
              <Note>
                Coverage runs across recent seasons and is deeper for some divisions and years than
                others. Treat a thin result as a gap in what has been disclosed and indexed, not
                proof that nothing exists.
              </Note>
            </Tool>

            <GroupRule label="Cutting it" />
            <Tool
              id="cut"
              name="Cut a Card"
              tag={
                <>
                  A finished, formatted card whose body is <Hi>every word the author&apos;s</Hi>,
                  checked against the source.
                </>
              }
              cite="lab › cut a card · a url, pasted text, or a search result"
            >
              <Block label="What you give it">
                <Bullets
                  items={[
                    "A URL, or the article text pasted in directly.",
                    "The claim the card needs to support.",
                    "Optionally the author, publication, and date, if you already know them.",
                  ]}
                />
                <Options label="Card length" values={CARD_LENGTHS} />
              </Block>
              <Block label="What you get back">
                <Bullets
                  items={[
                    "A tag, with the key phrases underlined.",
                    "A cite in AuthorLastName YY form, plus the full citation details.",
                    "A body in the standard emphasis layers — see Working with cards.",
                  ]}
                />
              </Block>
              <Note>
                <span className="font-semibold">Why the body is trustworthy:</span> the AI never
                retypes the article. It picks a passage and marks which words to underline and
                highlight, and the app applies those marks to the real text. Verbatim is guaranteed
                by construction, not by asking a model to behave. Length is enforced mechanically as
                a share of the article, so Short stays short.
              </Note>
            </Tool>

            <Tool
              id="history"
              name="My Cards"
              tag={
                <>
                  Every card you have ever cut, <Hi>saved to your account automatically</Hi> —
                  from either tool, on every device.
                </>
              }
              cite="lab › my cards · nothing to set up"
            >
              <Block label="What lands here">
                <Bullets
                  items={[
                    "Every card from Cut a Card, and every card cut from a Find Articles result.",
                    "Saved the moment the card is made — there is no Save button to forget.",
                    "Stored against your account, not your device: cut on a school laptop, read it on your phone that night.",
                  ]}
                />
              </Block>
              <Block label="What you can do with it">
                <Bullets
                  items={[
                    "Filter by tag, cite, the claim you cut it for, or the article title.",
                    "Open any card to get the full editor and the same Word / HTML export as a fresh cut.",
                    "Delete anything you do not want kept.",
                  ]}
                />
              </Block>
              <Note>
                <span className="font-semibold">Private to you, and honest:</span> nobody else can
                see your cards — that is enforced by the database, not just the interface. Saved
                cards cannot be rewritten in place, so what is stored is always what the Card Cutter
                actually produced. Editing an open card changes your copy for export, never the
                record. Deleting your account deletes all of it.
              </Note>
            </Tool>

            <Plain id="cards" title="Working with cards">
              <p>
                Every card the Lab produces — from Find Articles, Cut a Card, Re-Highlight, or the
                Coach — uses the same format and the same controls.
              </p>
              <Block label="The emphasis layers">
                <Bullets
                  items={[
                    "Small plain text: context you do not read aloud.",
                    "Underlined: what you actually read in the round.",
                    "Highlighted: the key warrants, which should still make sense read on their own.",
                    "Bold: the strongest words inside what you are already reading.",
                  ]}
                />
              </Block>
              <Block label="Editing and export">
                <Bullets
                  items={[
                    "Cards are fully editable — click in and type, or use the toolbar for bold, italic, underline, font, and size.",
                    "A card you have edited is flagged as edited by you, so you always know what came from the app and what did not.",
                    "Copy puts formatted text on your clipboard that survives a paste into Word or Google Docs.",
                    "Download gives you Word (.docx) or a web page (.html).",
                  ]}
                />
              </Block>
            </Plain>

            <GroupRule label="Against their case" />
            <Tool
              id="rehighlight"
              name="Re-Highlight"
              tag={
                <>
                  Turn an opponent&apos;s card against itself using{" "}
                  <Hi>the author&apos;s own words they left out</Hi>.
                </>
              }
              cite="lab › re-highlight · their card, or a link to its source"
            >
              <Block label="What you give it">
                <p className="text-ink/75">
                  The opponent&apos;s card pasted in, or a link to the source article. If you paste
                  a card, it finds the link inside the cite on its own.
                </p>
              </Block>
              <Block label="What you get back">
                <Bullets
                  items={[
                    "The same passage re-highlighted from your side.",
                    "A contradiction report, each entry labelled: contradiction, omitted context, author hedge, or miscut.",
                    "A verbatim quote for each entry, plus how to use it in a round.",
                  ]}
                />
              </Block>
              <Note>
                Every quote is checked against the source and dropped if it is not word-for-word.
                &ldquo;This card holds up&rdquo; is a real answer — an empty report means the other
                team cut it honestly, and the app says so rather than manufacture an indict.
              </Note>
            </Tool>

            <GroupRule label="Over a season" />
            <Tool
              id="coach"
              name="Coach"
              tag={
                <>
                  One coach that <Hi>researches, cuts, and builds arguments with you</Hi> — and
                  reads your record.
                </>
              }
              cite="lab › coach · chat, pdf upload, live web + scholarly search"
            >
              <p>
                Debate-aware across Lincoln-Douglas, Public Forum, and Policy: links, impacts,
                framework, kritiks, theory, counterplans, and disadvantages.
              </p>
              <Block label="What it can do">
                <Bullets
                  items={[
                    "Read an opponent's case uploaded as a PDF and build a block of responses.",
                    "Draft an argument with you and iterate it line by line.",
                    "Run live web and scholarly search inside the chat.",
                    "Cut verbatim cards without leaving the conversation.",
                    "Improve a card you already cut, or find a stronger source for it.",
                    "Read your Record and target the weaknesses that keep costing you rounds.",
                  ]}
                />
              </Block>
              <Note>
                The Coach also sees what you have been doing in the other tabs — your current claim,
                the articles you just found, and the last card you cut. The Discuss in Coach buttons
                elsewhere in the Lab jump here with that context already loaded.
              </Note>
            </Tool>

            <Tool
              id="record"
              name="Record"
              tag={
                <>
                  Log every round so the coaching <Hi>gets specific to you</Hi>.
                </>
              }
              cite="lab › record · private to your account, synced across devices"
            >
              <Block label="What you log">
                <p className="text-ink/75">
                  The tournament, which side you were on, the result, and any notes worth keeping.
                </p>
              </Block>
              <Block label="What it gives you">
                <Bullets
                  items={[
                    "A running record of every round, with win rate and career stats.",
                    "A debater profile built from that history.",
                    "Coaching that gets sharper the more you compete.",
                  ]}
                />
              </Block>
              <Note>
                Your Record is yours. It is tied to your account, syncs across your devices, and is
                never shared with other debaters.
              </Note>
            </Tool>

            <GroupRule label="Reference" />
            <Tool
              id="theme"
              name="Theme Studio"
              tag={
                <>
                  Restyle the whole app from <Hi>one line of description</Hi>.
                </>
              }
              cite="lab header › theme studio · two built-in looks, presets, or a prompt"
            >
              <p>
                Describe a vibe — &ldquo;newsprint noir&rdquo;, &ldquo;varsity blue&rdquo; — and the
                theme agent generates a full color and type scheme from it.
              </p>
              <Note>
                Generated themes are contrast-checked before they are applied, so a theme that would
                make your own text unreadable cannot be produced. Cards are deliberately exempt:
                they stay black on white with cyan highlights in every theme, because that is what
                has to paste correctly into Word.
              </Note>
            </Tool>

            <Plain id="limits" title="Limits and honest failures">
              <p>
                What the app will not do, and where it will tell you no. Worth knowing before a
                tournament rather than during one.
              </p>
              <Block label="What it refuses to do">
                <Bullets
                  items={[
                    "It never writes evidence, invents a citation, or paraphrases an author into a card.",
                    "It does not write your case, your arguments, or your speeches — that part stays yours.",
                    "When no reputable source fits, it returns nothing and says so.",
                  ]}
                />
              </Block>
              <Block label="Where it stops">
                <Bullets
                  items={[
                    "Cite details come from the page byline or from what you typed, and are NOT covered by the verbatim check — eyeball the author and date before reading a card in a round.",
                    "Paywalled or blocked pages cannot be fetched; paste the text instead, which is the designed fallback.",
                    "Search leans academic, so straight news coverage is thinner than scholarly work.",
                    "AI capacity is finite. During a busy stretch you may briefly be asked to wait; search falls back to ranking by citations and recency and tells you relevance is unverified.",
                  ]}
                />
              </Block>
              <p>
                Something behaving differently than this page describes? Use the Feedback button in
                the Lab header — it goes straight to a real inbox.
              </p>
            </Plain>
          </div>
        </div>
      </div>

      <LandingFooter />
    </main>
  );
}
