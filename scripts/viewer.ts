import { mkdirSync } from "node:fs";
import { startViewer } from "../src/viewer/server.js";

mkdirSync("data", { recursive: true });
const port = Number(process.env.VIEWER_PORT ?? 4200);
const viewer = await startViewer({
  ledgerPath: process.env.LEDGER_PATH ?? "data/ledger.db",
  port,
});
console.log(`ledger viewer on http://127.0.0.1:${viewer.port}`);
