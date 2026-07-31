# Round Log → Debater Profile → Adaptive Coaching — Design

**Date:** 2026-07-30

## Goal
Let a debater log their own tournament rounds (win/loss + a short "why"), then
use that history to make the Coach personal: adapt its feedback to the debater's
real recurring weaknesses and skill level.

## Scope (confirmed with the user)
**Self-focused only.** The app profiles the *user*, not opponents. No opponent
database — LD competitors are minors, so storing/sharing profiles about them is a
privacy/liability risk we deliberately avoid. An `opponent` field exists but is
optional, private, and never leaves the device except as the user's own context.

## Constraints honored
- **No account (MVP):** data is **local-first** in the browser (`localStorage`).
  Instant use, nothing to sign into.
- **$0:** reuses the existing Gemini integration; no database to provision.
- **Bot protection:** the Phase-2 AI endpoint rides the existing `guardApi` +
  Vercel BotID.
- **Future login/payment:** the same data shape migrates to a per-user table
  (Supabase) when accounts land — `lib/roundLog.ts` is the single seam that a
  synced backend would replace, with no UI changes.

## Architecture
- **Storage:** `localStorage` key `lbl-rounds` holds a `Round[]`. Only
  `lib/roundLog.ts` touches storage (CRUD), so swapping to a synced backend later
  is a one-file change.
- **Pure logic:** `lib/roundStats.ts` computes the record summary — unit-tested,
  no DOM.
- **UI:** a new **"Record"** tab in `EvidenceWorkbench` →
  `components/RoundLogPanel.tsx` (quick-entry form + summary card + round list).
- **Phase 2 (AI):** `POST /api/profile` (guarded) — Gemini reads the reports and
  returns weakness themes + a skill-tier estimate.
- **Phase 3 (Coach):** `AssistantContext` gains an optional profile summary; the
  Coach uses it to target the debater's weak spots at their level.

## Data model
```
Round {
  id, tournament, roundLabel (e.g. "R1"/"Quarters"),
  side: "Aff" | "Neg", result: "W" | "L",
  opponent?, report, createdAt (ISO)
}
RoundSummary {
  total, wins, losses, winRate (0..1),
  aff { wins, losses }, neg { wins, losses }
}
```

## Phasing (each slice ships on its own)
1. **Round Log** — local CRUD (add/delete) + record-summary card. No AI. ← this slice
2. **AI profile** — `/api/profile` synthesizes weaknesses + skill tier.
3. **Coach integration** — the Coach consumes the profile (with a toggle).
4. **Export / Import** (JSON) so data is portable until accounts exist.

## Privacy
Self-data only. The `opponent` field is optional and local. Nothing is sent
anywhere except, in Phase 2/3, the user's own reports to the AI for the user's
own coaching.
