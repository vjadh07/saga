import { expect, test } from "vitest";
import { z } from "zod";
import {
  GeminiModelProvider,
  type GeminiHttpResponse,
  type GeminiTransport,
} from "../src/verify/providers/model-gemini.js";

function response(body: unknown, status = 200): GeminiHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("GeminiModelProvider sends a structured generateContent request and validates the result", async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const transport: GeminiTransport = async (url, init) => {
    requestedUrl = url;
    requestedInit = init;
    return response({
      candidates: [{
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: '{"answer":"verified","score":4}' }] },
      }],
      modelVersion: "gemini-2.5-flash-001",
    });
  };
  const provider = new GeminiModelProvider({ apiKey: "gemini-secret", transport });
  const schema = z.object({ answer: z.enum(["verified", "rejected"]), score: z.number().int().min(0).max(5) });

  const result = await provider.generateStructured({
    purpose: "test",
    system: "Return only validated evidence.",
    prompt: "Check this claim.",
    schema,
  });

  expect(provider.id).toBe("google-gemini/gemini-3.1-flash-lite");
  expect(requestedUrl?.href).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
  expect(requestedInit?.method).toBe("POST");
  expect(requestedInit?.headers).toEqual({
    "Content-Type": "application/json",
    "x-goog-api-key": "gemini-secret",
  });
  const body = JSON.parse(String(requestedInit?.body));
  expect(body).toMatchObject({
    systemInstruction: { parts: [{ text: "Return only validated evidence." }] },
    contents: [{ role: "user", parts: [{ text: "Check this claim." }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          answer: { type: "string", enum: ["verified", "rejected"] },
          score: { type: "integer", minimum: 0, maximum: 5 },
        },
        required: ["answer", "score"],
        additionalProperties: false,
      },
    },
  });
  expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("$schema");
  expect(body.generationConfig).not.toHaveProperty("temperature");
  expect(body.generationConfig).not.toHaveProperty("topP");
  expect(body.generationConfig).not.toHaveProperty("topK");
  expect(result).toEqual({ answer: "verified", score: 4 });
});

test("GeminiModelProvider supports an explicit stable model id", () => {
  const provider = new GeminiModelProvider({ apiKey: "key", model: "gemini-2.5-flash-lite" });
  expect(provider.id).toBe("google-gemini/gemini-2.5-flash-lite");
});

test("GeminiModelProvider requires a key and rejects unsafe model ids", () => {
  expect(() => new GeminiModelProvider({ apiKey: "" })).toThrow(/key|required/i);
  expect(() => new GeminiModelProvider({ apiKey: "key", model: "../secret" })).toThrow(/model/i);
});

test("GeminiModelProvider rejects non-success responses without exposing its key", async () => {
  const provider = new GeminiModelProvider({
    apiKey: "never-expose-gemini-key",
    transport: async () => response({ error: { message: "never-expose-gemini-key" } }, 429),
  });
  const error = await provider.generateStructured({
    purpose: "test",
    system: "",
    prompt: "test",
    schema: z.object({ ok: z.boolean() }),
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/429/);
  expect((error as Error).message).not.toContain("never-expose-gemini-key");
});

test("GeminiModelProvider rejects blocked, truncated, malformed, and schema-invalid output", async () => {
  const schema = z.object({ ok: z.boolean() });
  const request = { purpose: "test", system: "", prompt: "test", schema };
  const blocked = new GeminiModelProvider({
    apiKey: "key",
    transport: async () => response({ promptFeedback: { blockReason: "SAFETY" } }),
  });
  await expect(blocked.generateStructured(request)).rejects.toThrow(/candidate|blocked/i);

  const truncated = new GeminiModelProvider({
    apiKey: "key",
    transport: async () => response({
      candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"ok":' }] } }],
    }),
  });
  await expect(truncated.generateStructured(request)).rejects.toThrow(/MAX_TOKENS|finish/i);

  const malformed = new GeminiModelProvider({
    apiKey: "key",
    transport: async () => response({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not-json" }] } }],
    }),
  });
  await expect(malformed.generateStructured(request)).rejects.toThrow(/malformed|json/i);

  const invalid = new GeminiModelProvider({
    apiKey: "key",
    transport: async () => response({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"ok":"yes"}' }] } }],
    }),
  });
  await expect(invalid.generateStructured(request)).rejects.toThrow(/expected boolean/i);
});

test("GeminiModelProvider sanitizes transport failures and propagates cancellation", async () => {
  const schema = z.object({ ok: z.boolean() });
  const failed = new GeminiModelProvider({
    apiKey: "transport-secret",
    transport: async () => { throw new Error("failed with transport-secret"); },
  });
  const error = await failed.generateStructured({ purpose: "test", system: "", prompt: "test", schema })
    .catch((reason: unknown) => reason);
  expect((error as Error).message).toBe("Gemini API request failed");
  expect((error as Error).message).not.toContain("transport-secret");

  const controller = new AbortController();
  controller.abort(new Error("cancelled by user"));
  const cancelled = new GeminiModelProvider({ apiKey: "key", transport: async () => response({}) });
  await expect(cancelled.generateStructured({
    purpose: "test",
    system: "",
    prompt: "test",
    schema,
    signal: controller.signal,
  })).rejects.toThrow(/cancelled by user/i);
});
