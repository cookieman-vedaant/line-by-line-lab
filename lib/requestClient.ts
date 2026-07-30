/**
 * Identify the "client" behind a request for per-person rate limiting, WITHOUT
 * accounts (the MVP has no auth). Prefer a per-browser id the client sends
 * (fair to individual debaters even behind a shared school network); fall back
 * to the forwarded IP, then a constant. This is a soft identifier — good enough
 * to keep any one person from draining the free web-search budget.
 */
export function clientKeyFromRequest(req: Request): string {
  const id = req.headers.get("x-lbl-client");
  if (id && /^[A-Za-z0-9_-]{8,100}$/.test(id)) return `id:${id}`;

  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim();
  if (ip) return `ip:${ip}`;

  return "anon";
}
