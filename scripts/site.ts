// Serve the landing page locally: npm run site
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const page = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "index.html");
const port = Number(process.env.SITE_PORT ?? 4400);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(page, "utf8"));
}).listen(port, "127.0.0.1", () => {
  console.log(`saga landing page on http://127.0.0.1:${port}`);
});
