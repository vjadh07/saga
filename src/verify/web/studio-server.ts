import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditResult } from "../pipeline.js";
import { renderStudioPage } from "./page.js";

const AUDIT_ID = /^[A-Za-z0-9_-]+$/;

export interface StudioRouteResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const HTML_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export function renderStudioRoute(
  requestUrl: string,
  method: string | undefined,
  demo: AuditResult,
): StudioRouteResponse {
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: 405,
      headers: { ...HTML_HEADERS, allow: "GET, HEAD" },
      body: errorPage("Method not allowed"),
    };
  }

  let url: URL;
  try {
    url = new URL(requestUrl, "http://localhost");
  } catch {
    return { status: 400, headers: HTML_HEADERS, body: errorPage("Invalid request URL") };
  }

  if (url.pathname === "/") {
    const requestedAuditId = url.searchParams.get("audit");
    const activeAuditId = requestedAuditId && AUDIT_ID.test(requestedAuditId) ? requestedAuditId : null;
    return {
      status: 200,
      headers: HTML_HEADERS,
      body: "<!doctype html>\n" + renderStudioPage(demo, { initialView: "live", activeAuditId }),
    };
  }

  if (url.pathname === "/demo") {
    return {
      status: 200,
      headers: HTML_HEADERS,
      body: "<!doctype html>\n" + renderStudioPage(demo, { initialView: "demo" }),
    };
  }

  return { status: 404, headers: HTML_HEADERS, body: errorPage("Page not found") };
}

export function createStudioFallback(demo: AuditResult) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const route = renderStudioRoute(request.url ?? "/", request.method, demo);
    response.writeHead(route.status, route.headers);
    response.end(request.method === "HEAD" ? "" : route.body);
  };
}

function errorPage(message: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${message} | Saga</title><p>${message}</p>`;
}
