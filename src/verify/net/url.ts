// URL canonicalization and result deduplication. Canonical URLs let lineage detect the
// same story syndicated under different tracking parameters, and let retrieval avoid
// fetching the same page twice.

const TRACKING = /^(utm_|fbclid$|gclid$|mc_eid$|igshid$|ref$|ref_src$)/i;

export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

export function dedupByCanonical<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = canonicalizeUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
