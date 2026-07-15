// Small server-side Gemini REST client shared by the model and Google Search adapters.
// It owns credentials and transport error handling, but leaves each provider responsible
// for validating its own response envelope before data enters Saga.
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

export interface GeminiHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type GeminiTransport = (url: URL, init: RequestInit) => Promise<GeminiHttpResponse>;

export interface GeminiApiClientOptions {
  apiKey?: string;
  model?: string;
  transport?: GeminiTransport;
}

const defaultTransport: GeminiTransport = async (url, init) => globalThis.fetch(url, init);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class GeminiApiClient {
  readonly model: string;
  private apiKey: string;
  private transport: GeminiTransport;

  constructor(options: GeminiApiClientOptions = {}) {
    const suppliedKey = options.apiKey === undefined ? process.env.GEMINI_API_KEY : options.apiKey;
    if (!suppliedKey?.trim()) throw new Error("Gemini API key is required");
    const suppliedModel = options.model === undefined
      ? (process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL)
      : options.model.trim();
    if (!MODEL_ID.test(suppliedModel)) throw new Error("Gemini model id is invalid");
    this.apiKey = suppliedKey.trim();
    this.model = suppliedModel;
    this.transport = options.transport ?? defaultTransport;
  }

  async generateContent(body: unknown, signal?: AbortSignal): Promise<unknown> {
    const model = encodeURIComponent(this.model);
    return this.post(new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`), body, signal);
  }

  async interact(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.post(new URL("https://generativelanguage.googleapis.com/v1beta/interactions"), body, signal);
  }

  private async post(url: URL, body: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    let response: GeminiHttpResponse;
    try {
      response = await this.transport(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch {
      signal?.throwIfAborted();
      throw new Error("Gemini API request failed");
    }
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(`Gemini API request failed with status ${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error("Gemini API returned malformed JSON");
    }
  }
}
