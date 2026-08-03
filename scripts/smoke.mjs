#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING server.
 *
 *   npm run build && npm start &      # or: npm run dev
 *   npm run smoke                      # defaults to http://localhost:3000
 *   SMOKE_URL=https://line-by-line-lab.vercel.app npm run smoke
 *
 * WHY THIS EXISTS: the unit suite covers pure logic, but it cannot catch the
 * failures that actually took this app down — a route returning a 500 HTML error
 * page because a dependency didn't bundle for serverless, an auth gate silently
 * ungating itself after a matcher edit, or a security header being dropped by a
 * config refactor. Those are only visible against a real server over HTTP.
 *
 * It asserts the SECURITY BOUNDARIES rather than happy paths, because those are
 * what must never regress and what can be checked without credentials.
 */

const BASE = process.env.SMOKE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* empty body is fine */
  }
  return { status: res.status, headers: res.headers, body };
}

const json = { "Content-Type": "application/json", Origin: BASE };

console.log(`\nSmoke test → ${BASE}\n`);

// ── Public pages ───────────────────────────────────────────────────────────
console.log("Public pages");
const home = await req("/");
check("GET / returns 200", home.status === 200, `got ${home.status}`);
check("GET / is real HTML, not an error shell", !home.body.includes("__next_error__"));
const privacy = await req("/privacy");
check("GET /privacy returns 200", privacy.status === 200, `got ${privacy.status}`);

// ── Security headers ───────────────────────────────────────────────────────
console.log("\nSecurity headers");
check("HSTS present", !!home.headers.get("strict-transport-security"));
check("X-Frame-Options DENY", home.headers.get("x-frame-options") === "DENY");
check("X-Content-Type-Options nosniff", home.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy set", !!home.headers.get("referrer-policy"));
check("Permissions-Policy set", !!home.headers.get("permissions-policy"));
check(
  "CSP present (enforced or report-only)",
  !!(home.headers.get("content-security-policy") || home.headers.get("content-security-policy-report-only")),
);

// ── Auth gate ──────────────────────────────────────────────────────────────
console.log("\nAuth gate");
const lab = await req("/lab");
check("GET /lab redirects when signed out", lab.status === 307 || lab.status === 302, `got ${lab.status}`);
check(
  "redirect target stays on this origin",
  (lab.headers.get("location") ?? "").startsWith("/") ||
    (lab.headers.get("location") ?? "").startsWith(BASE),
  lab.headers.get("location") ?? "(none)",
);

// ── API routes reject anonymous callers ────────────────────────────────────
console.log("\nAPI routes reject anonymous callers");
for (const ep of ["search", "cut", "rehighlight", "assistant", "theme", "profile", "rounds", "feedback", "presence"]) {
  const r = await req(`/api/${ep}`, { method: "POST", headers: json, body: "{}" });
  check(
    `POST /api/${ep} is blocked (401/403), never 200/500`,
    r.status === 401 || r.status === 403 || r.status === 429,
    `got ${r.status}`,
  );
}
const acct = await req("/api/account", { method: "GET", headers: json });
check("GET /api/account requires auth", acct.status === 401 || acct.status === 403, `got ${acct.status}`);
const del = await req("/api/account", { method: "DELETE", headers: json });
check("DELETE /api/account requires auth", del.status === 401 || del.status === 403, `got ${del.status}`);

// ── Cross-origin rejection ─────────────────────────────────────────────────
console.log("\nCross-origin protection");
const xo = await req("/api/feedback", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
  body: JSON.stringify({ kind: "bug", message: "cross-site attempt" }),
});
check("cross-origin POST is rejected", xo.status === 403, `got ${xo.status}`);

// ── Input validation ───────────────────────────────────────────────────────
console.log("\nInput validation");
const bad = await req("/api/auth-attempt", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ kind: "signup", email: "not-an-email" }),
});
check("malformed email rejected with 400", bad.status === 400, `got ${bad.status}`);
const badKind = await req("/api/auth-attempt", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ kind: "../../etc/passwd", email: "a@b.com" }),
});
check("unknown enum value rejected", badKind.status === 400, `got ${badKind.status}`);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
