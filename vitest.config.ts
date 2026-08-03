import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig's "@/*" path alias.
      "@": path.resolve(__dirname),
      /*
       * `server-only` ships two entry points: a no-op under React's
       * "react-server" export condition, and a module that THROWS under any
       * other. Next.js sets that condition for server code; Vitest doesn't, so
       * every server module importing the guard would fail to load here.
       *
       * Aliasing to the no-op gives tests the same resolution the server build
       * gets. It does NOT weaken the guard: its job is to fail the Next build
       * when a Client Component imports a server-only module, and that check
       * still runs at build time.
       */
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      // Pure logic only. Route handlers, React components, and config are
      // verified in the browser, not by unit tests — including them would make
      // the number describe how much UI exists rather than whether the logic
      // that matters is tested.
      include: ["lib/**/*.ts", "services/**/*.ts"],
      exclude: ["**/*.test.ts", "lib/supabase/**", "lib/redis.ts"],
      /*
       * A RATCHET, not a target. These sit just below the coverage that exists
       * today (44/40/40/44 as of 2026-08-03), so the build fails when coverage
       * REGRESSES while passing on current code.
       *
       * Set deliberately low rather than aspirationally high: a threshold that
       * fails on day one gets deleted within a week, and then there's no ratchet
       * at all. Raise these as coverage improves; never lower them to turn a red
       * build green.
       *
       * The number is low mostly because `services/` is I/O-heavy (network calls
       * to Gemini, OpenAlex, article hosts) and is verified end-to-end in the
       * browser instead. The pure logic that must not break — emphasis,
       * cardMarkup, verbatim, json, the budget math — is covered well above this.
       */
      thresholds: {
        statements: 43,
        branches: 38,
        functions: 38,
        lines: 43,
      },
    },
  },
});
