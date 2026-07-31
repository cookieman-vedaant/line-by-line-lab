import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { clientKeyFromRequest } from "@/lib/requestClient";
import { runAssistant } from "@/services/assistant";
import { EVIDENCE_TYPES } from "@/types";

// A single Coach turn can search AND cut, so give it room like the cut route.
export const maxDuration = 120;

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  context: z
    .object({
      evidenceType: z.enum(EVIDENCE_TYPES).optional(),
      claim: z.string().max(1000).optional(),
      // Headroom above the /api/pdf extract cap (200k) so a full-file upload is
      // never rejected here; the assistant service does the final bounding.
      document: z.string().max(210000).optional(),
      // Compact local profile summary (skill + weaknesses) so the Coach adapts.
      profile: z.string().max(2000).optional(),
      // Compact local round-log summary (record + recent rounds) for specifics.
      record: z.string().max(6000).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  // A Coach turn can carry an uploaded document + long history — allow 1 MB.
  const blocked = await guardApi(req, { name: "coach", bodyLimitBytes: 1024 * 1024 });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A conversation message is required." }, { status: 400 });
  }

  const { messages } = parsed.data;
  if (messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "The latest message must be from the user." }, { status: 400 });
  }

  try {
    const result = await runAssistant(parsed.data, { clientKey: clientKeyFromRequest(req) });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("assistant failed", err);
    return NextResponse.json(
      { error: "The coach ran into a problem. Please try again." },
      { status: 500 },
    );
  }
}
