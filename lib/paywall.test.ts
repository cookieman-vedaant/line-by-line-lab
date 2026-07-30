import { describe, expect, it } from "vitest";
import { hasPaywallPhrase, hasStructuredPaywallSignal } from "./paywall";

describe("hasStructuredPaywallSignal", () => {
  it("detects schema.org isAccessibleForFree=false", () => {
    expect(
      hasStructuredPaywallSignal('{"@type":"Article","isAccessibleForFree":false}'),
    ).toBe(true);
    expect(
      hasStructuredPaywallSignal('{"isAccessibleForFree": "False"}'),
    ).toBe(true);
  });

  it("detects a locked/metered content-tier meta tag in either attribute order", () => {
    expect(
      hasStructuredPaywallSignal(
        '<meta property="article:content_tier" content="locked">',
      ),
    ).toBe(true);
    expect(
      hasStructuredPaywallSignal(
        '<meta content="metered" property="article:content_tier">',
      ),
    ).toBe(true);
  });

  it("does not fire on a free article", () => {
    expect(
      hasStructuredPaywallSignal(
        '{"@type":"Article","isAccessibleForFree":true}<meta property="article:content_tier" content="free">',
      ),
    ).toBe(false);
    expect(hasStructuredPaywallSignal("<html><body><p>Full text.</p></body></html>")).toBe(false);
  });
});

describe("hasPaywallPhrase", () => {
  it("catches common paywall wording", () => {
    expect(hasPaywallPhrase("Please subscribe to continue reading this story.")).toBe(true);
    expect(hasPaywallPhrase("Sign in to read the full article.")).toBe(true);
    expect(hasPaywallPhrase("Purchase this article for $39.95")).toBe(true);
    expect(hasPaywallPhrase("This content is available only to subscribers.")).toBe(true);
  });

  it("does not fire on ordinary article text", () => {
    expect(
      hasPaywallPhrase(
        "Nuclear power reduces carbon emissions by displacing coal generation.",
      ),
    ).toBe(false);
    // A bare "subscribe to our newsletter" should not look like a hard paywall.
    expect(hasPaywallPhrase("Subscribe to our newsletter for weekly updates.")).toBe(false);
  });
});
