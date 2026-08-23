import { initBotId } from "botid/client/core";

/**
 * Client-side half of Vercel BotID (basic mode — free on all plans). It runs an
 * invisible challenge in the browser and attaches the solution to requests going
 * to the paths listed below; the matching routes then verify it server-side via
 * checkBotId() (see lib/botCheck.ts). Every path here MUST also call checkBotId()
 * on the server, or the check fails.
 *
 * These are exactly our expensive, AI-backed POST endpoints — the ones a bot
 * would target to burn the free quota.
 *
 * DELIBERATELY ABSENT:
 *  - /api/auth-attempt — it runs BEFORE sign-in, on the most fragile flow in the
 *    app. That form already requires a Turnstile solve, which is a stronger and
 *    more visible check than an invisible challenge; stacking a second one on
 *    the signup path risks locking out legitimate first-time users, and a false
 *    positive there costs a customer rather than a few tokens.
 *  - /api/feedback — auth-gated, tightly rate-limited, and not AI-backed. Making
 *    it harder to report a bug is a bad trade.
 *  (/api/wiki/search IS protected: it's an authed database search that a bot
 *    could otherwise scrape in bulk.)
 */
initBotId({
  protect: [
    { path: "/api/search", method: "POST" },
    { path: "/api/sharpen", method: "POST" },
    { path: "/api/cut", method: "POST" },
    { path: "/api/rehighlight", method: "POST" },
    { path: "/api/assistant", method: "POST" },
    { path: "/api/theme", method: "POST" },
    { path: "/api/pdf", method: "POST" },
    { path: "/api/profile", method: "POST" },
    { path: "/api/wiki/search", method: "POST" },
  ],
});
