import { describe, expect, it } from "vitest";
import { articleFromJats, pmcIdFromUrl } from "./articleExtract";

/**
 * PubMed Central serves a reCAPTCHA page to servers, so its articles — the
 * largest store of free research full text — never read as full text. Its
 * open-access articles are available through Europe PMC's official full-text
 * API as JATS XML; these pin down how a PMC link maps to that and how the XML
 * becomes an article.
 */

describe("pmcIdFromUrl", () => {
  it("recognizes every form of PubMed Central article link", () => {
    expect(pmcIdFromUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5775138/")).toBe("5775138");
    expect(pmcIdFromUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/5775138")).toBe("5775138");
    expect(pmcIdFromUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC6145823/")).toBe("6145823");
    expect(pmcIdFromUrl("https://europepmc.org/article/PMC/PMC6145823")).toBe("6145823");
    expect(pmcIdFromUrl("https://europepmc.org/articles/PMC6145823")).toBe("6145823");
  });

  it("ignores everything else", () => {
    expect(pmcIdFromUrl("https://www.ncbi.nlm.nih.gov/pubmed/12345")).toBeNull();
    expect(pmcIdFromUrl("https://example.org/pmc/articles/PMC1")).toBeNull();
  });
});

const para = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ") + ".";

const JATS = `<?xml version="1.0"?>
<article>
  <front>
    <journal-meta><journal-title-group><journal-title>The Russell Sage Foundation Journal</journal-title></journal-title-group></journal-meta>
    <article-meta>
      <title-group><article-title>A Universal Child Allowance</article-title></title-group>
      <contrib-group>
        <contrib contrib-type="author"><name><surname>SHAEFER</surname><given-names>H. LUKE</given-names></name></contrib>
        <contrib contrib-type="author"><name><surname>Collyer</surname><given-names>Sophie</given-names></name></contrib>
        <contrib contrib-type="editor"><name><surname>Editor</surname><given-names>Not</given-names></name></contrib>
      </contrib-group>
      <pub-date pub-type="ppub"><month>2</month><year>2018</year></pub-date>
      <pub-date pub-type="epub"><day>9</day><month>1</month><year>2018</year></pub-date>
      <abstract><p>${para(40, "abs")}</p></abstract>
    </article-meta>
  </front>
  <body>
    <sec><title>Introduction</title>
      <p>${para(80, "intro")}</p>
      <fig><caption><p>Figure caption that is not prose of the article body at all.</p></caption></fig>
      <p>${para(80, "second")}</p>
    </sec>
    <table-wrap><table><tr><td><p>table cell</p></td></tr></table></table-wrap>
  </body>
  <back><ref-list><ref><p>Reference entry.</p></ref></ref-list></back>
</article>`;

describe("articleFromJats", () => {
  const article = articleFromJats(JATS, "6145823");

  it("reads the article's own metadata, title-casing names a journal printed in capitals", () => {
    expect(article?.title).toBe("A Universal Child Allowance");
    expect(article?.publication).toBe("The Russell Sage Foundation Journal");
    expect(article?.authors).toEqual(["H. Luke Shaefer", "Sophie Collyer"]);
    expect(article?.date).toBe("2018-01-09");
    expect(article?.canonicalUrl).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC6145823/");
  });

  it("keeps the abstract and body prose, never figures, tables or references", () => {
    const text = article?.text ?? "";
    expect(text).toContain("abs0");
    expect(text).toContain("intro0");
    expect(text).toContain("second0");
    expect(text).not.toMatch(/Figure caption|table cell|Reference entry/);
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("returns null when the XML holds no real text", () => {
    expect(articleFromJats("<article><front></front></article>", "1")).toBeNull();
  });
});
