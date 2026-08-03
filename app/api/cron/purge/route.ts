import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled data-retention purge (see supabase/migrations/…_retention.sql).
 *
 * Enforces GDPR Art. 5(1)(e) storage limitation: security data containing IP
 * addresses is deleted once past its retention window, instead of accumulating
 * forever. A retention POLICY that nothing executes is just a paragraph.
 *
 * Wired to a Vercel Cron in vercel.json (daily). Vercel signs cron invocations
 * with CRON_SECRET; we require it so this can't be triggered by anyone who
 * guesses the path — it deletes data, so an open endpoint would be a denial-of-
 * evidence vector.
 */

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Refuse to run unauthenticated in production rather than expose a
    // data-deleting endpoint to the open internet.
    console.error("cron/purge: CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ error: "Not configured." }, { status: 503 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("purge_expired_data");
    if (error) {
      console.error("cron/purge failed", error);
      return NextResponse.json({ error: "Purge failed." }, { status: 500 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    console.info("cron/purge complete", row);
    return NextResponse.json({ ok: true, ...(row ?? {}) });
  } catch (err) {
    console.error("cron/purge unavailable", err);
    return NextResponse.json({ error: "Purge unavailable." }, { status: 503 });
  }
}
