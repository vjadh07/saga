// The demo agent's brain: Claude via the Agent SDK, riding the local Claude
// Code login. Built-in tools are stripped, so every action the model takes
// goes through the saga tools below and lands on the ledger. The model plans
// for itself; nothing here scripts its decisions.
import { execFileSync } from "node:child_process";
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  addCalendarEvent,
  bookFlight,
  bookHotel,
  cancelTrip,
  searchFlights,
  searchHotels,
  tripStatus,
  type TripContext,
} from "./tools.js";

const SYSTEM_PROMPT = `You are a travel booking agent. You act on the world only through your saga tools. Every booking is transactional: staged, executed, verified against the vendor's records, then committed, all on an append-only ledger, so it is safe even if you crash mid-action.

Start by calling trip_status: you may have been restarted after a crash, and already-committed actions must not be repeated. Prices are in USD; when the user states no preference, prefer the cheaper reasonable option. After booking a trip, add one calendar event covering it. When asked to cancel, use cancel_trip and then walk the user through the receipt: what was undone and in what order. Report only what the ledger and tool results confirm.`;

function asResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

export function buildSagaServer(ctx: TripContext) {
  return createSdkMcpServer({
    name: "saga",
    version: "0.1.0",
    tools: [
      tool(
        "search_flights",
        "Search available flights between two airports on a date. Read-only.",
        { from: z.string(), to: z.string(), date: z.string() },
        async (args) => searchFlights(ctx, args).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "search_hotels",
        "Search available hotels in a city for a date range. Read-only.",
        { city: z.string(), checkin: z.string(), checkout: z.string() },
        async (args) => searchHotels(ctx, args).then(asResult).catch(asError),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "book_flight",
        "Book a flight by id. Transactional: verified against the vendor before commit.",
        { flightId: z.string() },
        async (args) => bookFlight(ctx, args).then(asResult).catch(asError),
      ),
      tool(
        "book_hotel",
        "Book a hotel by id for a date range. Transactional.",
        { hotelId: z.string(), checkin: z.string(), checkout: z.string() },
        async (args) => bookHotel(ctx, args).then(asResult).catch(asError),
      ),
      tool(
        "add_calendar_event",
        "Add one calendar event for the trip. Transactional.",
        { title: z.string(), startIso: z.string(), endIso: z.string() },
        async (args) => addCalendarEvent(ctx, args).then(asResult).catch(asError),
      ),
      tool(
        "trip_status",
        "Current receipt for this trip: every action, its state, and its timeline. Read-only.",
        {},
        async () => asResult(tripStatus(ctx)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        "cancel_trip",
        "Cancel the whole trip: compensates every committed action in reverse order and returns the receipt.",
        {},
        async () => cancelTrip(ctx).then(asResult).catch(asError),
      ),
    ],
  });
}

// The SDK ships an x64 claude binary; under an x64 Node on Apple silicon it
// runs via Rosetta and never finishes booting. The locally installed native
// CLI is also the login this agent rides, so prefer it whenever present.
export function localClaudePath(): string | undefined {
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
  try {
    const found = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    return found || undefined;
  } catch {
    return undefined;
  }
}

function shorten(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function runAgent(ctx: TripContext, promptText: string): Promise<void> {
  const stream = query({
    prompt: promptText,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: { saga: buildSagaServer(ctx) },
      allowedTools: ["mcp__saga__*"],
      tools: [], // no built-ins: the model can only act through saga
      maxTurns: 40,
      pathToClaudeCodeExecutable: localClaudePath(),
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(`\nagent> ${block.text}`);
        } else if (block.type === "tool_use") {
          console.log(`  -> ${block.name} ${JSON.stringify(block.input)}`);
        }
      }
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === "tool_result") {
          const text = Array.isArray(block.content)
            ? block.content
                .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
                .join(" ")
            : String(block.content ?? "");
          console.log(`  <- ${shorten(text.replaceAll("\n", " "))}`);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype !== "success") {
        console.error(`\nagent run ended without success: ${message.subtype}`);
      }
    }
  }
}
