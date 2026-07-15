import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handlePublicLiveRequest,
  PUBLIC_LIVE_MAX_DOCUMENT_BYTES,
} from "../src/verify/live/public-endpoint.js";

export const maxDuration = 300;
const MAX_REQUEST_BYTES = PUBLIC_LIVE_MAX_DOCUMENT_BYTES + 1_000;

// Vercel's Node handler keeps this function stateless. Each POST runs one complete,
// bounded Live audit and writes its terminal StoredAudit to the response.
export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("request aborted"));
  request.once("aborted", abort);
  try {
    const body = await readBody(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const protocol = firstHeader(request.headers["x-forwarded-proto"]) || "https";
    const host = firstHeader(request.headers["x-forwarded-host"])
      || firstHeader(request.headers.host)
      || "saga.invalid";
    const webRequest = new Request(new URL(request.url ?? "/api/live-audit", `${protocol}://${host}`), {
      method: request.method ?? "GET",
      headers,
      ...(body.length > 0 ? { body: body.toString("utf8") } : {}),
      signal: controller.signal,
    });
    const webResponse = await handlePublicLiveRequest(webRequest);
    response.statusCode = webResponse.status;
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    if (response.writableEnded) return;
    const tooLarge = error instanceof Error && error.message === "request body is too large";
    response.statusCode = tooLarge ? 413 : 500;
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: tooLarge ? error.message : "Live audit could not start" }));
  } finally {
    request.removeListener("aborted", abort);
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body is too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
