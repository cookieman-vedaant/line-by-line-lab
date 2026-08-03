import type { ComposedCard, Run } from "@/lib/cardFormat";

/**
 * Card downloads.
 *
 * Both formats render from the SAME composed runs the preview draws, so what
 * gets downloaded is what was on screen. The .docx is built with the `docx`
 * package, imported dynamically so its ~500KB never lands in the app bundle for
 * the people who don't click Download. PDF goes through the browser's own print
 * pipeline, which lays out real fonts rather than re-implementing text layout.
 */

/**
 * Word only accepts named highlight colors, not arbitrary hex, so the three the
 * toolbar offers are mapped onto its names. The literal union is deliberate:
 * a widened `string` here compiles but produces a .docx Word silently rejects.
 */
const DOCX_HIGHLIGHT: Record<string, "cyan" | "yellow" | "green"> = {
  "#00ffff": "cyan",
  "#ffff00": "yellow",
  "#00ff00": "green",
};

function safeName(cite: string): string {
  const base = cite.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
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
  // Give the download a tick to start before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadDocx(composed: ComposedCard, cite: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");

  const toRuns = (runs: Run[], greyMuted: boolean) =>
    runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          underline: r.underline ? {} : undefined,
          // docx sizes are half-points.
          size: r.sizePt * 2,
          font: composed.font,
          color: greyMuted && r.muted ? "808080" : "000000",
          highlight: r.highlight ? DOCX_HIGHLIGHT[r.highlight.toLowerCase()] : undefined,
        }),
    );

  const spacing = { before: 40, after: 0 }; // 2pt before, tight like a real card

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: toRuns(composed.tag, false), spacing }),
          new Paragraph({
            children: [
              ...toRuns(composed.cite, false),
              new TextRun({
                text: ` [${composed.citeDetails}]`,
                size: 22,
                font: composed.font,
                color: "808080",
              }),
            ],
            spacing,
          }),
          ...composed.body.map(
            (para) => new Paragraph({ children: toRuns(para, true), spacing }),
          ),
        ],
      },
    ],
  });

  triggerDownload(await Packer.toBlob(doc), `${safeName(cite)}.docx`);
}

/**
 * PDF via the browser's print dialog. globals.css hides everything except the
 * element marked data-printing during the print, so the sheet contains the card
 * and nothing else. The attribute is cleared on afterprint, including when the
 * dialog is cancelled.
 */
export function printCard(card: HTMLElement): void {
  const root = document.documentElement;
  card.setAttribute("data-printing", "");
  root.setAttribute("data-print-mode", "");

  const cleanup = () => {
    card.removeAttribute("data-printing");
    root.removeAttribute("data-print-mode");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
