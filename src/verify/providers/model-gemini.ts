// Gemini implementation of Saga's structured ModelProvider boundary. Gemini is asked for
// JSON matching a sanitized version of the request schema, then Saga parses and validates
// the result again with the original Zod schema before returning it.
import { z } from "zod";
import type { ModelProvider, StructuredModelRequest } from "./model.js";
import {
  GeminiApiClient,
  type GeminiApiClientOptions,
  type GeminiHttpResponse,
  type GeminiTransport,
} from "./gemini-api.js";

export type { GeminiHttpResponse, GeminiTransport } from "./gemini-api.js";

export interface GeminiModelProviderOptions extends GeminiApiClientOptions {}

const GeminiResponseSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({
      role: z.string().optional(),
      parts: z.array(z.object({
        text: z.string().optional(),
        thought: z.boolean().optional(),
      }).passthrough()),
    }).optional(),
  }).passthrough()).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
  modelVersion: z.string().optional(),
}).passthrough();

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum",
  "items", "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf",
  "properties", "additionalProperties", "required",
]);

export class GeminiModelProvider implements ModelProvider {
  readonly id: string;
  private client: GeminiApiClient;

  constructor(options: GeminiModelProviderOptions = {}) {
    this.client = new GeminiApiClient(options);
    this.id = `google-gemini/${this.client.model}`;
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
    request.signal?.throwIfAborted();
    let responseJsonSchema: unknown;
    try {
      responseJsonSchema = sanitizeJsonSchema(z.toJSONSchema(request.schema));
    } catch {
      throw new Error("Gemini requires a JSON-schema-compatible Zod schema");
    }

    const raw = await this.client.generateContent({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    }, request.signal);

    const response = GeminiResponseSchema.safeParse(raw);
    if (!response.success) throw new Error("Gemini API returned an invalid response schema");
    const candidate = response.data.candidates?.[0];
    if (!candidate) {
      const reason = response.data.promptFeedback?.blockReason;
      throw new Error(reason ? `Gemini returned no candidate because the prompt was blocked: ${reason}` : "Gemini returned no candidate");
    }
    if (candidate.finishReason !== "STOP") {
      throw new Error(`Gemini returned an incomplete candidate with finish reason ${candidate.finishReason ?? "unknown"}`);
    }
    const text = candidate.content?.parts
      .filter((part) => part.thought !== true && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();
    if (!text) throw new Error("Gemini returned no structured result text");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Gemini returned malformed structured JSON");
    }
    request.signal?.throwIfAborted();
    return request.schema.parse(parsed);
  }
}

function sanitizeJsonSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeJsonSchema);
  if (!input || typeof input !== "object") return input;
  const source = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if ((key === "properties" || key === "$defs") && value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, schema]) => [name, sanitizeJsonSchema(schema)]),
      );
      continue;
    }
    output[key] = sanitizeJsonSchema(value);
  }
  return output;
}
