import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  /* Article extraction uses linkedom (serverless-safe), not jsdom, so no
     special bundling config is needed. */
};

// withBotId adds the proxy rewrites BotID needs so its client challenge can't be
// blocked by ad-blockers. BotID runs only on Vercel (in prod); locally it's inert.
export default withBotId(nextConfig);
