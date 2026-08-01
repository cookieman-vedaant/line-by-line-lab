import { describe, expect, it } from "vitest";
import { assertPublicUrl, BlockedUrlError, isPrivateIp } from "./ssrfGuard";

describe("isPrivateIp — IPv4", () => {
  it("flags private / reserved ranges", () => {
    for (const ip of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "11.0.0.1", "93.184.216.34"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("isPrivateIp — IPv6", () => {
  it("flags loopback / ULA / link-local / mapped-v4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows public v6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false); // cloudflare dns
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("ftp://example.com")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects blocked hostnames", async () => {
    await expect(assertPublicUrl("http://localhost/x")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("http://metadata.google.internal/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects private IP literals (no DNS needed)", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    await expect(assertPublicUrl("http://10.0.0.5:8080/admin")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("allows a public IP literal", async () => {
    const u = await assertPublicUrl("http://8.8.8.8/");
    expect(u.hostname).toBe("8.8.8.8");
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
