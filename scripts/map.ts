// Extract atomic claims from a document with the live LLM Claim Mapper:
//   npm run map -- path/to/file.txt
//   echo "some text" | npm run map
// This is the genuinely agentic stage. It needs the local Claude Code login. The rest of
// the pipeline (evidence, verdicts) is deterministic and runs via npm run verify.
import { readFileSync } from "node:fs";
import { extractClaims } from "../src/verify/agent/extract.js";

try {
  process.loadEnvFile();
} catch {
  // no .env is fine
}

const arg = process.argv[2];
const document = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
if (!document.trim()) {
  console.error('usage: npm run map -- path/to/file.txt   (or pipe text on stdin)');
  process.exit(2);
}

console.log("Claim Mapper extracting claims...\n");
const claims = await extractClaims(document, (m) => console.log(`  . ${m}`));

console.log(`\nExtracted ${claims.length} claim(s):\n`);
for (const c of claims) {
  const tags = [c.claimType, c.risk, c.verifiable ? "verifiable" : "not-verifiable", c.timeSensitive ? "time-sensitive" : ""]
    .filter(Boolean)
    .join(", ");
  console.log(`  [${tags}]`);
  console.log(`  "${c.originalText}"\n`);
}
