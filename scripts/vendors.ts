import { mkdirSync } from "node:fs";
import { startVendorServer } from "../src/vendors/server.js";

mkdirSync("data", { recursive: true });
const port = Number(process.env.VENDOR_PORT ?? 4100);
const server = await startVendorServer({
  dbPath: process.env.VENDOR_DB ?? "data/vendors.db",
  port,
});
console.log(`mock vendors listening on http://127.0.0.1:${server.port}`);
