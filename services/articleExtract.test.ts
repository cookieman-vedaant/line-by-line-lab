import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { citeName, parseByline } from "@/lib/cite";
import {
  articleFromFields,
  cleanAuthor,
  decodeHtml,
  extractArticleCached,
  type ExtractedArticle,
  extractPageMetadata,
  findBylineInText,
  isPdfResponse,
  normalizeDate,
  pdfToParagraphs,
  profileLinkAuthors,
  resolvePageAuthors,
} from "./articleExtract";

const bytesOf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;

const docFrom = (head: string): Document =>
  new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`).window.document;

describe("extractPageMetadata", () => {
  it("reads author/date/publication from meta tags", () => {
    const doc = docFrom(`
      <meta name="author" content="Jane Smith">
      <meta property="og:site_name" content="Foreign Policy Review">
      <meta property="article:published_time" content="2026-03-12T09:00:00Z">
    `);
    const meta = extractPageMetadata(doc);
    expect(meta.author).toBe("Jane Smith");
    expect(meta.publication).toBe("Foreign Policy Review");
    expect(meta.date).toBe("2026-03-12");
  });

  it("reads every citation_author tag, in order (csis.org, journal pages)", () => {
    // Measured on csis.org: two citation_author tags and no other author field;
    // the card cited "Center for Strategic and International Studies".
    const doc = docFrom(`
      <meta name="citation_author" content="Astrid Chevreuil">
      <meta name="citation_author" content="Jim Stokes">
    `);
    const { authors } = parseByline(extractPageMetadata(doc).author);
    expect(authors).toEqual(["Astrid Chevreuil", "Jim Stokes"]);
    expect(citeName(authors)).toBe("Chevreuil et al.");
  });

  it("reads a surname-first citation_author as one person", () => {
    const doc = docFrom(`<meta name="citation_author" content="Fawzi, Alhussein">`);
    expect(citeName(parseByline(extractPageMetadata(doc).author).authors)).toBe("Fawzi");
  });

  it("falls back to JSON-LD for the author and date", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":{"@type":"Person","name":"Dr. Alan Ng"},
         "datePublished":"2025-11-02","publisher":{"name":"The Economist"}}
      </script>
    `);
    const meta = extractPageMetadata(doc);
    expect(meta.author).toBe("Dr. Alan Ng");
    expect(meta.date).toBe("2025-11-02");
    expect(meta.publication).toBe("The Economist");
  });

  it("handles JSON-LD with a @graph and multiple authors", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@graph":[{"@type":"Article","author":[{"name":"A. One"},{"name":"B. Two"}]}]}
      </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("A. One, B. Two");
  });

  it("skips a JSON-LD author typed as an Organization (the site as 'author')", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":{"@type":"Organization","name":"Reuters"},
         "publisher":{"name":"Reuters"}}
      </script>
    `);
    // No human byline → author stays empty (cite then falls back to publication).
    expect(extractPageMetadata(doc).author).toBe("");
  });

  it("keeps the human author when both a person and an org are listed", () => {
    const doc = docFrom(`
      <script type="application/ld+json">
        {"@type":"NewsArticle","author":[{"@type":"Person","name":"Jane Smith"},
         {"@type":"Organization","name":"CNN"}]}
      </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("Jane Smith");
  });

  it("prefers meta author over JSON-LD, and never throws on malformed JSON-LD", () => {
    const doc = docFrom(`
      <meta name="author" content="Primary Author">
      <script type="application/ld+json">{ this is not valid json </script>
    `);
    expect(extractPageMetadata(doc).author).toBe("Primary Author");
  });

  it("returns empty fields when nothing is present", () => {
    const meta = extractPageMetadata(docFrom(""));
    expect(meta).toEqual({
      title: "",
      author: "",
      publication: "",
      date: "",
      modified: "",
      authorQualification: "",
      publisherQualification: "",
      canonicalUrl: "",
      profileAuthors: [],
    });
  });

  it("reads an updated date separately, so the cite can prefer the later one", () => {
    const meta = extractPageMetadata(
      docFrom(
        '<meta property="article:published_time" content="2019-04-02">' +
          '<meta property="article:modified_time" content="2024-11-30">',
      ),
    );
    expect(meta.date).toBe("2019-04-02");
    expect(meta.modified).toBe("2024-11-30");
  });

  it("reads the canonical URL, so a share link never lands in the cite", () => {
    const meta = extractPageMetadata(
      docFrom('<link rel="canonical" href="https://example.org/real-article">'),
    );
    expect(meta.canonicalUrl).toBe("https://example.org/real-article");
  });

  it("copies the author's stated role out of JSON-LD rather than inferring one", () => {
    const meta = extractPageMetadata(
      docFrom(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          author: { "@type": "Person", name: "Ty Bishop", jobTitle: "Senior Partner" },
          publisher: { "@type": "Organization", name: "McKinsey", description: "A management consulting firm" },
        })}</script>`,
      ),
    );
    expect(meta.author).toBe("Ty Bishop");
    expect(meta.authorQualification).toBe("Senior Partner");
    expect(meta.publisherQualification).toBe("A management consulting firm");
  });
});

describe("cleanAuthor", () => {
  it("keeps a real human author", () => {
    expect(cleanAuthor("Jane Smith", "Reuters")).toBe("Jane Smith");
  });
  it("blanks an author that equals the publication", () => {
    expect(cleanAuthor("Reuters", "Reuters")).toBe("");
    expect(cleanAuthor("bbc news", "BBC News")).toBe("");
  });
  it("keeps the human when the outlet rides along as a delimited credit", () => {
    // The reported bug: the old rule blanked the WHOLE byline whenever it merely
    // contained the publication, so the cite printed the website. Now only the
    // outlet segment is removed.
    expect(cleanAuthor("Jane Smith | The Guardian", "The Guardian")).toBe("Jane Smith");
    expect(cleanAuthor("Jane Smith, Vox", "Vox")).toBe("Jane Smith");
    expect(cleanAuthor("Maria Lopez - Politico", "Politico")).toBe("Maria Lopez");
    expect(cleanAuthor("By Sam Lee, Bloomberg", "Bloomberg")).toBe("By Sam Lee");
  });
  it("does not touch a name that merely shares a word with the outlet", () => {
    // No delimiter and no exact match → left alone; "Bill Hill" is not The Hill.
    expect(cleanAuthor("Bill Hill", "The Hill")).toBe("Bill Hill");
    expect(cleanAuthor("BBC News Staff", "BBC News")).toBe("BBC News Staff");
  });
  it("leaves a surname-first byline intact (no segment is the outlet)", () => {
    expect(cleanAuthor("Fawzi, Alhussein", "Nature")).toBe("Fawzi, Alhussein");
  });
  it("does not over-match a short/empty publication", () => {
    expect(cleanAuthor("Ed Wong", "")).toBe("Ed Wong");
    expect(cleanAuthor("Al Gore", "AP")).toBe("Al Gore"); // pub too short to match loosely
  });
});

describe("cleanAuthor + parseByline (end to end)", () => {
  it("cites the reporter, not the website, for an outlet-in-byline", () => {
    expect(citeName(parseByline(cleanAuthor("Jane Smith | The Guardian", "The Guardian")).authors)).toBe(
      "Smith",
    );
  });
  it("still falls back to the website when only the outlet wrote it", () => {
    // cleanAuthor keeps "BBC News Staff"; parseByline drops it as an org, so the
    // cite has no human and the caller falls back to the publication.
    expect(parseByline(cleanAuthor("BBC News Staff", "BBC News")).authors).toEqual([]);
    expect(parseByline(cleanAuthor("Reuters", "Reuters")).authors).toEqual([]);
  });
});

describe("resolvePageAuthors", () => {
  // Measured on medium.com: <meta name="author" content="Ameya"> and a
  // schema.org Person named "Ameya" — and the card cited "Medium 25".
  const medium = { publication: "Medium", url: "https://medium.com/@ameyabalange014/ubi-63259c896448", byline: "", text: "" };

  it("cites a one-word author the page's own author field names", () => {
    const r = resolvePageAuthors({ ...medium, structured: "Ameya" });
    expect(r.authors).toEqual(["Ameya"]);
    expect(citeName(r.authors, r.etAl)).toBe("Ameya");
  });

  it("works on a publication subdomain too", () => {
    const r = resolvePageAuthors({ ...medium, url: "https://example.medium.com/post-1", structured: "Jefferson" });
    expect(citeName(r.authors)).toBe("Jefferson");
  });

  it("never turns the site's own name into the author", () => {
    expect(resolvePageAuthors({ ...medium, structured: "Medium" }).authors).toEqual([]);
    expect(
      resolvePageAuthors({ publication: "", url: "https://www.axios.com/a", structured: "Axios", byline: "", text: "" }).authors,
    ).toEqual([]);
  });

  it("does not trust a one-word guess that did not come from the author field", () => {
    // Readability's byline is a guess from page chrome ("Advertisement",
    // "Share"); only the page's declared author gets the one-word allowance.
    expect(resolvePageAuthors({ ...medium, structured: "", byline: "Share" }).authors).toEqual([]);
  });

  it("un-shouts a name the page prints in capitals (cambridge.org)", () => {
    const r = resolvePageAuthors({ ...medium, publication: "Utilitas", url: "https://www.cambridge.org/x", structured: "IWAO HIROSE" });
    expect(r.authors).toEqual(["Iwao Hirose"]);
    expect(citeName(r.authors)).toBe("Hirose");
  });

  it("leaves ordinary bylines exactly as before", () => {
    const r = resolvePageAuthors({ ...medium, structured: "Jane Smith | Medium" });
    expect(r.authors).toEqual(["Jane Smith"]);
  });
});

/**
 * Think tanks credit authors only as links to their profile pages — measured on
 * brookings.edu (four authors, no author tag) and aier.org (author tag says
 * "Anonymous", page links Peter C. Earle). Both cards cited the outlet.
 */
describe("profileLinkAuthors", () => {
  const BODY = `<p>${"The article body runs long enough to be the article itself. ".repeat(6)}</p>`;
  const page = (html: string): Document =>
    new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;

  it("reads the byline links above the article", () => {
    const doc = page(`
      <nav><a href="/experts/">Experts</a><a href="/about/leadership/">Leadership</a></nav>
      <h1>U.S. Nuclear and Extended Deterrence</h1>
      <div class="byline">
        <a href="https://www.brookings.edu/people/richard-c-bush/">Richard C. Bush</a>,
        <a href="/people/michael-e-ohanlon/">Michael E. O’Hanlon</a>
      </div>${BODY}`);
    expect(profileLinkAuthors(doc)).toEqual(["Richard C. Bush", "Michael E. O’Hanlon"]);
  });

  it("takes only the name when the link carries more text", () => {
    const doc = page(`<h1>Title</h1><a href="/people/alex-alfirraz-scheers"><span>Alex Alfirraz Scheers</span><span>View profile</span></a>${BODY}`);
    expect(profileLinkAuthors(doc)).toEqual(["Alex Alfirraz Scheers"]);
  });

  it("ignores profile links below or inside the article (author cards, contacts, citations)", () => {
    const doc = page(`<h1>Title</h1><p>${"Body text. ".repeat(30)}<a href="/people/jane-doe">Jane Doe</a></p><div><a href="/people/john-roe">John Roe</a></div>`);
    expect(profileLinkAuthors(doc)).toEqual([]);
  });

  it("ignores a link whose text is not the person its address names", () => {
    const doc = page(`<h1>Title</h1><a href="/people/jane-doe">Read more</a><a href="/staff/institute-staff">People</a>${BODY}`);
    expect(profileLinkAuthors(doc)).toEqual([]);
  });

  it("treats a long list of people as a staff listing, not a byline", () => {
    const people = Array.from({ length: 7 }, (_, i) => `<a href="/people/person-${"abcdefg"[i]}name">Person ${"ABCDEFG"[i]}name</a>`).join("");
    expect(profileLinkAuthors(page(`<h1>Title</h1>${people}${BODY}`))).toEqual([]);
  });

  it("ignores related-expert and sidebar boxes, even above the article", () => {
    const doc = page(`
      <aside><a href="/people/jane-doe">Jane Doe</a></aside>
      <div class="related-experts"><a href="/experts/john-roe">John Roe</a></div>
      <h1>The Title</h1>${BODY}`);
    expect(profileLinkAuthors(doc)).toEqual([]);
  });

  it("ignores an unlabelled box of expert links that doesn't share the title's header", () => {
    // No class or tag hints at all — the layout alone has to rule it out.
    const doc = page(`
      <div><div><a href="/people/jane-doe">Jane Doe</a><a href="/people/john-roe">John Roe</a></div></div>
      <main><div><h1>The Title</h1></div>${BODY}</main>`);
    expect(profileLinkAuthors(doc)).toEqual([]);
  });

  it("ignores profile links above the article's title (menus, featured experts)", () => {
    const doc = page(`
      <div class="mega"><a href="/people/jane-doe">Jane Doe</a></div>
      <h1>The Title</h1>
      <div><a href="/people/steven-pifer">Steven Pifer</a></div>${BODY}`);
    expect(profileLinkAuthors(doc)).toEqual(["Steven Pifer"]);
  });

  it("reads an author credited above the title inside the title's header (aier.org)", () => {
    const doc = page(`
      <nav><a href="/people/">People</a></nav>
      <div class="papers-header"><div class="person"><a href="https://aier.org/people/peter-c-earle/">Peter C. Earle</a></div><h1>The Economics of the Minimum Wage</h1></div>
      <div class="content">${BODY}</div>`);
    expect(profileLinkAuthors(doc)).toEqual(["Peter C. Earle"]);
  });

  it("finds nothing without a title and a body to locate the byline between", () => {
    expect(profileLinkAuthors(page(`<h1>Title</h1><a href="/people/jane-doe">Jane Doe</a><p>Short.</p>`))).toEqual([]);
    expect(profileLinkAuthors(page(`<a href="/people/jane-doe">Jane Doe</a>${BODY}`))).toEqual([]);
  });
});

describe("resolvePageAuthors with profile links", () => {
  const base = { byline: "", text: "", publication: "AIER", url: "https://aier.org/article/x" };

  it("uses the profile links when the author tag names nobody", () => {
    const r = resolvePageAuthors({ ...base, structured: "Anonymous", profiles: ["Peter C. Earle"] });
    expect(citeName(r.authors, r.etAl)).toBe("Earle");
  });

  it("uses them when the author tag is the organisation", () => {
    const r = resolvePageAuthors({ ...base, publication: "Brookings", structured: "Brookings Institution", profiles: ["Richard C. Bush", "Steven Pifer"] });
    expect(citeName(r.authors, r.etAl)).toBe("Bush et al.");
  });

  it("never overrides a byline found in the page text", () => {
    const r = resolvePageAuthors({ ...base, structured: "", byline: "Jane Smith", profiles: ["Peter C. Earle"] });
    expect(r.authors).toEqual(["Jane Smith"]);
  });

  it("never overrides a person the author tag names", () => {
    const r = resolvePageAuthors({ ...base, structured: "Jane Smith", profiles: ["Peter C. Earle"] });
    expect(r.authors).toEqual(["Jane Smith"]);
  });
});

describe("articleFromFields", () => {
  it("keeps a one-word author the debater typed", () => {
    const a = articleFromFields({ author: "Jefferson", publication: "Medium", text: "Body." });
    expect(a.authors).toEqual(["Jefferson"]);
    expect(citeName(a.authors)).toBe("Jefferson");
  });

  it("does not treat a typed outlet name as a person", () => {
    expect(articleFromFields({ author: "Medium", publication: "Medium", text: "Body." }).authors).toEqual([]);
  });
});

describe("normalizeDate", () => {
  it("extracts an ISO date from a timestamp", () => {
    expect(normalizeDate("2026-03-12T09:00:00Z")).toBe("2026-03-12");
  });
  it("parses a human date", () => {
    expect(normalizeDate("April 26, 2016")).toBe("2016-04-26");
  });
  it("returns empty for junk", () => {
    expect(normalizeDate("sometime last year")).toBe("");
    expect(normalizeDate("")).toBe("");
  });
});

describe("findBylineInText", () => {
  it("finds an 'Article written by:' byline", () => {
    expect(findBylineInText("Some intro. Article written by: Robin Wilcox. More text.")).toBe(
      "Robin Wilcox",
    );
  });
  it("finds a leading 'By NAME' byline", () => {
    expect(findBylineInText("By Jane Q. Smith\nThe article begins here.")).toBe("Jane Q. Smith");
  });
  it("returns empty when there's no byline", () => {
    expect(findBylineInText("This article has no byline anywhere in it.")).toBe("");
  });
});

describe("extractArticleCached", () => {
  const sample: ExtractedArticle = {
    title: "T",
    author: "A",
    publication: "P",
    date: "2026-01-01",
    text: "the article body",
    authors: ["A"],
    authorQualification: "",
    publisherQualification: "",
    canonicalUrl: "",
  };
  // Unique URL per test so the module-level cache can't leak state between them.
  const freshUrl = () => `https://example.com/a-${Math.random().toString(36).slice(2)}`;

  it("reuses a recent extraction instead of fetching the same URL twice", async () => {
    let calls = 0;
    const extractor = async () => {
      calls += 1;
      return sample;
    };
    const url = freshUrl();
    // The Article Finder verifies (short timeout); the follow-up cut uses the
    // longer default. The second call must be a cache HIT — no second download.
    const first = await extractArticleCached(url, 6500, extractor);
    const second = await extractArticleCached(url, 15000, extractor);
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("does not cache a failed extraction — a later attempt still runs", async () => {
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom"); // e.g. a transient timeout on verify
      return sample;
    };
    const url = freshUrl();
    await expect(extractArticleCached(url, 6500, flaky)).rejects.toThrow("boom");
    // The rejection was NOT cached, so the cut's longer-timeout retry recomputes.
    const ok = await extractArticleCached(url, 15000, flaky);
    expect(calls).toBe(2);
    expect(ok).toEqual(sample);
  });
});

describe("isPdfResponse", () => {
  it("detects a PDF by its magic bytes even when mislabeled", () => {
    // The reported bug: a PDF served as text/html was decoded as text, putting
    // the PDF's binary streams into the card body.
    expect(isPdfResponse("text/html", "https://x.org/a", bytesOf("%PDF-1.7 rest"))).toBe(true);
  });
  it("detects a PDF by content-type and by extension", () => {
    expect(isPdfResponse("application/pdf", "https://x.org/a", bytesOf("junk"))).toBe(true);
    expect(isPdfResponse("", "https://x.org/paper.pdf", bytesOf("junk"))).toBe(true);
    expect(isPdfResponse("", "https://x.org/paper.pdf?dl=1", bytesOf("junk"))).toBe(true);
  });
  it("leaves real HTML alone", () => {
    expect(isPdfResponse("text/html; charset=utf-8", "https://x.org/a", bytesOf("<html></html>"))).toBe(false);
  });
});

describe("decodeHtml", () => {
  it("decodes UTF-8 by default", () => {
    expect(decodeHtml(bytesOf("<p>café</p>"), "text/html")).toContain("café");
  });
  it("falls back to UTF-8 on an unknown charset instead of throwing", () => {
    expect(decodeHtml(bytesOf("<p>ok</p>"), "text/html; charset=made-up")).toContain("ok");
  });
});

describe("pdfToParagraphs", () => {
  it("reflows hard-wrapped lines into sentences, not one-line paragraphs", () => {
    // Wrapped lines join into one paragraph; a BLANK line is the real
    // paragraph break. (Sentence boundaries within a paragraph are the cutter's
    // job, not this function's.)
    const raw = "Automation displaces\nlabor in exposed regions.\n\nWages then\nfall.";
    const out = pdfToParagraphs(raw);
    expect(out).toBe("Automation displaces labor in exposed regions.\n\nWages then fall.");
  });
  it("stitches a hyphenated word-wrap back together", () => {
    expect(pdfToParagraphs("employ-\nment fell")).toBe("employment fell");
  });
});
