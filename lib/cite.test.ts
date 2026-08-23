import { describe, expect, it } from "vitest";
import {
  citeName,
  citeYear,
  looksLikeOrganization,
  mostRecentDate,
  parseByline,
  splitAuthors,
  surnameOf,
} from "@/lib/cite";

describe("looksLikeOrganization", () => {
  it("catches the outlets that get cited as authors", () => {
    // The reported bug: a McKinsey report cited as "McKinsey" instead of its authors.
    expect(looksLikeOrganization("McKinsey & Company")).toBe(true);
    expect(looksLikeOrganization("Reuters")).toBe(true);
    expect(looksLikeOrganization("BBC News")).toBe(true);
    expect(looksLikeOrganization("Brookings Institution")).toBe(true);
    expect(looksLikeOrganization("Center for American Progress")).toBe(true);
    expect(looksLikeOrganization("Union of Concerned Scientists")).toBe(true);
    expect(looksLikeOrganization("Editorial Board")).toBe(true);
    expect(looksLikeOrganization("Staff")).toBe(true);
  });

  it("leaves real people alone", () => {
    expect(looksLikeOrganization("Ty Bishop")).toBe(false);
    expect(looksLikeOrganization("Jane Q. Smith")).toBe(false);
    expect(looksLikeOrganization("Alastair Norcross")).toBe(false);
    expect(looksLikeOrganization("Ana de Sousa")).toBe(false);
  });
});

describe("splitAuthors", () => {
  it("splits the byline forms real pages use", () => {
    expect(splitAuthors("Ty Bishop, Jane Doe and Ana Ruiz")).toEqual([
      "Ty Bishop",
      "Jane Doe",
      "Ana Ruiz",
    ]);
    expect(splitAuthors("By Ty Bishop")).toEqual(["Ty Bishop"]);
    expect(splitAuthors("Written by: Jane Doe; Ana Ruiz")).toEqual(["Jane Doe", "Ana Ruiz"]);
  });

  it("returns nobody when only an organisation is credited", () => {
    expect(splitAuthors("McKinsey & Company")).toEqual([]);
    expect(splitAuthors("Reuters")).toEqual([]);
    expect(splitAuthors("BBC News Staff")).toEqual([]);
  });

  it("keeps the person out of a mixed credit", () => {
    expect(splitAuthors("Ty Bishop, McKinsey & Company")).toEqual(["Ty Bishop"]);
  });

  it("drops trailing role text rather than treating it as a name", () => {
    expect(splitAuthors("Jane Doe | Senior Correspondent")).toEqual(["Jane Doe"]);
    expect(splitAuthors("Jane Doe (Washington)")).toEqual(["Jane Doe"]);
  });

  it("ignores a sentence that isn't a byline", () => {
    expect(splitAuthors("This report was prepared over eighteen months of fieldwork")).toEqual([]);
  });
});

describe("citeName", () => {
  it("uses one surname for one author", () => {
    expect(citeName(["Alastair Norcross"])).toBe("Norcross");
  });

  it("collapses several authors to et al. rather than dropping them", () => {
    expect(citeName(["Ty Bishop", "Jane Doe", "Ana Ruiz"])).toBe("Bishop et al.");
  });

  it("keeps surname particles together", () => {
    expect(surnameOf("Ana de Sousa")).toBe("de Sousa");
    expect(surnameOf("Ludwig van Beethoven")).toBe("van Beethoven");
    expect(citeName(["Ana de Sousa", "Jane Doe"])).toBe("de Sousa et al.");
  });

  it("is empty when nobody is credited, so the caller must decide", () => {
    expect(citeName([])).toBe("");
  });
});

describe("mostRecentDate", () => {
  const now = new Date("2026-08-22T00:00:00Z");

  it("prefers the updated date over the original publication date", () => {
    expect(mostRecentDate(["2019-04-02", "2024-11-30"], now)).toBe("2024-11-30");
  });

  it("ignores empty and malformed fields", () => {
    expect(mostRecentDate(["", null, undefined, "not a date", "2023-01-05"], now)).toBe("2023-01-05");
  });

  it("rejects an implausible future date rather than citing it", () => {
    // Pages carry junk far-future dates; citing one would print a year that
    // hasn't happened.
    expect(mostRecentDate(["2024-06-01", "2099-01-01"], now)).toBe("2024-06-01");
  });

  it("allows a few days ahead for timezones and embargoes", () => {
    expect(mostRecentDate(["2026-08-24"], now)).toBe("2026-08-24");
  });

  it("is empty when the page states no usable date", () => {
    expect(mostRecentDate([], now)).toBe("");
    expect(mostRecentDate(["", "garbage"], now)).toBe("");
  });
});

describe("citeYear", () => {
  it("takes the two-digit year a cite prints", () => {
    expect(citeYear("2024-11-30")).toBe("24");
    expect(citeYear("2008-01-01")).toBe("08");
  });

  it("is empty without a date, so no year gets invented", () => {
    expect(citeYear("")).toBe("");
    expect(citeYear("n.d.")).toBe("");
  });
});

/**
 * The byline shapes that were reaching real cards wrong.
 *
 * Every case here was measured against the live extractor, not imagined: a
 * battery of 22 real-world byline shapes resolved 9 of them incorrectly, and
 * each `it` below names one of those failures. The user-visible symptoms were
 * "it gives the wrong authors, and it mistakes them for the publisher" and
 * cites reading "Smith et al." for pieces one person wrote.
 */
describe("byline shapes that used to produce a wrong cite", () => {
  it("reads a surname-first byline as ONE person, not two", () => {
    // "Fawzi, Alhussein" is how citation_author and most scholarly metadata
    // write a name. Splitting on the comma made every solo paper an "et al."
    // Measured on nature.com: cited "Fawzi et al." for a single-author paper.
    expect(citeName(splitAuthors("Fawzi, Alhussein"))).toBe("Fawzi");
    expect(citeName(splitAuthors("Smith, J."))).toBe("Smith");
  });

  it("keeps the people in a surname-first LIST", () => {
    expect(citeName(splitAuthors("Fawzi, Alhussein; Balog, Matej"))).toBe("Fawzi et al.");
  });

  it("keeps 'et al.' instead of citing a person named 'al.'", () => {
    // A search result arrives pre-collapsed. "al." was being taken as the
    // surname, printing the cite "al. 23".
    const { authors, etAl } = parseByline("Alhussein Fawzi et al.");
    expect(authors).toEqual(["Alhussein Fawzi"]);
    expect(citeName(authors, etAl)).toBe("Fawzi et al.");
  });

  it("does not count a post-nominal or a job title as a second author", () => {
    expect(citeName(splitAuthors("Jane Smith, Ph.D."))).toBe("Smith");
    expect(citeName(splitAuthors("Jane Smith, Senior Fellow"))).toBe("Smith");
  });

  it("keeps the person out of a syndicated 'for OUTLET' credit", () => {
    // Judged as an organisation because of the " for ", so the byline vanished
    // and the cite named the outlet instead.
    expect(citeName(splitAuthors("Jane Smith for Reuters"))).toBe("Smith");
  });

  it("still reads an institution built around 'for' as an organisation", () => {
    // The guard above must not open a hole here.
    expect(splitAuthors("Center for American Progress")).toEqual([]);
  });

  it("keeps every particle in a compound surname", () => {
    expect(surnameOf("Maria de la Cruz")).toBe("de la Cruz");
    expect(citeName(splitAuthors("Maria de la Cruz"))).toBe("de la Cruz");
  });

  it("never lets a publication or institution become the author", () => {
    // The exact symptom reported: the publisher printed where the author goes.
    for (const outlet of ["Nature", "Reuters", "Congressional Budget Office"]) {
      expect(splitAuthors(outlet)).toEqual([]);
    }
  });

  it("leaves ordinary bylines alone", () => {
    expect(citeName(splitAuthors("Alhussein Fawzi"))).toBe("Fawzi");
    expect(citeName(splitAuthors("Ty Bishop, Rachel Chen and Omar Farouk"))).toBe("Bishop et al.");
    expect(citeName(splitAuthors("By Jane Smith"))).toBe("Smith");
    expect(citeName(splitAuthors("Dr. Jane Smith"))).toBe("Smith");
    expect(citeName(splitAuthors("Jean-Paul Fitoussi and Amartya Sen"))).toBe("Fitoussi et al.");
  });
});

/**
 * Surname-first bylines with trailing initials — "Acemoglu D", "Nakamoto S".
 *
 * This is the dominant format in journals, PubMed and wire metadata, and it
 * broke in the exact way a user reported: the cite "just takes the last word
 * rather than the actual author", printing the trailing INITIAL ("D", "S")
 * where the surname belongs. Each case fixes one real citation.
 */
describe("surname-first bylines with trailing initials", () => {
  const cases: Array<[string, string]> = [
    ["Acemoglu D", "Acemoglu"],
    ["Acemoglu D.", "Acemoglu"],
    ["Acemoglu DA", "Acemoglu"],
    ["He K", "He"],
    ["Smith J", "Smith"],
    ["Smith JA", "Smith"],
    ["Nakamoto S", "Nakamoto"],
    ["van der Berg M", "van der Berg"],
  ];
  for (const [raw, want] of cases) {
    it(`cites ${JSON.stringify(raw)} as ${JSON.stringify(want)}, not the initial`, () => {
      expect(surnameOf(raw)).toBe(want);
      expect(citeName(splitAuthors(raw))).toBe(want);
    });
  }

  it("still reads a real surname that follows given names", () => {
    // The fix must not fire on ordinary "Given Surname" — the surname is still
    // last there, and a short lowercase surname is not an initial.
    expect(surnameOf("Kaiming He")).toBe("He");
    expect(surnameOf("Daron Acemoglu")).toBe("Acemoglu");
    expect(surnameOf("Y. Bengio")).toBe("Bengio");
  });
});
