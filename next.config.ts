import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

/**
 * Content-Security-Policy — shipped in REPORT-ONLY first so it can never break a
 * page on the live app; it logs violations to the browser console instead. Once
 * we've confirmed no legitimate resource is flagged, flip the header name to
 * "Content-Security-Policy" to enforce it.
 *
 * Allowances: 'unsafe-inline' scripts cover Next's hydration bootstrap + our
 * theme pre-paint script (layout.tsx); next/font self-hosts fonts (same origin);
 * Supabase auth/REST/realtime is *.supabase.co (+ wss); Turnstile (optional) is
 * challenges.cloudflare.com. Clickjacking is enforced separately via
 * X-Frame-Options below (frame-ancestors in report-only mode only reports).
 */
const cspReportOnly = [
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
  // CSP, non-blocking for now (see note above).
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
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
