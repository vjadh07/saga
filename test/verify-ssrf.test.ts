import { expect, test } from "vitest";
import { assertSafeUrl, isBlockedIp } from "../src/verify/net/ssrf.js";

test("blocks loopback, private, link-local, metadata, and unspecified IPs", () => {
  for (const ip of [
    "127.0.0.1",
    "127.5.5.5",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.0.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "::1", // IPv6 loopback
    "::", // IPv6 unspecified
    "fe80::1", // IPv6 link-local
    "fc00::1", // IPv6 unique-local
    "fd00:ec2::254", // AWS IPv6 metadata
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ]) {
    expect(isBlockedIp(ip), ip).toBe(true);
  }
});

test("allows ordinary public IPs", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
    expect(isBlockedIp(ip), ip).toBe(false);
  }
});

test("assertSafeUrl rejects non-http(s) schemes", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com", "gopher://x", "data:text/html,x", "javascript:alert(1)"]) {
    expect(() => assertSafeUrl(u), u).toThrow();
  }
});

test("assertSafeUrl rejects localhost and literal private hosts", () => {
  for (const u of [
    "http://localhost/",
    "http://localhost:8080/x",
    "http://127.0.0.1/",
    "http://[::1]/",
    "https://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/internal",
    "http://192.168.0.1/admin",
  ]) {
    expect(() => assertSafeUrl(u), u).toThrow();
  }
});

test("assertSafeUrl rejects embedded credentials", () => {
  expect(() => assertSafeUrl("https://user:pass@example.com/")).toThrow(/credential/i);
});

test("assertSafeUrl allows a normal public URL and returns the parsed URL", () => {
  const u = assertSafeUrl("https://example.com/article?id=5");
  expect(u.hostname).toBe("example.com");
  expect(u.protocol).toBe("https:");
});
