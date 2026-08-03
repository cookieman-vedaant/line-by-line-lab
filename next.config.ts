import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

/**
 * Content-Security-Policy — defaults to REPORT-ONLY so it can never break a live
 * page; violations go to the browser console instead.
 *
 * TO ENFORCE: set CSP_ENFORCE=1 in the environment. Do that only AFTER loading
 * the app (landing, /lab, every tool, sign-in, theme switching) with the console
 * open and seeing zero CSP reports — an enforced policy with a missed allowance
 * silently breaks a feature for every user at once. Kept as an env flag rather
 * than a code edit so it can be flipped, and rolled back, without a deploy.
 *
 * Allowances: 'unsafe-inline' scripts cover Next's hydration bootstrap + our
 * theme pre-paint script (layout.tsx); next/font self-hosts fonts (same origin);
 * Supabase auth/REST/realtime is *.supabase.co (+ wss); Turnstile (optional) is
 * challenges.cloudflare.com. Clickjacking is enforced separately via
 * X-Frame-Options below (frame-ancestors in report-only mode only reports).
 *
 * KNOWN WEAKNESS: 'unsafe-inline' in script-src substantially limits what this
 * policy can stop, and removing it needs a nonce threaded through Next's inline
 * bootstrap — which conflicts with the prerendered static shell this app relies
 * on (cacheComponents). Documented rather than silently accepted; see
 * docs/adr/0003-security-headers.md.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
].join("; ");

const securityHeaders = [
  // Force HTTPS for 2 years incl. subdomains (Vercel already serves HTTPS only).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Don't let browsers MIME-sniff responses into a different content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking: this site may not be framed anywhere (enforced).
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak full URLs/paths to other origins in the Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop powerful features we never use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // CSP. Report-only unless CSP_ENFORCE=1 (see the note above).
  {
    key:
      process.env.CSP_ENFORCE === "1"
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only",
    value: csp,
  },
];

const nextConfig: NextConfig = {
  /* Partial Prerendering. The landing page is ~95% identical for every visitor;
     only the hero's sign-in box depends on the request. With this on, Next
     prerenders the static shell and streams just that slot, so marketing traffic
     is served from the CDN instead of re-rendering the whole tree per request.
     In Next 16 this single flag replaces experimental.ppr / dynamicIO / useCache. */
  cacheComponents: true,

  /* Article extraction uses linkedom (serverless-safe), not jsdom, so no
     special bundling config is needed. */
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// withBotId adds the proxy rewrites BotID needs so its client challenge can't be
// blocked by ad-blockers. BotID runs only on Vercel (in prod); locally it's inert.
export default withBotId(nextConfig);
