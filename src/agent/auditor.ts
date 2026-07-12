// The second agent on the same substrate. It cannot book, cancel, or touch
// the world: its tools read the ledger and the vendor oracle, run the
// deterministic reconciliation checks, and save a markdown report. The model
// investigates and narrates; it is forbidden from claiming anything a tool
// did not return.
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { localClaudePath } from "./run.js";
import {
  actionTimeline,
  listVendors,
  runReconciliation,
  saveReport,
  type AuditContext,
} from "./audit-tools.js";

const AUDITOR_PROMPT = `You are the audit side of Saga, the transaction layer for AI agents. Every action any agent took is on an append-only ledger; the vendors hold their own records. Your job is reconciliation: find and explain every divergence between what the ledger authorized and what the vendors actually hold.

Method: start with run_reconciliation (optionally scoped to a vendor). For each finding, pull the action_timeline when ledger evidence exists, and explain the break in plain language: what the ledger says, what the vendor says, which one cannot be right. Never speculate; report only what the tools returned. These are reconciliation breaks with evidence, never anything more sensational. Finish by saving a markdown report (save_report) with one section per finding, evidence included, then give a short verbal summary ordered by severity: unauthorized effects first, then duplicates, then phantom compensations, then wedged actions.`;

function asResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

export function buildAuditServer(ctx: AuditContext) {
  return createSdkMcpServer({
    name: "audit",
    version: "0.1.0",
    tools: [
      tool(
        "list_vendors",
        "Vendors known to the ledger and the oracle, with row and action counts. Read-only.",
        {},
        async () => listVendors(ctx).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "run_reconciliation",
        "Diff the ledger against vendor ground truth. Returns every reconciliation break with evidence. Optionally scope to one vendor. Read-only.",
        { vendor: z.string().optional() },
        async (args) => runReconciliation(ctx, args).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "action_timeline",
        "Full ledger event history for one actionId. Read-only.",
        { actionId: z.string() },
        async (args) => asResult(actionTimeline(ctx, args)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "save_report",
        "Save the final audit report as markdown. The only write this agent has.",
        { markdown: z.string() },
        async (args) => asResult(saveReport(ctx, args)),
      ),
    ],
  });
}

function shorten(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function runAuditor(ctx: AuditContext, promptText: string): Promise<void> {
  const stream = query({
    prompt: promptText,
    options: {
      systemPrompt: AUDITOR_PROMPT,
      mcpServers: { audit: buildAuditServer(ctx) },
      allowedTools: ["mcp__audit__*"],
      tools: [],
      maxTurns: 30,
      pathToClaudeCodeExecutable: localClaudePath(),
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(`\nauditor> ${block.text}`);
        } else if (block.type === "tool_use") {
          console.log(`  -> ${block.name} ${JSON.stringify(block.input)}`);
        }
      }
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? block.content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join(" ")
            : String(block.content ?? "");
          console.log(`  <- ${shorten(text.replaceAll("\n", " "))}`);
        }
      }
    } else if (message.type === "result" && message.subtype !== "success") {
      console.error(`\nauditor run ended without success: ${message.subtype}`);
    }
  }
}
