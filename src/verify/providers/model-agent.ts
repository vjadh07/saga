// Live model adapter: implements ModelProvider on the Claude Agent SDK, riding the local
// Claude Code login like the other Saga agents. The model returns its answer only through a
// single structured tool whose shape is the request's zod schema, and the result is
// re-validated with that schema before it leaves this file. Kept out of model.ts so tests
// never import the SDK. Not exercised by the default test suite (needs a live login); the
// optional smoke test covers it.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { localClaudePath } from "../../agent/run.js";
import type { ModelProvider, StructuredModelRequest } from "./model.js";

export class AgentSdkModelProvider implements ModelProvider {
  readonly id: string;

  constructor(id = "claude-code-agent-sdk") {
    this.id = id;
  }

  async generateStructured<T>(request: StructuredModelRequest<T>): Promise<T> {
    request.signal?.throwIfAborted();
    const shape = (request.schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
    if (!shape) {
      throw new Error("AgentSdkModelProvider requires a ZodObject schema for structured output");
    }

    let captured: unknown;
    let got = false;
    const server = createSdkMcpServer({
      name: "structured",
      version: "0.1.0",
      tools: [
        tool(
          "emit_result",
          "Emit the final structured result. Call this exactly once when you are done.",
          shape,
          async (args) => {
            captured = args;
            got = true;
            return { content: [{ type: "text" as const, text: "ok" }] };
          },
          { annotations: { readOnlyHint: true } },
        ),
      ],
    });

    const abortController = new AbortController();
    const onAbort = () => abortController.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const stream = query({
      prompt: request.prompt,
      options: {
        abortController,
        systemPrompt: request.system,
        mcpServers: { structured: server },
        allowedTools: ["mcp__structured__*"],
        tools: [],
        maxTurns: 12,
        pathToClaudeCodeExecutable: localClaudePath(),
      },
    });

    try {
      for await (const message of stream) {
        if (message.type === "result" && message.subtype !== "success" && !got) {
          throw new Error(`model run for "${request.purpose}" failed: ${message.subtype}`);
        }
      }
    } finally {
      request.signal?.removeEventListener("abort", onAbort);
    }
    request.signal?.throwIfAborted();
    if (!got) throw new Error(`model did not emit a structured result for "${request.purpose}"`);

    return request.schema.parse(captured);
  }
}
