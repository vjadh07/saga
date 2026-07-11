// Read-only window onto the ledger. It opens its own connection to the same
// SQLite file the agent writes, so WAL mode is what makes the live view work.
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger } from "../ledger/ledger.js";

export interface Viewer {
  port: number;
  close(): Promise<void>;
}

const PAGE_PATH = join(dirname(fileURLToPath(import.meta.url)), "index.html");

export async function startViewer(opts: {
  ledgerPath: string;
  port: number;
}): Promise<Viewer> {
  const ledger = new Ledger(opts.ledgerPath);

  function send(res: ServerResponse, status: number, type: string, body: string): void {
    res.writeHead(status, { "content-type": type });
    res.end(body);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") {
      return send(res, 405, "application/json", '{"error":"read-only"}');
    }
    if (url.pathname === "/api/ledger") {
      const events = ledger.events();
      const sagaIds = [...new Set(events.map((e) => e.sagaId))];
      const actions = sagaIds.flatMap((id) => ledger.actions(id));
      return send(res, 200, "application/json", JSON.stringify({ actions, events }));
    }
    if (url.pathname === "/") {
      return send(res, 200, "text/html; charset=utf-8", readFileSync(PAGE_PATH, "utf8"));
    }
    return send(res, 404, "application/json", '{"error":"not found"}');
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        ledger.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
