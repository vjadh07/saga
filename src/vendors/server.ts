import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { SEARCH_FIXTURES } from "./fixtures.js";

export interface VendorServer {
  port: number;
  close(): Promise<void>;
}

interface BookingRow {
  key: string;
  vendor: string;
  item: string;
  created_at: string;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function bookingBody(row: BookingRow) {
  return {
    bookingId: row.key,
    key: row.key,
    vendor: row.vendor,
    item: JSON.parse(row.item) as Record<string, unknown>,
    status: "confirmed",
    createdAt: row.created_at,
  };
}

export async function startVendorServer(opts: {
  dbPath: string;
  port: number;
}): Promise<VendorServer> {
  const db = new DatabaseSync(opts.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      key TEXT PRIMARY KEY,
      vendor TEXT NOT NULL,
      item TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS failures (
      key TEXT PRIMARY KEY,
      mode TEXT NOT NULL
    )
  `);

  const getBooking = (key: string) =>
    db.prepare("SELECT * FROM bookings WHERE key = ?").get(key) as unknown as
      | BookingRow
      | undefined;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    // admin endpoints: failure arming and test oracles
    if (parts[0] === "admin") {
      if (req.method === "POST" && parts[1] === "failures") {
        const body = await readJson(req);
        db.prepare("INSERT OR REPLACE INTO failures (key, mode) VALUES (?, ?)").run(
          String(body.key),
          String(body.mode),
        );
        return send(res, 204);
      }
      if (req.method === "GET" && parts[1] === "bookings") {
        const rows = db.prepare("SELECT * FROM bookings ORDER BY key").all() as unknown as BookingRow[];
        return send(res, 200, rows.map(bookingBody));
      }
      if (req.method === "POST" && parts[1] === "reset") {
        db.exec("DELETE FROM bookings; DELETE FROM failures;");
        return send(res, 204);
      }
      return send(res, 404, { error: "unknown admin route" });
    }

    const [vendor, resource, key] = parts;
    if (!vendor || !resource) return send(res, 404, { error: "not found" });

    if (req.method === "GET" && resource === "search") {
      return send(res, 200, SEARCH_FIXTURES[vendor] ?? []);
    }

    if (resource === "bookings") {
      if (req.method === "POST" && !key) {
        const body = await readJson(req);
        const bookingKey = String(body.key ?? "");
        if (!bookingKey) return send(res, 400, { error: "key required" });

        const existing = getBooking(bookingKey);
        if (existing) return send(res, 200, bookingBody(existing));

        db.prepare(
          "INSERT INTO bookings (key, vendor, item, created_at) VALUES (?, ?, ?, ?)",
        ).run(bookingKey, vendor, JSON.stringify(body.item ?? {}), new Date().toISOString());

        // scripted ambiguous failure: the work is done, the answer is a lie
        const armed = db
          .prepare("SELECT mode FROM failures WHERE key = ?")
          .get(bookingKey) as unknown as { mode: string } | undefined;
        if (armed) {
          db.prepare("DELETE FROM failures WHERE key = ?").run(bookingKey);
          return send(res, 500, { error: "internal error" });
        }
        return send(res, 201, bookingBody(getBooking(bookingKey)!));
      }

      if (req.method === "GET" && key) {
        const row = getBooking(key);
        return row ? send(res, 200, bookingBody(row)) : send(res, 404, { error: "no booking" });
      }

      if (req.method === "DELETE" && key) {
        db.prepare("DELETE FROM bookings WHERE key = ?").run(key);
        return send(res, 204);
      }
    }

    return send(res, 404, { error: "not found" });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        db.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
