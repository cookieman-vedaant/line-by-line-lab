# Product Requirements Document (PRD)

# Line by Line Lab

### AI-Powered Evidence Discovery & Card Cutting for Competitive Debate

**Version:** MVP v1.0
**Target Timeline:** 1 Month
**Platform:** Web Only

---

# Executive Summary

Line by Line Lab is a web application that automates the two most time-consuming parts of competitive debate preparation:

1. Finding high-quality, reputable articles.
2. Cutting debate-ready evidence ("cards") from those articles.

Unlike ChatGPT or generic AI tools, Line by Line Lab is **debate-aware**. It understands how evidence functions in debate, including links, impacts, solvency, framework, kritiks, theory, counterplans, and disadvantages.

The goal is **not** to replace debaters or generate arguments.

The goal is to eliminate repetitive evidence collection while preserving high-quality debate.

---

# Product Philosophy

## Core Principles

* AI should eliminate repetitive work, not thinking.
* Debaters should still create arguments themselves.
* AI should never invent evidence.
* AI should preserve the author's original wording.
* Users always remain in control of evidence selection.
* Speed matters more than flashy UI.

---

# Target User

Primary user:

* High school Lincoln-Douglas debaters
* Beginners through national circuit competitors
* Users who understand debate but spend hours preparing evidence
* Users currently relying on Google, Google Scholar, Verbatim, and Google Docs

---

# Problem Statement

Current workflow:

1. Think of an argument.
2. Search Google.
3. Open dozens of articles.
4. Find reputable sources.
5. Read everything.
6. Locate useful passages.
7. Highlight manually.
8. Cut manually.
9. Format manually.

This process regularly takes multiple hours.

Line by Line Lab reduces this to minutes.

---

# Goals

The MVP only has TWO jobs.

## 1. Article Finder

Given a debate claim:

> "Find a reputable article saying authoritarian governments evade sanctions."

Return several high-quality articles ranked by usefulness.

---

## 2. Card Cutter

Given one selected article:

Produce a debate-ready card automatically.

---

# Non-Goals

The MVP does NOT include:

* AI-generated cases
* AI-written arguments
* Speech writing
* Flowing
* Judge adaptation
* Practice speeches
* Analytics
* Team collaboration
* Tournament management
* Cloud storage

If a feature does not directly improve evidence discovery or card cutting, it belongs after MVP.

---

# User Journey

## Step 1

User opens Line by Line Lab.

---

## Step 2

User fills out:

Evidence Type

Claim

Preferred Source

Publication Age

Desired Card Length

---

## Step 3

The Article Finder searches the internet.

---

## Step 4

Results are ranked.

Each result includes:

* title
* author
* publication
* publication date
* source quality
* short explanation of why it matches

Example:

Article A

Published in a peer-reviewed economics journal.

Argues sanctions fail because authoritarian states evade restrictions through third-party trade.

---

## Step 5

User selects an article.

---

## Step 6

User clicks

> Cut Card

---

## Step 7

User chooses

* Short
* Medium
* Long
* Entire Article

---

## Step 8

The Card Cutter automatically generates a debate-ready card.

The system must preserve author wording exactly except for omitted text.
The system must never synthesize or paraphrase evidence.
The system must identify the strongest warrant supporting the user's claim.
The system must output citation metadata before the evidence body.
The system must preserve debate readability and logical flow.
The system must rank retrieved articles by debate usefulness rather than search relevance alone.
The system must understand debate semantics (link, impact, uniqueness, solvency, framework, K link, etc.) and incorporate them into retrieval.
---

# Search Screen

Fields:

## Required

Evidence Type

Claim

## Optional

Preferred Source Type

Maximum Publication Age

Card Length

---

# Evidence Types

The application must natively understand:

* Link
* Internal Link
* Impact
* Uniqueness
* Solvency
* Framework
* Theory
* K Link
* Alternative Solvency

These should affect article ranking.

---

# Debate Knowledge

The application must understand debate terminology without explanation.

Examples:

Tags

Warrants

Extensions

Overviews

Turns

Offense

Defense

Disadvantages

Counterplans

Kritiks

Framework

Theory

This knowledge should influence both searching and cutting.

---

# Article Finder Requirements

The Article Finder is NOT a chatbot.

It is an intelligent search engine.

Users should never need prompt engineering.

The application should infer useful articles from concise requests.

Example:

Input:

> Find a reputable article saying AI destroys jobs.

Output:

Several ranked articles explaining:

* labor displacement
* automation
* productivity shifts
* unemployment effects

Each article should include a concise description explaining exactly what claim it supports.

---

# Source Ranking

Highest Priority

* Peer-reviewed journals
* University publications

High Priority

* Reputable news organizations

Medium Priority

* Major research organizations

Lower Priority

* Government reports
* Think tanks
* Books

Ranking Factors

1. Relevance
2. Author expertise
3. Publication credibility
4. Recency
5. Debate usefulness

Recency should usually prefer articles published within the last year unless older literature is canonical.

---

# Card Cutter

The Card Cutter is the core innovation.

It does NOT summarize.

It cuts.

The output must preserve the author's original wording.

The AI should:

* identify the strongest argumentative section
* remove unnecessary text
* preserve context
* preserve citations
* preserve wording
* apply debate formatting

The output should resemble evidence cut by an experienced debater.

---

# Card Length

## Short

Extract the single strongest warrant supporting the claim.

## Medium

Strong warrant plus supporting explanation.

## Long

Complete chain of reasoning.

## Entire Article

Apply debate formatting while preserving the article.

---

# Card Selection Algorithm

The AI should optimize for:

The strongest warrant supporting the user's claim.

Not:

* the first paragraph
* the longest paragraph
* the most famous quote

Instead ask:

"If a debater could only read one section of this article, which section best proves this claim?"

---

# Debate Formatting

The Card Cutter should imitate experienced debate evidence.

Requirements:

* preserve author wording
* maintain citation integrity
* remove irrelevant sections
* preserve logical flow
* emphasize important warrants
* produce evidence immediately readable in-round

The uploaded sample card should serve as the formatting reference for implementation.

---

# AI Philosophy

The AI recommends.

The debater decides.

Examples:

The AI ranks articles.

The user chooses one.

The AI cuts evidence.

The user decides whether to use it.

---

# UX Principles

The UI should be:

* clean
* minimal
* fast

The application should feel like a tool, not a workspace.

Users should move from:

"I need evidence"

to

"I have a finished card"

with as few interactions as possible.

---

# Success Metrics

The MVP succeeds if it significantly reduces debate preparation time.

Primary metrics:

* Number of cards cut
* Total hours saved
* Average reduction in evidence preparation time

---

# Technical Constraints

Platform:

Web only

Budget:

Essentially $0 outside Claude Code.

Authentication:

None for MVP.

Users should immediately use the application without creating accounts.

---

# Future Roadmap

Potential Version 2 features:

* Case organization
* Evidence library
* Google Docs export
* Verbatim export
* Team collaboration
* Advanced filtering
* Citation management
* Multiple evidence formats
* Batch card cutting

These should not delay the MVP.

---

# Final Product Vision

Line by Line Lab is **not** another AI chatbot for debate.

It is a specialized evidence engine built by debaters for debaters.

Its purpose is singular:

**Transform hours of evidence preparation into minutes without sacrificing evidence quality.**

Rather than replacing the intellectual work of debating, it removes the repetitive work—finding credible sources, identifying the strongest warrants, and formatting evidence into debate-ready cards—allowing debaters to spend their time where it matters most: developing strategy, analysis, and persuasion.
