import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Append-only audit trail for security-relevant events (see the `audit_log`
 * table). This is the record you reach for when a user disputes an action, when
 * you're working out how an abusive account got in, or when a payment provider
 * asks how you handle account deletion.
 *
 * Design rules:
 *  - NEVER log user CONTENT (article text, card bodies, Coach messages). This is
 *    a security log, not analytics — content here would multiply the blast
 *    radius of a leak and contradict the privacy policy's data-minimization.
 *  - Writes are BEST-EFFORT and never throw. An audit write failing must not
 *    take down a sign-up or a deletion; a missing log line is better than a
 *    broken user action. Failures are surfaced on the server console.
 *  - The table revokes UPDATE/DELETE from every Data-API role, so entries can't
 *    be rewritten after the fact through the app's own credentials.
 */

/** Events worth recording. A closed set so log queries stay predictable. */
export const AUDIT_ACTIONS = [
  "account.deleted",
  "account.delete_failed",
  "auth.signup_throttled",
  "auth.resend_throttled",
  "ip.banned",
  "ip.ban_blocked_request",
  "tier.changed",
  "feedback.submitted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  /** The acting user, when there is one. */
  userId?: string | null;
  /** Network IP of the request, for abuse correlation. */
  ip?: string | null;
  /** Structured context. Keep it small and free of user content. */
  detail?: Record<string, unknown>;
}

/**
 * Record one audit event. Fire-and-forget: callers may `void audit(...)` without
 * awaiting when the event shouldn't add latency to a user action.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_log").insert({
      user_id: entry.userId ?? null,
      action: entry.action,
      detail: entry.detail ?? {},
      ip: entry.ip ?? null,
    });
    if (error) console.warn("audit: insert failed", entry.action, error.message);
  } catch (err) {
    // Admin client unavailable (no service_role key in this environment) or the
    // table isn't migrated yet. Both are non-fatal by design.
    console.warn("audit: unavailable", entry.action, String(err));
  }
}
