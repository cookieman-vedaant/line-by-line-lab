import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ingestCaselist,
  ingestCaselistArchive,
  ingestableCaselists,
} from "@/services/wikiIngest";

/**
 * Wiki index ingestion — one caselist per call.
 *
 * Building the whole index is long-running (dozens of caselists, each a zip of
 * many files), so it is split one-caselist-per-request to stay inside a
 * function's time limit. `scripts/ingest-wiki.mjs` (and, later, a weekly cron)
 * calls GET to enumerate the caselists, then POST once per caselist.
 *
 * Protected by CRON_SECRET, exactly like the retention purge: it writes the
 * shared corpus with the service-role key and runs a dedicated Tabroom login, so
 * it must never be triggerable by a stranger who guesses the path.
 */

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret set: allowed only outside production, so local ingestion works
    // but a misconfigured production deploy can't expose an open ingest endpoint.
    return process.env.NODE_ENV !== "production";
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** List the caselists to ingest, so the orchestrator can iterate them. */
export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const caselists = await ingestableCaselists();
    return NextResponse.json({ caselists });
  } catch (err) {
    console.error("wiki/ingest list failed", err);
    return NextResponse.json({ error: "Couldn't list caselists." }, { status: 502 });
  }
}

const bodySchema = z.object({
  caselist: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+$/i, "Not a caselist slug."),
  // Optional: ingest a SINGLE weekly archive by name (the resumable backfill
  // path — see scripts/ingest-archives.mjs). Names look like
  // "hsld25-weekly-2026-01-13.zip"; the service validates the name against the
  // caselist's real listing before fetching, so this can't reach an arbitrary URL.
  archive: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9._-]+$/i, "Not an archive name.")
    .optional(),
});

/** Ingest one caselist into the index. */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide a caselist slug." }, { status: 400 });
  }

  try {
    const { caselist, archive } = parsed.data;
    const summary = archive
      ? await ingestCaselistArchive(caselist, archive)
      : await ingestCaselist(caselist);
    return NextResponse.json({ summary });
  } catch (err) {
    console.error(`wiki/ingest "${parsed.data.caselist}" failed`, err);
    return NextResponse.json({ error: "Ingestion failed for that caselist." }, { status: 500 });
  }
}
