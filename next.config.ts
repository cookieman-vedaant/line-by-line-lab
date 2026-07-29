import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Article extraction uses linkedom (serverless-safe), not jsdom, so no
     special bundling config is needed. */
};

export default nextConfig;
