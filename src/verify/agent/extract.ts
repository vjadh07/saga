// The live LLM shell around the Claim Mapper. Kept separate from mapper.ts so the tested
// assembly logic does not pull in the Agent SDK. This rides the local Claude Code login
// exactly like the booking and audit agents, strips built-in tools, and lets the model
// report claims only through the structured record_claim tool. Deterministic assembly then
// validates and locates them.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { localClaudePath } from "../../agent/run.js";
import type { Claim } from "../types.js";
import { assembleClaims, MAPPER_PROMPT, type RawClaim } from "./mapper.js";

export async function extractClaims(document: string, onEvent?: (msg: string) => void): Promise<Claim[]> {
  const collected: RawClaim[] = [];

  const server = createSdkMcpServer({
    name: "mapper",
    version: "0.1.0",
    tools: [
      tool(
        "record_claim",
        "Record one atomic, independently verifiable claim extracted from the document.",
        {
          originalText: z.string(),
          normalized: z.string(),
          claimType: z.string(),
          verifiable: z.boolean(),
          timeSensitive: z.boolean(),
          risk: z.string(),
          asOf: z.string().nullable().optional(),
        },
        async (args) => {
          collected.push(args as RawClaim);
          onEvent?.(`claim: ${args.originalText}`);
          return { content: [{ type: "text" as const, text: "recorded" }] };
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });

  const stream = query({
    prompt: document,
    options: {
      systemPrompt: MAPPER_PROMPT,
      mcpServers: { mapper: server },
      allowedTools: ["mcp__mapper__*"],
      tools: [],
      maxTurns: 20,
      pathToClaudeCodeExecutable: localClaudePath(),
    },
  });

  for await (const message of stream) {
    if (message.type === "result" && message.subtype !== "success") {
      onEvent?.(`mapper ended without success: ${message.subtype}`);
    }
  }

  return assembleClaims(document, collected);
}
