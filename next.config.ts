import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom must NOT be bundled: the bundled copy loads fine locally but crashes
  // the serverless function at import on Vercel (every /api/cut returned a 500
  // HTML page -> the client showed "Could not reach the server"). Marking it
  // external makes Next require it from node_modules at runtime instead.
  serverExternalPackages: ["jsdom"],
};

export default nextConfig;
