import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";

// PDF parsing is CPU work; give it room but not forever.
export const maxDuration = 30;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
// Bound the text the Coach ingests. A real debate file (1NC shell + 2NR blocks +
// cards) runs tens of thousands of characters, so this must be big enough that
// the WHOLE file — including the 2NR near the end — reaches the model. ~200k
// chars ≈ a 60–80 page file. Must stay ≤ the /api/assistant document cap so a
// full extract is never rejected downstream. Larger files are trimmed + flagged.
const MAX_TEXT_CHARS = 200000;

/**
 * Extract selectable text from an uploaded PDF so the Coach can critique the
 * debater's own case/block/card. Uses unpdf (a serverless-safe pdf.js build) —
 * no worker setup, no jsdom-class serverless crashes. Returns text only; the
 * file itself is never stored.
 */
export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  // Allow the 12 MB file (+ multipart overhead); PDF parsing isn't an AI call,
  // so it's rate-limited but doesn't count toward the global AI ceiling.
  const blocked = await guardApi(req, {
    name: "pdf",
    bodyLimitBytes: MAX_BYTES + 1024 * 1024,
    countGlobal: false,
    requireAuth: true,
  });
  if (blocked) return blocked;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a PDF file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file was provided." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "The PDF must be under 12 MB." },
      { status: 400 },
    );
  }

  let text: string;
  let pages: number;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const result = await extractText(pdf, { mergePages: true });
    pages = result.totalPages;
    text = (Array.isArray(result.text) ? result.text.join("\n\n") : result.text).trim();
  } catch (err) {
    console.error("pdf extract failed", err);
    return NextResponse.json(
      { error: "Couldn't read that PDF — it may be corrupted. Try re-exporting it." },
      { status: 422 },
    );
  }

  if (text.length < 20) {
    return NextResponse.json(
      {
        error:
          "No selectable text found — this looks like a scanned/image PDF. Upload a text-based PDF (or paste the text into the chat).",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    text: text.slice(0, MAX_TEXT_CHARS),
    pages,
    chars: text.length,
    truncated: text.length > MAX_TEXT_CHARS,
  });
}
