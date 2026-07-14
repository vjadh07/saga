import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAuditApiServer } from "../src/verify/live/http.js";
import type { AuditRecord, StoredAudit } from "../src/verify/providers/store.js";
import type { AuditMode } from "../src/verify/mapview.js";

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

class FakeAuditService {
  readonly audits = new Map<string, StoredAudit>();
  readonly create = vi.fn(
    async (input: { document: string; mode: "live" | "demo"; auditMode?: AuditMode; workspaceId: string }) => {
      const id = `aud_${this.audits.size + 1}`;
      const record: AuditRecord = {
        id,
        mode: input.mode,
        auditMode: input.auditMode ?? "deep",
        document: input.document,
        workspaceId: input.workspaceId,
        status: "created",
        error: null,
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      };
      this.audits.set(id, { record, claims: [], evidence: [], events: [], result: null });
      return structuredClone(record);
    },
  );
  readonly get = vi.fn(async (id: string) => {
    const audit = this.audits.get(id);
    if (!audit) throw new Error(`audit not found: ${id}`);
    return structuredClone(audit);
  });
  readonly process = vi.fn(async (id: string) => {
    const audit = this.audits.get(id);
    if (!audit) throw new Error(`audit not found: ${id}`);
    audit.record.status = "completed";
  });
  readonly cancel = vi.fn(async (id: string) => {
    const audit = this.audits.get(id);
    if (!audit) throw new Error(`audit not found: ${id}`);
    audit.record.status = "cancelled";
  });
  readonly retry = vi.fn(async (id: string) => {
    const audit = this.audits.get(id);
    if (!audit) throw new Error(`audit not found: ${id}`);
    audit.record.status = "completed";
  });
}

async function startApi(
  service: FakeAuditService,
  options: { maxBodyBytes?: number; awaitJobs?: boolean; fallback?: (request: IncomingMessage, response: ServerResponse) => void } = {},
): Promise<{ baseUrl: string; enqueued: Array<() => Promise<void>> }> {
  const enqueued: Array<() => Promise<void>> = [];
  const server = createAuditApiServer({
    service,
    maxBodyBytes: options.maxBodyBytes,
    fallback: options.fallback,
    enqueue: async (job) => {
      enqueued.push(job);
      if (options.awaitJobs !== false) await job();
    },
  });
  openServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, enqueued };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/);
  return (await response.json()) as Record<string, unknown>;
}

describe("live audit HTTP API", () => {
  test.each(["quick", "deep", "high_stakes"] as const)(
    "POST /api/audits creates and enqueues a live %s audit in the guest workspace",
    async (mode) => {
      const service = new FakeAuditService();
      const { baseUrl, enqueued } = await startApi(service);

      const response = await fetch(`${baseUrl}/api/audits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: "  The original text is preserved.  ", mode }),
      });

      expect(response.status).toBe(202);
      expect(await json(response)).toMatchObject({
        audit: { id: "aud_1", mode: "live", auditMode: mode, status: "created", workspaceId: "guest" },
      });
      expect(service.create).toHaveBeenCalledWith({
        document: "  The original text is preserved.  ",
        mode: "live",
        auditMode: mode,
        workspaceId: "guest",
      });
      expect(enqueued).toHaveLength(1);
      expect(service.process).toHaveBeenCalledWith("aud_1");
    },
  );

  test("the live endpoint rejects demo and never creates or enqueues an audit", async () => {
    const service = new FakeAuditService();
    const { baseUrl, enqueued } = await startApi(service);

    for (const body of [
      { document: "claim", mode: "demo" },
      { document: "claim", mode: "deep", executionMode: "demo" },
    ]) {
      const response = await fetch(`${baseUrl}/api/audits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect((await json(response)).error).toMatch(/live|mode|field/i);
    }

    expect(service.create).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });

  test("demo records cannot be read or mutated through live audit routes", async () => {
    const service = new FakeAuditService();
    const created = await service.create({ document: "fixture", mode: "demo", auditMode: "deep", workspaceId: "guest" });
    const { baseUrl, enqueued } = await startApi(service);

    for (const request of [
      fetch(`${baseUrl}/api/audits/${created.id}`),
      fetch(`${baseUrl}/api/audits/${created.id}/cancel`, { method: "POST" }),
      fetch(`${baseUrl}/api/audits/${created.id}/retry`, { method: "POST" }),
    ]) {
      const response = await request;
      expect(response.status).toBe(404);
      expect((await json(response)).error).toMatch(/not found/i);
    }
    expect(service.cancel).not.toHaveBeenCalled();
    expect(service.retry).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });

  test("an enqueuer may return before processing and run the captured job later", async () => {
    const service = new FakeAuditService();
    const { baseUrl, enqueued } = await startApi(service, { awaitJobs: false });

    const response = await fetch(`${baseUrl}/api/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: "claim", mode: "deep" }),
    });

    expect(response.status).toBe(202);
    expect(service.process).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(1);
    await enqueued[0]!();
    expect(service.process).toHaveBeenCalledWith("aud_1");
  });

  test("GET /api/audits/:id returns the persisted audit for refresh recovery", async () => {
    const service = new FakeAuditService();
    const created = await service.create({ document: "claim", mode: "live", auditMode: "deep", workspaceId: "guest" });
    await service.process(created.id);
    const { baseUrl } = await startApi(service);

    const response = await fetch(`${baseUrl}/api/audits/${created.id}`);

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      record: { id: created.id, status: "completed", mode: "live", workspaceId: "guest" },
      claims: [],
      evidence: [],
      events: [],
      result: null,
    });
  });

  test("cancel is immediate and retry processing is passed through the injected queue", async () => {
    const service = new FakeAuditService();
    const created = await service.create({ document: "claim", mode: "live", auditMode: "deep", workspaceId: "guest" });
    const { baseUrl, enqueued } = await startApi(service);

    const cancelled = await fetch(`${baseUrl}/api/audits/${created.id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);
    expect(await json(cancelled)).toMatchObject({ record: { id: created.id, status: "cancelled" } });
    expect(service.cancel).toHaveBeenCalledWith(created.id);

    const retried = await fetch(`${baseUrl}/api/audits/${created.id}/retry`, { method: "POST" });
    expect(retried.status).toBe(202);
    expect(await json(retried)).toEqual({ auditId: created.id, accepted: true });
    expect(enqueued).toHaveLength(1);
    expect(service.retry).toHaveBeenCalledWith(created.id);
  });

  test.each([
    { label: "malformed JSON", body: "{", contentType: "application/json", expected: /json/i },
    { label: "an empty object", body: "{}", contentType: "application/json", expected: /document|mode/i },
    { label: "blank text", body: JSON.stringify({ document: "   ", mode: "deep" }), contentType: "application/json", expected: /document/i },
    { label: "an invalid mode", body: JSON.stringify({ document: "claim", mode: "slow" }), contentType: "application/json", expected: /mode/i },
  ])("POST /api/audits rejects $label as JSON", async ({ body, contentType, expected }) => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service);
    const response = await fetch(`${baseUrl}/api/audits`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(expected);
    expect(service.create).not.toHaveBeenCalled();
  });

  test("POST /api/audits requires JSON", async () => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service);
    const response = await fetch(`${baseUrl}/api/audits`, { method: "POST", body: "document=claim" });
    expect(response.status).toBe(415);
    expect((await json(response)).error).toMatch(/application\/json/i);
  });

  test("request bodies are capped by bytes", async () => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service, { maxBodyBytes: 48 });
    const response = await fetch(`${baseUrl}/api/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: "é".repeat(40), mode: "deep" }),
    });
    expect(response.status).toBe(413);
    expect((await json(response)).error).toMatch(/large|48 bytes/i);
    expect(service.create).not.toHaveBeenCalled();
  });

  test("unknown audits and unknown routes return JSON 404 responses", async () => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service);

    for (const request of [
      fetch(`${baseUrl}/api/audits/missing`),
      fetch(`${baseUrl}/api/audits/missing/cancel`, { method: "POST" }),
      fetch(`${baseUrl}/not-an-api-route`),
    ]) {
      const response = await request;
      expect(response.status).toBe(404);
      expect((await json(response)).error).toMatch(/not found/i);
    }
  });

  test.each([
    { path: "/api/audits", method: "GET", allow: "POST" },
    { path: "/api/audits/aud_1", method: "POST", allow: "GET" },
    { path: "/api/audits/aud_1/cancel", method: "GET", allow: "POST" },
    { path: "/api/audits/aud_1/retry", method: "DELETE", allow: "POST" },
  ])("$method $path returns JSON 405 with Allow", async ({ path, method, allow }) => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service);
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
    expect((await json(response)).error).toMatch(/method/i);
  });

  test("a non-API fallback can serve the Studio without swallowing unknown API routes", async () => {
    const service = new FakeAuditService();
    const { baseUrl } = await startApi(service, {
      fallback: (_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Studio</title>");
      },
    });
    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Studio</title>");
    const api = await fetch(`${baseUrl}/api/unknown`);
    expect(api.status).toBe(404);
    expect((await json(api)).error).toMatch(/not found/i);
  });
});
