import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

/** Honest failure — the article couldn't be fetched or parsed. */
export class ArticleUnreadableError extends Error {
  constructor(detail?: string) {
    super(
      detail ??
        "This article couldn't be read (it may be paywalled or blocked). Try pasting the article text instead.",
    );
    this.name = "ArticleUnreadableError";
  }
}

export interface ExtractedArticle {
  title: string;
  author: string;
  publication: string;
  date: string;
  text: string;
}

const FETCH_TIMEOUT_MS = 15000;
const MIN_ARTICLE_CHARS = 400;

/**
 * Fetch a URL and extract clean article text with Mozilla Readability —
 * the same engine behind Firefox Reader Mode. Free, runs on our server.
 */
export async function extractArticleFromUrl(url: string): Promise<ExtractedArticle> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        // Some sites block requests without a browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ArticleUnreadableError(
        `The site responded with error ${res.status}. It may be paywalled or blocking readers — try pasting the article text instead.`,
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof ArticleUnreadableError) throw err;
    throw new ArticleUnreadableError(
      "The article couldn't be fetched (timeout or network error). Try pasting the article text instead.",
    );
  }

  const dom = new JSDOM(html, { url });
  const parsed = new Readability(dom.window.document).parse();

  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < MIN_ARTICLE_CHARS) {
    throw new ArticleUnreadableError(
      "No readable article text was found on that page. Try pasting the article text instead.",
    );
  }

  return {
    title: parsed.title ?? "",
    author: parsed.byline ?? "",
    publication: parsed.siteName ?? new URL(url).hostname.replace(/^www\./, ""),
    date: parsed.publishedTime?.slice(0, 10) ?? "",
    text: parsed.textContent.replace(/\n{3,}/g, "\n\n").trim(),
  };
}
