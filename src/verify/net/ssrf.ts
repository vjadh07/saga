// SSRF defense. Pure URL and IP validation used before every fetch and after every
// redirect. Hostnames that are not literal IPs still need a resolved-IP check at connect
// time (see fetcher.ts); this file blocks literal private and special addresses, unsafe
// schemes, localhost, and embedded credentials.
import { isIP } from "node:net";

function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function isBlockedIpv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 unspecified
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && p[2] === 0) return true; // 192.0.0.0/24 special
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped or -embedded: ::ffff:1.2.3.4 or ::1.2.3.4
  const mapped = /(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(lower);
  if (mapped) return isBlockedIpv4(mapped[1]!);
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  const head = lower.split(":")[0] ?? "";
  const first = parseInt(head || "0", 16); // first 16-bit group
  const firstByte = first >> 8;
  // fc00::/7 unique-local (first byte fc or fd), fe80::/10 link-local (fe80..febf)
  if ((firstByte & 0xfe) === 0xfc) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) return isBlockedIpv6(ip);
  // strip brackets for [::1]
  const stripped = ip.replace(/^\[|\]$/g, "");
  if (isIP(stripped) === 6) return isBlockedIpv6(stripped);
  return false;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Validates a URL string for fetching. Throws on unsafe scheme, embedded credentials,
// localhost, or a literal blocked IP host. Returns the parsed URL for the caller.
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`unsupported scheme: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("URL must not contain embedded credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("blocked host: localhost");
  }
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    throw new Error(`blocked address: ${host}`);
  }
  return url;
}
