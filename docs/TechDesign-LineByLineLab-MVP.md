# Technical Design Document

## Line by Line Lab (MVP)

**Version:** 1.0
**Architecture Goal:** Reliable, simple, inexpensive, maintainable.

---

# 1. Technical Goals

## Primary Goal

Build a web application capable of:

1. Finding real, reputable debate evidence.
2. Automatically cutting debate-ready cards.

Everything else is secondary.

---

# Non-Goals

The MVP intentionally excludes:

* Case writing
* AI-generated arguments
* Speech generation
* Debate coaching
* Team collaboration
* Accounts/social features
* Evidence libraries
* Analytics

---

# 2. Recommended Tech Stack

## Frontend

**Next.js (App Router) + React + TypeScript**

Why:

* Excellent Claude Code support
* Deploys seamlessly to Vercel
* Mature ecosystem
* Server Components reduce complexity
* Easy future expansion

---

## Styling

Tailwind CSS

Reasons:

* Fast development
* Zero CSS maintenance
* Easy responsive design

---

## Backend

Next.js Route Handlers

No separate backend server.

Benefits:

* Simpler deployment
* Less infrastructure
* Fewer moving parts

---

## Database

Supabase PostgreSQL

Stores:

* Cached article metadata
* Search history (future)
* User preferences (future)

No user accounts required for MVP.

---

## Hosting

Vercel

Automatic deployments from GitHub.

---

## Authentication

None for MVP.

Future:

Supabase Auth or Clerk.

---

# 3. High-Level Architecture

```
Browser

↓

Next.js Frontend

↓

API Routes

↓

Claude API
(Article Search + Card Cutting)

↓

Internet Sources

↓

Return Ranked Articles

↓

User Selects Article

↓

Claude Card Cutter

↓

Formatted Debate Card
```

---

# 4. Core Modules

## Module 1

Article Finder

Responsibilities:

* Accept search parameters
* Search internet
* Verify sources
* Rank sources
* Return explanations

Input

```
Evidence Type

Claim

Preferred Source

Publication Age
```

Output

```
[
  {
    title,
    author,
    url,
    publication,
    date,
    explanation,
    credibilityScore
  }
]
```

---

## Module 2

Card Cutter

Input

```
Article URL

Card Length

Claim
```

Output

```
Debate Card
```

Responsibilities

* Read article
* Extract body text
* Identify strongest warrant
* Preserve author wording
* Preserve citations
* Remove unnecessary text
* Apply debate formatting

---

# 5. Functional Requirements

## FR-1

The application shall only return articles that exist.

Never fabricate.

Never hallucinate.

---

## FR-2

Every article shall include

* author
* publication
* publication date
* URL
* explanation

---

## FR-3

Articles shall be ranked using

1. Relevance
2. Debate usefulness
3. Publication credibility
4. Author expertise
5. Recency

---

## FR-4

The Card Cutter shall never paraphrase evidence.

Only extract.

---

## FR-5

The Card Cutter shall preserve author wording.

---

## FR-6

The Card Cutter shall preserve citation integrity.

---

## FR-7

The Card Cutter shall output evidence immediately readable in-round.

---

# 6. Debate Knowledge Engine

The application must natively understand:

Evidence Functions

* Link
* Internal Link
* Impact
* Solvency
* Uniqueness
* Framework
* Theory
* K Link
* Alternative

Debate Structures

* Tags
* Warrants
* Extensions
* Overviews

Argument Types

* Disadvantages
* Counterplans
* Kritiks
* Theory
* Framework

Reasoning

* Turns
* Offense
* Defense
* Weighing

This information affects BOTH search ranking and evidence extraction.

---

# 7. Search Algorithm

```
Receive Request

↓

Interpret Debate Context

↓

Expand Search Query

↓

Search Internet

↓

Filter Low Credibility Sources

↓

Rank Remaining Sources

↓

Generate Explanations

↓

Return Results
```

Ranking should heavily favor:

* Peer-reviewed journals
* University publications
* Expert authors

Avoid prioritizing:

* Random blogs
* Reddit
* Facebook
* Unknown websites

---

# 8. Card Cutting Algorithm

```
Receive Article

↓

Extract Clean Text

↓

Segment Into Arguments

↓

Locate Strongest Warrant

↓

Determine Desired Length

↓

Extract Supporting Context

↓

Remove Irrelevant Material

↓

Apply Debate Formatting

↓

Return Debate Card
```

The algorithm should optimize for

> strongest warrant supporting the user's claim.

Not:

* first paragraph

* longest paragraph

* most quoted section

---

# 9. Card Length Rules

## Short

Single strongest warrant.

---

## Medium

Strong warrant

*

Supporting explanation.

---

## Long

Entire reasoning chain.

---

## Entire Article

Keep everything.

Apply formatting only.

---

# 10. Source Quality Rules

Highest Priority

* Peer-reviewed journals
* Universities

High

* Major news organizations

Medium

* Research institutes

Lower

* Government reports
* Think tanks
* Books

Never prioritize

* Reddit
* Forums
* Social media
* AI-generated content

---

# 11. AI Usage

Claude is responsible for

Article Discovery

* Understanding debate claims
* Ranking articles
* Explaining relevance

Card Cutting

* Reading article
* Selecting strongest warrant
* Formatting debate evidence

Claude is NOT responsible for

* Inventing evidence
* Creating fake citations
* Writing arguments
* Writing cases

---

# 12. Error Handling

If no reputable articles exist

Return

"No reputable sources were found matching your criteria."

Never fabricate one.

---

If article cannot be parsed

Explain failure.

Allow another article.

---

If Claude cannot identify a warrant

Return

"Unable to identify a sufficiently strong argumentative passage."

---

# 13. Performance Goals

Search

<10 seconds

Card Cutting

<15 seconds

Navigation

Instant

---

# 14. Scalability

Future additions

* Saved evidence
* User accounts
* Evidence libraries
* Google Docs export
* Verbatim export
* Team workspaces
* Citation manager
* Batch card cutting

Architecture should not prevent these additions.

---

# 15. Security

No unnecessary personal data.

No unnecessary tracking.

Minimal logging.

API keys stored securely in environment variables.

Never expose secrets to client.

---

# 16. Acceptance Criteria

The MVP is complete when a user can:

✓ Open the web app.

✓ Enter a debate claim.

✓ Select an evidence type.

✓ Search.

✓ Receive real, reputable articles.

✓ Understand why each article was recommended.

✓ Select an article.

✓ Choose card length.

✓ Receive a debate-ready card.

✓ Repeat the process in minutes rather than hours.

---

# 17. Definition of Success

A successful output is **not** one that merely highlights text.

A successful output is one where an experienced competitive debater would reasonably believe the evidence could have been cut by another experienced debater.

The application should consistently produce evidence that preserves author intent, identifies the strongest warrant supporting the requested claim, and formats the resulting card according to competitive debate conventions while never inventing evidence or sources.
