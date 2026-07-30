/**
 * Reputable-source gate for the Article Finder. Debaters can't cite user-
 * generated, social, or open-encyclopedia pages, so these get dropped BEFORE
 * ranking — whether they came from the open web (Brave) or, rarely, a database
 * URL. Edit BLOCKED_DOMAINS to tune what counts as non-citable.
 */

export const BLOCKED_DOMAINS: readonly string[] = [
  // User-generated / social / forums
  "reddit.com",
  "quora.com",
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "tumblr.com",
  "threads.net",
  // Video / Q&A / how-to (not citable evidence)
  "youtube.com",
  "youtu.be",
  "answers.com",
  "ask.com",
  "wikihow.com",
  "stackexchange.com",
  "stackoverflow.com",
  // Open encyclopedias (tertiary — never cite directly)
  "wikipedia.org",
  "wikimedia.org",
  "wikiwand.com",
  "britannica.com",
  "fandom.com",
  // Self-publishing platforms (no editorial standard)
  "medium.com",
  // Reviews / listings
  "yelp.com",
  "tripadvisor.com",
];

/** Lowercase hostname from a URL (www. stripped), or "" if it won't parse. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True if the URL's host is a blocked domain or a subdomain of one. */
export function isBlockedDomain(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true; // unparseable URL → treat as non-citable
  return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Keep only items whose URL is a citable, reputable source. */
export function filterReputable<T extends { url: string }>(items: T[]): T[] {
  return items.filter((item) => !isBlockedDomain(item.url));
}
