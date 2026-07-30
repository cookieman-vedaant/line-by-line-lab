/**
 * Paywall / abstract-only detection.
 *
 * The Article Finder's worst failure mode is surfacing a page the debater can
 * OPEN but not fully READ — a scholarly abstract, or a metered news teaser that
 * cuts off after a paragraph. Cutting from those gives thin, warrant-less cards.
 * These pure checks let the extractor reject such pages so only genuinely
 * full-text articles are marked cuttable.
 */

/**
 * High-confidence, STRUCTURED paywall signals from a page's markup. Reliable
 * enough to reject a page even when it renders a long teaser:
 *  - schema.org `isAccessibleForFree: false`
 *  - a `<meta>` content tier marked locked / metered / premium / subscription
 */
export function hasStructuredPaywallSignal(html: string): boolean {
  if (/"isAccessibleForFree"\s*:\s*(?:false|"false"|"False")/i.test(html)) {
    return true;
  }
  // <meta property="article:content_tier" content="metered"> (either attr order)
  const tier = "(?:article:content_tier|content-tier)";
  const locked = "(?:locked|metered|premium|subscription)";
  if (
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${tier}["'][^>]*content=["']${locked}["']`,
      "i",
    ).test(html) ||
    new RegExp(
      `<meta[^>]+content=["']${locked}["'][^>]*(?:property|name)=["']${tier}["']`,
      "i",
    ).test(html)
  ) {
    return true;
  }
  return false;
}

const PAYWALL_PHRASES: readonly RegExp[] = [
  /subscribe (?:now )?to (?:continue|read)/i,
  /to continue reading/i,
  /already a (?:subscriber|member)\b/i,
  /purchase (?:this )?(?:article|access|pdf)/i,
  /buy (?:this )?(?:article|pdf)/i,
  /rent (?:this )?article/i,
  /get (?:full|instant|unlimited|digital) access/i,
  /sign in to (?:read|continue|view|keep reading)/i,
  /institutional (?:login|access|sign)/i,
  /this (?:content|article) is (?:available )?(?:only )?(?:to|for) (?:subscribers|members)/i,
  /create (?:a free )?account to (?:read|continue)/i,
  /log in to view the full/i,
];

/**
 * Softer, PHRASE-based paywall hint. Higher false-positive risk (a newsletter
 * prompt or footer can trip it), so callers should only act on this when the
 * extracted body is ALSO short — a teaser behind a wall, not a full article
 * that merely happens to mention subscribing somewhere on the page.
 */
export function hasPaywallPhrase(html: string): boolean {
  return PAYWALL_PHRASES.some((re) => re.test(html));
}
