// The Safety Sentinel. Saga reads untrusted webpages and documents; all retrieved
// content is treated as DATA, never as instructions. This is deterministic, best-effort
// defense in depth: strip active and hidden markup, detect instruction-like text, and
// quarantine it before any of it reaches the LLM. It is not a proof of safety. Combined
// with read-only tools and human approval it shrinks the attack surface.
import type { SafetyEvent, SafetyKind, SanitizedContent } from "./types.js";

interface Pattern {
  kind: SafetyKind;
  re: RegExp;
}

// Ordered: the first matching pattern classifies the span.
const PATTERNS: Pattern[] = [
  { kind: "exfiltration", re: /\b(send|forward|email|leak|exfiltrate|post)\b[^.?!]*\b(system prompt|api key|secret|token|credential|password)\b/i },
  { kind: "exfiltration", re: /\b(send|forward|email)\b[^.?!]*\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i },
  { kind: "role_override", re: /\byou are now\b|\bact as\b[^.?!]*\b(unrestricted|jailbroken|dan)\b|\bfrom now on you (are|will)\b/i },
  { kind: "instruction_injection", re: /\b(ignore|disregard|forget|override)\b[^.?!]*\b(previous|prior|earlier|above|all)\b[^.?!]*\b(instruction|instructions|prompt|rules|context)\b/i },
  { kind: "instruction_injection", re: /\b(mark|rate|classify|label|treat|flag)\b[^.?!]*\b(this|the)\b[^.?!]*\b(source|article|page|document|claim)?\b[^.?!]*\b(as )?(credible|trusted|trustworthy|verified|reliable|accurate|true)\b/i },
  { kind: "instruction_injection", re: /\b(do not|don't|never)\b[^.?!]*\b(flag|report|mention|quarantine|warn|contradict)\b/i },
  { kind: "instruction_injection", re: /\bnew (instructions?|system prompt|task)\b\s*:/i },
  { kind: "role_override", re: /\bsystem\s*:\s*/i },
];

// Returns the kind of instruction-like content in a span, or null if it reads as data.
export function detectInstruction(span: string): SafetyKind | null {
  for (const p of PATTERNS) {
    if (p.kind === "script_stripped") continue;
    if (p.re.test(span)) return p.kind;
  }
  return null;
}

function splitSentences(text: string): string[] {
  // split on sentence terminators and newlines, keep non-empty trimmed spans
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function sanitizeSource(source: { id: string; content: string }): SanitizedContent {
  const events: SafetyEvent[] = [];
  const quarantined: string[] = [];
  let text = source.content;

  // 1. active markup: scripts and styles are removed outright
  if (/<(script|style)\b/i.test(text)) {
    events.push({ sourceId: source.id, kind: "script_stripped", excerpt: "active <script>/<style> markup", action: "sanitized" });
    text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  }

  // 2. HTML comments: inspect for injection, then strip
  text = text.replace(/<!--([\s\S]*?)-->/g, (_full, inner: string) => {
    const kind = detectInstruction(inner);
    if (kind) {
      events.push({ sourceId: source.id, kind: "hidden_content", excerpt: inner.trim(), action: "quarantined" });
      quarantined.push(inner.trim());
    }
    return " ";
  });

  // 3. elements hidden from the reader: inspect inner text for injection, then strip
  const hiddenEl = /<([a-z0-9]+)\b[^>]*(?:style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["']|\bhidden\b|aria-hidden\s*=\s*["']true["'])[^>]*>([\s\S]*?)<\/\1>/gi;
  text = text.replace(hiddenEl, (_full, _tag: string, inner: string) => {
    const stripped = inner.replace(/<[^>]+>/g, " ").trim();
    // hidden from the reader by construction, so it is quarantined whether or not it
    // also trips an instruction pattern
    events.push({ sourceId: source.id, kind: "hidden_content", excerpt: stripped, action: "quarantined" });
    if (stripped) quarantined.push(stripped);
    return " ";
  });

  // 4. remaining tags out, entities normalized, whitespace collapsed
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

  // 5. sentence-level instruction detection on what remains
  const kept: string[] = [];
  for (const sentence of splitSentences(text)) {
    const kind = detectInstruction(sentence);
    if (kind) {
      events.push({ sourceId: source.id, kind, excerpt: sentence, action: "quarantined" });
      quarantined.push(sentence);
    } else {
      kept.push(sentence);
    }
  }

  return { clean: kept.join(" "), events, quarantined };
}
