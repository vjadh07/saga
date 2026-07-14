import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AuditMode } from "../mapview.js";
import type { StoredAudit } from "../providers/store.js";
import type { AuditService } from "./service.js";

export const GUEST_WORKSPACE_ID = "guest";
export const DEFAULT_AUDIT_API_MAX_BODY_BYTES = 200_000;

const AUDIT_MODES: ReadonlySet<string> = new Set(["quick", "deep", "high_stakes"]);

type AuditHttpService = Pick<AuditService, "create" | "get" | "process" | "cancel" | "retry">;
export type AuditJob = () => Promise<void>;
export type AuditJobEnqueuer = (job: AuditJob) => void | Promise<void>;

export interface AuditApiServerOptions {
  service: AuditHttpService;
  enqueue: AuditJobEnqueuer;
  maxBodyBytes?: number;
  fallback?: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createAuditApiServer(options: AuditApiServerOptions): Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_AUDIT_API_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error("maxBodyBytes must be a positive safe integer");
  }

  return createServer((request, response) => {
    void handleRequest(request, response, { ...options, maxBodyBytes }).catch((error: unknown) => {
      if (response.headersSent || response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const normalized = normalizeError(error);
      sendJson(response, normalized.status, { error: normalized.message });
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuditApiServerOptions & { maxBodyBytes: number },
): Promise<void> {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    throw new HttpError(400, "invalid request URL");
  }

  if (pathname === "/api/audits") {
    if (request.method !== "POST") return methodNotAllowed(response, "POST");
    requireJson(request);
    const body = await readJsonObject(request, options.maxBodyBytes);
    const input = parseCreateInput(body);
    const record = await options.service.create({
      document: input.document,
      mode: "live",
      auditMode: input.mode,
      workspaceId: GUEST_WORKSPACE_ID,
    });
    if (record.mode !== "live") {
      throw new Error("live audit service created a non-live audit");
    }
    if (record.workspaceId !== GUEST_WORKSPACE_ID) {
      throw new Error("live audit service created an audit outside the guest workspace");
    }
    await options.enqueue(() => options.service.process(record.id));
    sendJson(response, 202, { audit: record });
    return;
  }

  const resource = pathname.match(/^\/api\/audits\/([A-Za-z0-9_-]+)$/);
  if (resource) {
    if (request.method !== "GET") return methodNotAllowed(response, "GET");
    sendJson(response, 200, await loadLiveAudit(options.service, resource[1]!));
    return;
  }

  const action = pathname.match(/^\/api\/audits\/([A-Za-z0-9_-]+)\/(cancel|retry)$/);
  if (action) {
    if (request.method !== "POST") return methodNotAllowed(response, "POST");
    const auditId = action[1]!;
    await loadLiveAudit(options.service, auditId);
    if (action[2] === "cancel") {
      await options.service.cancel(auditId);
      sendJson(response, 200, await loadLiveAudit(options.service, auditId));
      return;
    }
    await options.enqueue(() => options.service.retry(auditId));
    sendJson(response, 202, { auditId, accepted: true });
    return;
  }

  if (options.fallback && !pathname.startsWith("/api/")) {
    await options.fallback(request, response);
    return;
  }
  throw new HttpError(404, "not found");
}

async function loadLiveAudit(service: AuditHttpService, auditId: string): Promise<StoredAudit> {
  const audit = await service.get(auditId);
  if (audit.record.mode !== "live" || audit.record.workspaceId !== GUEST_WORKSPACE_ID) {
    throw new HttpError(404, "audit not found");
  }
  return audit;
}

function parseCreateInput(body: Record<string, unknown>): { document: string; mode: AuditMode } {
  const unsupported = Object.keys(body).filter((key) => key !== "document" && key !== "mode");
  if (unsupported.length > 0) {
    throw new HttpError(400, `unsupported field: ${unsupported[0]}`);
  }
  if (typeof body.document !== "string" || body.document.trim().length === 0) {
    throw new HttpError(400, "document must be a non-empty string");
  }
  if (typeof body.mode !== "string" || !AUDIT_MODES.has(body.mode)) {
    throw new HttpError(400, "mode must be quick, deep, or high_stakes; this endpoint is live only");
  }
  return { document: body.document, mode: body.mode as AuditMode };
}

function requireJson(request: IncomingMessage): void {
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "content-type must be application/json");
  }
}

async function readJsonObject(request: IncomingMessage, maxBodyBytes: number): Promise<Record<string, unknown>> {
  const lengthHeader = request.headers["content-length"];
  if (lengthHeader !== undefined) {
    const contentLength = Number(lengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      throw new HttpError(413, `request body exceeds ${maxBodyBytes} bytes`);
    }
  }

  const raw = await readBody(request, maxBodyBytes);
  if (raw.length === 0) throw new HttpError(400, "request body must contain JSON");
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "request body contains invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    request.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBodyBytes) {
        settled = true;
        reject(new HttpError(413, `request body exceeds ${maxBodyBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes));
    });
    request.on("aborted", () => {
      if (settled) return;
      settled = true;
      reject(new HttpError(400, "request body was aborted"));
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function methodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader("allow", allowed);
  sendJson(response, 405, { error: "method not allowed" });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(json);
}

function normalizeError(error: unknown): { status: number; message: string } {
  if (error instanceof HttpError) return { status: error.status, message: error.message };
  if (error instanceof Error && /\baudit not found\b/i.test(error.message)) {
    return { status: 404, message: "audit not found" };
  }
  return { status: 500, message: "internal server error" };
}
