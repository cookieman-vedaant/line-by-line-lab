import { type CardDoc, type Run, docToHtmlFile } from "@/lib/cardRich";

/**
 * Card downloads.
 *
 * Both formats are built from the runs read off the live card, so a download is
 * what is on screen. The .docx mirrors the clipboard HTML property for property
 * (same sizes, weights, underlines, colors, background fills, 2pt paragraph
 * spacing, 1.07 line spacing), which is what makes a downloaded file match a
 * paste into Google Docs.
 *
 * `docx` is imported dynamically so its ~340KB never lands in the app bundle for
 * anyone who doesn't download.
 */

function safeName(text: string): string {
  const base = text
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base.length > 0 ? base : "card";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadDocx(doc: CardDoc, font: string, name: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, ShadingType, HeadingLevel } = await import("docx");

  const runs = (list: Run[]) =>
    list.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italic,
          underline: r.underline ? {} : undefined,
          size: Math.round(r.sizePt * 2), // docx sizes are half-points
          font,
          color: r.color,
          // Shading with the exact hex rather than one of Word's 16 named
          // highlight colors, so the fill matches the screen and the Docs paste.
          shading: r.highlight
            ? { type: ShadingType.CLEAR, color: "auto", fill: r.highlight }
            : undefined,
        }),
    );

  // 2pt before / 0 after, 1.07 line spacing: the same metrics as the HTML.
  const spacing = { before: 40, after: 0, line: 257, lineRule: "auto" as const };

  const doc_ = new Document({
    styles: { default: { document: { run: { font, size: 22, color: "000000" } } } },
    sections: [
      {
        children: [
          // Heading 3 so the tag lands in the document outline, exactly as the
          // clipboard HTML does with its <h3>.
          new Paragraph({ children: runs(doc.tag), heading: HeadingLevel.HEADING_3, spacing }),
          new Paragraph({ children: [...runs(doc.cite), new TextRun({ text: " " }), ...runs(doc.details)], spacing }),
          ...doc.body.map((p) => new Paragraph({ children: runs(p), spacing })),
        ],
      },
    ],
  });

  triggerDownload(await Packer.toBlob(doc_), `${safeName(name)}.docx`);
}

/** The card as a standalone .html file: opens anywhere, imports into Docs. */
export function downloadHtml(doc: CardDoc, font: string, name: string): void {
  const html = docToHtmlFile(doc, font, name);
  triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), `${safeName(name)}.html`);
}
