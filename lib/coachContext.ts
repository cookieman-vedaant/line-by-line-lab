import { stripDelimiters } from "@/lib/cardMarkup";
import type { Article, Card } from "@/types";

/**
 * Compact, Coach-readable context built from what the debater is doing in the
 * OTHER tabs — so the Coach can pick up an Article Finder result or iterate on a
 * card they just cut without them re-explaining it. These are plain strings
 * (like the profile/record context) and stay per-device; only text is sent.
 */

/** The articles the debater found in the Finder — numbered, with URLs so the Coach can cut them. */
export function articlesToContext(articles: Article[]): string {
  return articles
    .map((a, i) => {
      const meta = [
        a.author || "unknown author",
        a.publication || "unknown publication",
        a.date || "n.d.",
      ].join(", ");
      const flag = a.accessible ? " [full text confirmed]" : "";
      return `${i + 1}. "${a.title}" — ${meta}${flag}\n   ${a.url}`;
    })
    .join("\n");
}

/** A card the debater already cut (tag + cite + a verbatim body excerpt) for the Coach to critique. */
export function cardToContext(card: Card, source: string, previewChars = 1400): string {
  const body = stripDelimiters(card.body).replace(/\s+/g, " ").trim();
  const preview = body.length > previewChars ? `${body.slice(0, previewChars)}…` : body;
  return [
    `Tag: ${stripDelimiters(card.tag)}`,
    `Cite: ${card.cite} [${stripDelimiters(card.citeDetails)}]`,
    `From: ${source}`,
    `Body (verbatim excerpt): ${preview}`,
  ].join("\n");
}
