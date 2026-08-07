import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { botBlock } from "@/lib/botCheck";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { clientKeyFromRequest } from "@/lib/requestClient";
import { NoSourcesFoundError, findArticles } from "@/services/articleFinder";
import {
  CARD_LENGTHS,
  EVIDENCE_TYPES,
  PUBLICATION_AGES,
  SOURCE_TYPES,
  type SearchStreamEvent,
} from "@/types";

// Search fans out to two databases + two AI calls; don't cut it off early.
export const maxDuration = 60;

const searchRequestSchema = z.object({
  evidenceType: z.enum(EVIDENCE_TYPES),
  claim: z.string().trim().min(3, "Claim is too short").max(1000),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  publicationAge: z.enum(PUBLICATION_AGES).optional(),
  cardLength: z.enum(CARD_LENGTHS).optional(),
});

export async function POST(req: Request) {
  const bot = await botBlock();
  if (bot) return bot;
  const blocked = await guardApi(req, { name: "search", requireAuth: true });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => {
        const field = i.path.join(".");
        return field ? `${field}: ${i.message}` : i.message;
      })
      .join("; ");
    return NextResponse.json(
      {
        error: `Request rejected — ${detail}. If you filled everything in, hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to load the latest version.`,
      },
      { status: 400 },
    );
  }

  // Everything above this line can still answer with a status code, because
  // nothing has been written yet. Everything below is streamed.
  const clientKey = clientKeyFromRequest(req);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The client can disconnect mid-search (closed tab, navigation). Once it
      // has, enqueue throws — so latch the stream shut rather than letting the
      // pipeline's remaining stage callbacks throw one by one.
      let open = true;
      const send = (event: SearchStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      try {
        const articles = await findArticles(parsed.data, clientKey, (stage) =>
          send({ type: "stage", stage }),
        );
        send({ type: "result", articles });
      } catch (err) {
        send(searchErrorEvent(err));
      } finally {
        if (open) {
          try {
            controller.close();
          } catch {
            // Already closed by a client disconnect; nothing to do.
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Progress is worthless if an intermediary holds the bytes back.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Map a pipeline failure onto a terminal stream event, preserving the exact
 * user-facing messages the pre-streaming route returned.
 *
 * Note the status codes this replaces: a rate limit used to surface as HTTP 429
 * and a missing key as 500. Both are now `error` events on a 200 response,
 * because the headers were already sent. The UI is unaffected — it only ever
 * displayed the message — but anything added later that branches on status
 * needs to read the event instead.
 */
function searchErrorEvent(err: unknown): SearchStreamEvent {
  // An honest empty result, not a server failure.
  if (err instanceof NoSourcesFoundError) {
    return { type: "result", articles: [], notice: err.message };
  }
  if (err instanceof RateLimitedError || err instanceof MissingApiKeyError) {
    return { type: "error", error: err.message };
  }
  // Everything else: user-safe message; developer detail stays server-side.
  console.error("search failed", err);
  return { type: "error", error: "Something went wrong while searching. Please try again." };
}
