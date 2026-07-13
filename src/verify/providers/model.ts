// Model provider abstraction. Every LLM boundary goes through generateStructured, which
// takes a zod schema and validates the model output before returning it, so no unvalidated
// LLM data enters the engine. The mock provider makes the whole workflow testable without a
// network or a real model; the live Agent SDK adapter lives in model-agent.ts so this file
// stays import-light for tests.
import type { z } from "zod";

export interface StructuredModelRequest<T> {
  purpose: string; // e.g. "research_plan", "citation_assessment"; used for logging and mock keying
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface ModelProvider {
  readonly id: string; // provider/model identifier recorded in the receipt
  generateStructured<T>(request: StructuredModelRequest<T>): Promise<T>;
}

// Deterministic model for tests and Demo mode: returns scripted responses per purpose,
// validated against the request schema exactly as a live response would be.
export class MockModelProvider implements ModelProvider {
  readonly id: string;
  private scripts: Record<string, unknown[]>;

  constructor(scripts: Record<string, unknown[]> = {}, id = "mock") {
    this.scripts = Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, [...v]]));
    this.id = id;
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
    const queue = this.scripts[request.purpose];
    if (!queue || queue.length === 0) {
      throw new Error(`no scripted response for purpose "${request.purpose}"`);
    }
    return request.schema.parse(queue.shift());
  }
}
