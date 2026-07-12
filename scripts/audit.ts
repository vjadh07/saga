// Talk to Saga's auditor: npm run audit -- "investigate the hotels vendor"
import { Ledger } from "../src/ledger/ledger.js";
import { runAuditor } from "../src/agent/auditor.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file is fine
}

const promptText = process.argv.slice(2).join(" ").trim();
if (!promptText) {
  console.error('usage: npm run audit -- "investigate the hotels vendor"');
  process.exit(2);
}

const ledger = new Ledger(process.env.LEDGER_PATH ?? "data/ledger.db");
await runAuditor(
  {
    ledger,
    vendorBase: process.env.VENDOR_URL ?? "http://127.0.0.1:4100",
    reportsDir: "reports",
  },
  promptText,
);
ledger.close();
