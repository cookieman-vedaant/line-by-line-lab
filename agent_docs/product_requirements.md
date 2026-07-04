# Product Requirements

Condensed from `docs/PRD-LineByLineLab-MVP.md`. That file is the source of truth; this is the working summary for agents.

## One-liner
Line by Line Lab is a debate-aware web app that (1) finds reputable articles for a debate claim and (2) cuts debate-ready evidence cards from them — turning hours of prep into minutes.

## Primary User Story
> As a high school LD debater, I want to enter a debate claim and get ranked, reputable articles, then automatically cut a debate-ready card from the one I choose — so I spend my time on strategy and analysis instead of hunting and formatting evidence.

## The Two Jobs (must-have features)

### 1. Article Finder
An intelligent search engine (NOT a chatbot; no prompt engineering required). Given a concise claim + evidence type, it returns several real, reputable articles ranked by debate usefulness. Each result includes: **title, author, publication, publication date, source quality, and a short explanation of exactly what claim it supports.**

### 2. Card Cutter
Given one selected article + a card length, it produces a debate-ready card. It **extracts** (never summarizes/paraphrases): identifies the strongest warrant supporting the claim, preserves author wording and citations, removes irrelevant text, and applies debate formatting. Output should read like evidence cut by an experienced debater. The uploaded sample card is the formatting reference.

## Search Screen Fields
- **Required:** Evidence Type, Claim
- **Optional:** Preferred Source Type, Maximum Publication Age, Card Length

## Evidence Types (must affect ranking)
Link, Internal Link, Impact, Uniqueness, Solvency, Framework, Theory, K Link, Alternative Solvency.

## Debate Knowledge (understood without explanation)
Tags, Warrants, Extensions, Overviews, Turns, Offense, Defense, Disadvantages, Counterplans, Kritiks, Framework, Theory. Influences both searching and cutting.

## Card Length Rules
- **Short:** the single strongest warrant supporting the claim.
- **Medium:** strongest warrant + supporting explanation.
- **Long:** the complete chain of reasoning.
- **Entire Article:** keep everything; apply debate formatting only.

## Card Selection Algorithm
Optimize for: *"If a debater could only read one section of this article, which section best proves this claim?"* — NOT the first paragraph, longest paragraph, or most famous quote.

## Source Ranking
- **Highest:** peer-reviewed journals, university publications
- **High:** reputable news organizations
- **Medium:** major research organizations
- **Lower:** government reports, think tanks, books
- **Never prioritize:** Reddit, forums, social media, random blogs, AI-generated content
- **Ranking factors:** relevance, author expertise, publication credibility, recency, debate usefulness. Prefer articles from the last year unless older literature is canonical.

## Error Handling (honest failures — never fabricate)
- No reputable articles → "No reputable sources were found matching your criteria."
- Article can't be parsed → explain the failure, allow another article.
- No strong warrant → "Unable to identify a sufficiently strong argumentative passage."

## Non-Goals (do NOT build for MVP)
AI-generated cases/arguments, speech writing, flowing, judge adaptation, practice speeches, analytics, team collaboration, tournament management, cloud storage, accounts, evidence libraries, exports.

## Success Metrics
The MVP succeeds if it significantly reduces prep time. Primary metrics: number of cards cut, total hours saved, average reduction in evidence-prep time.

## Definition of Success
A successful output is one where an experienced competitive debater would reasonably believe the evidence could have been cut by another experienced debater — preserving author intent, identifying the strongest warrant, and formatting to competitive conventions, while never inventing evidence or sources.

## Acceptance Criteria (MVP complete when a user can)
Open the app → enter a claim → select an evidence type → search → receive real, reputable articles → understand why each was recommended → select an article → choose card length → receive a debate-ready card → repeat in minutes rather than hours.

## Constraints
Web only · ~$0 budget outside Claude Code · no authentication for MVP (immediate use, no accounts) · search < 10s, card cutting < 15s, navigation instant · secrets in env vars only, minimal logging.
