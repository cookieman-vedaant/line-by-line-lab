/**
 * Turn an opencaselist slug into something a debater reads at a glance.
 *
 * The index stores opencaselist's own identifiers — "hsld25", "ndtceda24" — and
 * a dropdown of thirteen of those is a puzzle rather than a filter. The slug is
 * still shown alongside the label, because it is what appears on opencaselist
 * itself and experienced debaters navigate by it.
 *
 * An unrecognised slug falls through UNCHANGED rather than being guessed at. New
 * caselists appear in the index on their own as ingestion runs, and inventing a
 * plausible-looking name for one we don't recognise would be a small lie in a UI
 * whose whole promise is that everything shown is real.
 */

const DIVISIONS: ReadonlyArray<readonly [string, string]> = [
  // Longest prefixes first: "hspolicy" must win before any shorter "hsp" match.
  ["hspolicy", "HS Policy"],
  ["ndtceda", "College Policy"],
  ["nfald", "College LD"],
  ["hsld", "HS LD"],
  ["hspf", "HS PF"],
];

/** Two-digit season to the school year it opens, e.g. "25" -> "2025-26". */
function seasonLabel(yy: string): string {
  const start = 2000 + Number(yy);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function caselistLabel(slug: string): string {
  const s = slug.trim().toLowerCase();
  for (const [prefix, name] of DIVISIONS) {
    if (!s.startsWith(prefix)) continue;
    const rest = s.slice(prefix.length);
    if (!/^\d{2}$/.test(rest)) break; // recognised division, unexpected season
    return `${name} ${seasonLabel(rest)}`;
  }
  return slug;
}

/** "HS LD 2025-26 · 58,488 cards" — the full dropdown line. */
export function caselistOptionLabel(slug: string, cards: number): string {
  const label = caselistLabel(slug);
  const suffix = label === slug ? "" : ` (${slug})`;
  return `${label}${suffix} · ${cards.toLocaleString()} cards`;
}
