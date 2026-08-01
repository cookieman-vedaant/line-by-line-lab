import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF defense for server-side fetches of USER-SUPPLIED URLs (article extraction).
 * Without this, a user could point the fetcher at internal services or the cloud
 * metadata endpoint (169.254.169.254) and turn our server into a proxy. We reject
 * non-http(s) schemes and any host that is — or resolves to — a private, loopback,
 * link-local, or reserved address, and we re-validate every redirect hop.
 */

export class BlockedUrlError extends Error {
  constructor(message = "That URL isn't allowed.") {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** Hostnames we never fetch, regardless of DNS. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** True for a private / loopback / link-local / reserved IP (v4 or v6). */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip.toLowerCase());
  // Not a valid IP literal — caller handles hostnames separately.
  return false;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false;
}

function isPrivateV6(ip: string): boolean {
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  // IPv4-mapped/embedded (::ffff:a.b.c.d or ::ffff:xxxx:xxxx) → check the v4 part.
  const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const first = ip.split(":")[0];
  // fc00::/7 unique-local (fc/fd), fe80::/10 link-local (fe8..feb), ff00::/8 multicast.
  if (/^f[cd]/.test(first)) return true;
  if (/^fe[89ab]/.test(first)) return true;
  if (/^ff/.test(first)) return true;
  return false;
}

/**
 * Validate a URL is safe to fetch server-side. Throws BlockedUrlError on any
 * non-http(s) scheme, blocked hostname, or private/reserved address (checking
 * every DNS answer for a hostname). Returns the parsed URL when safe.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("That URL is malformed.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http(s) URLs can be fetched.");
  }

  // URL() keeps IPv6 literals in brackets — strip them for the checks.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new BlockedUrlError("That host isn't allowed.");
  }

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError("That address isn't allowed.");
    return url;
  }

  // Hostname → resolve and reject if ANY answer is private (defeats DNS tricks).
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("That host could not be resolved.");
  }
  if (addresses.length === 0) throw new BlockedUrlError("That host could not be resolved.");
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new BlockedUrlError("That host resolves to a private address.");
    }
  }
  return url;
}

interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * fetch() for user-supplied URLs, hardened against SSRF: validates the target
 * (and every redirect hop) with assertPublicUrl before making the request, and
 * follows redirects manually so a 3xx can't bounce us to an internal address.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      headers: opts.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }

  throw new BlockedUrlError("Too many redirects.");
}
