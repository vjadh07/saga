import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Ledger } from "../src/ledger/ledger.js";
import type { ActionState, LedgerEvent } from "../src/ledger/types.js";
import { startViewer, type Viewer } from "../src/viewer/server.js";

let viewer: Viewer;
let base: string;
let dir: string;
let ledgerPath: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "saga-viewer-"));
  ledgerPath = join(dir, "ledger.db");
  viewer = await startViewer({ ledgerPath, port: 0 });
  base = `http://127.0.0.1:${viewer.port}`;
});

afterAll(async () => {
  await viewer.close();
  rmSync(dir, { recursive: true, force: true });
});

test("api reflects events appended by a separate ledger instance", async () => {
  const empty = (await (await fetch(`${base}/api/ledger`)).json()) as {
    actions: ActionState[];
    events: LedgerEvent[];
  };
  expect(empty.events).toEqual([]);
  expect(empty.actions).toEqual([]);

  // a different connection writes, exactly like the agent process would
  const writer = new Ledger(ledgerPath);
  writer.append({ sagaId: "trip", actionId: "a1", event: "STAGED", payload: { type: "flight.book" } });
  writer.append({ sagaId: "trip", actionId: "a1", event: "CALLED", payload: {} });
  writer.append({ sagaId: "other", actionId: "b1", event: "STAGED", payload: { type: "hotel.book" } });
  writer.close();

  const body = (await (await fetch(`${base}/api/ledger`)).json()) as {
    actions: ActionState[];
    events: LedgerEvent[];
  };
  expect(body.events).toHaveLength(3);
  expect(body.events.map((e) => e.seq)).toEqual([1, 2, 3]);

  // actions cover every saga and fold to the latest state
  const byId = new Map(body.actions.map((a) => [a.actionId, a]));
  expect(byId.get("a1")?.state).toBe("CALLED");
  expect(byId.get("a1")?.staged).toEqual({ type: "flight.book" });
  expect(byId.get("b1")?.sagaId).toBe("other");
});

test("root serves the timeline page", async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("/api/ledger");
});
