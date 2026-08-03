import "server-only";

/**
 * Outbound transactional email, via Resend.
 *
 * WHY THIS EXISTS: feedback was being written to Postgres and nowhere else. The
 * form said "sent", the row landed in `public.feedback`, and the operator never
 * heard about it — a reporting channel nobody watches is the same as no channel.
 *
 * FULLY OPTIONAL, like every other integration here. With no RESEND_API_KEY the
 * functions below no-op and log; the feedback row is still stored, so the app
 * never breaks because email isn't configured.
 *
 * Resend's free tier is 3,000 emails/month with no card, which is far beyond
 * what bug reports from a debate app will use.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML: nothing here needs markup, and plain
   *  text can't carry an injection payload into a mail client. */
  text: string;
  /** Where replies go — set to the reporter so you can just hit Reply. */
  replyTo?: string;
}

/**
 * Send one email. Never throws: a delivery failure must not fail the user's
 * action (their feedback is already safely stored). Returns whether it sent.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info("email: RESEND_API_KEY not set — skipping send:", input.subject);
    return false;
  }

  // Resend requires a verified domain to send from an arbitrary address. Until
  // one is set up, their shared onboarding sender works for mail to your OWN
  // Resend account address, which is exactly the operator-notification case.
  const from = process.env.EMAIL_FROM || "Line by Line Lab <onboarding@resend.dev>";

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      // Bound it: an unreachable mail provider must not hold the request open.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn("email: send failed", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("email: send threw", String(err));
    return false;
  }
}
