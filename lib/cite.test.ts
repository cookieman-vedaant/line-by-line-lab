import { describe, expect, it } from "vitest";
import {
  citeName,
  citeYear,
  looksLikeOrganization,
  mostRecentDate,
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
