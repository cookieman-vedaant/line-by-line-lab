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
 */
initBotId({
  protect: [
    { path: "/api/search", method: "POST" },
    { path: "/api/cut", method: "POST" },
    { path: "/api/assistant", method: "POST" },
    { path: "/api/theme", method: "POST" },
    { path: "/api/pdf", method: "POST" },
    { path: "/api/profile", method: "POST" },
  ],
});
