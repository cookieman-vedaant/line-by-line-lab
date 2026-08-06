import JSZip from "jszip";
import { DOMParser } from "linkedom";

/**
 * Read a `.docx` into paragraphs and runs, keeping the formatting that matters.
 *
 * Debate prep is Word documents, and in a debate document the FORMATTING IS THE
 * MEANING: highlighted text is what the debater reads aloud, underlining is the
 * supporting context, small grey text is context they skip. A reader that
 * returns plain text throws away the entire point of the file.
 *
 * So this reads the OOXML directly rather than going through a
 * document-to-HTML converter — those normalise styling away, and highlight
 * colour in particular is usually the first thing they drop. A `.docx` is a zip
 * of XML; `word/document.xml` holds the body, and every run carries its own
 * properties in `w:rPr`.
 *
 * Pure and dependency-light on purpose: bytes in, structure out, no network and
 * no knowledge of debate. `services/wikiCards.ts` decides what a card is.
 */

/** One contiguous stretch of identically-formatted text. */
export interface DocxRun {
  text: string;
  bold: boolean;
  underline: boolean;
  /** Any non-`none` `w:highlight`, or a shading fill — the read-aloud marker. */
  highlighted: boolean;
  /** Points. Word stores half-points in `w:sz`. Undefined when inherited. */
  sizePt?: number;
}

export interface DocxParagraph {
  runs: DocxRun[];
  /** `w:pStyle` value, e.g. `Heading1`…`Heading4`. Undefined for body text. */
  style?: string;
  /** Convenience: all run text joined. */
  text: string;
}

/** The file wasn't a readable Word document. */
export class DocxUnreadableError extends Error {
  constructor(message = "That file isn't a readable Word document.") {
    super(message);
    this.name = "DocxUnreadableError";
  }
}

/**
 * Word booleans are absent-means-false, but PRESENT means true only when the
 * value isn't an explicit off. `<w:b/>` is bold; `<w:b w:val="0"/>` is not, and
 * that form is common in prep that has been copied between documents — reading
 * it as bold would mark half a file as a tag.
 */
function isOn(parent: Element, tag: string): boolean {
  const el = parent.getElementsByTagName(tag)[0];
  if (!el) return false;
  const val = el.getAttribute("w:val");
  return val === null || !["0", "false", "off", "none"].includes(val.toLowerCase());
}

function highlightOf(rPr: Element): boolean {
  const hl = rPr.getElementsByTagName("w:highlight")[0]?.getAttribute("w:val");
  if (hl && hl.toLowerCase() !== "none") return true;
  // Some documents use shading instead of the highlighter pen.
  const fill = rPr.getElementsByTagName("w:shd")[0]?.getAttribute("w:fill");
  return !!fill && !["auto", "ffffff", "none"].includes(fill.toLowerCase());
}

function readRunProps(rPr: Element | undefined): Omit<DocxRun, "text"> {
  if (!rPr) return { bold: false, underline: false, highlighted: false };
  const szRaw = rPr.getElementsByTagName("w:sz")[0]?.getAttribute("w:val");
  const half = szRaw ? Number.parseInt(szRaw, 10) : NaN;
  return {
    bold: isOn(rPr, "w:b"),
    underline: isOn(rPr, "w:u"),
    highlighted: highlightOf(rPr),
    // w:sz is HALF-points — 22 means 11pt. Getting this wrong misclassifies
    // every card's context text.
    sizePt: Number.isFinite(half) ? half / 2 : undefined,
  };
}

/** Text carried by one `w:r`, including tabs and breaks as whitespace. */
function runText(r: Element): string {
  let out = "";
  for (const child of Array.from(r.children) as Element[]) {
    const name = child.tagName;
    if (name === "w:t") out += child.textContent ?? "";
    else if (name === "w:tab") out += "\t";
    else if (name === "w:br" || name === "w:cr") out += "\n";
  }
  return out;
}

/** Merge neighbours that look identical, so downstream sees whole phrases. */
function mergeRuns(runs: DocxRun[]): DocxRun[] {
  const out: DocxRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.bold === run.bold &&
      last.underline === run.underline &&
      last.highlighted === run.highlighted &&
      last.sizePt === run.sizePt
    ) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/**
 * Parse `.docx` bytes into paragraphs.
 *
 * Throws `DocxUnreadableError` for anything that isn't a Word document — legacy
 * `.doc`, PDFs, and corrupt uploads all appear on the wiki.
 */
export async function readDocx(bytes: ArrayBuffer | Uint8Array): Promise<DocxParagraph[]> {
  let xml: string;
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file("word/document.xml");
    if (!entry) throw new DocxUnreadableError();
    xml = await entry.async("string");
  } catch (err) {
    if (err instanceof DocxUnreadableError) throw err;
    throw new DocxUnreadableError();
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  } catch {
    throw new DocxUnreadableError("That document's contents couldn't be read.");
  }

  const paragraphs: DocxParagraph[] = [];
  for (const p of Array.from(doc.getElementsByTagName("w:p")) as Element[]) {
    const runs: DocxRun[] = [];

    // Runs nested in hyperlinks/smart tags are real text too — getElementsByTagName
    // reaches them, and a paragraph's own descendants can't include another
    // paragraph's runs because w:p never nests.
    for (const r of Array.from(p.getElementsByTagName("w:r")) as Element[]) {
      const text = runText(r);
      if (!text) continue;
      runs.push({ ...readRunProps(r.getElementsByTagName("w:rPr")[0] as Element | undefined), text });
    }

    const merged = mergeRuns(runs);
    const text = merged.map((r) => r.text).join("");
    // Keep empty paragraphs out; they carry no meaning and only fragment cards.
    if (text.trim().length === 0) continue;

    const style = p.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") ?? undefined;
    paragraphs.push({ runs: merged, style, text });
  }

  return paragraphs;
}
