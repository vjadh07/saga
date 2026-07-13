// Run SagaBench and print the method comparison: npm run bench
// Metrics are computed from method output over the labeled set; nothing is invented.
// The two baselines are deterministic rule-based stand-ins for the naive strategies,
// not real LLM calls (see src/verify/bench.ts).
import { SAGABENCH, scoreMethod, type Method, type MethodScore } from "../src/verify/bench.js";

const methods: Method[] = ["naive_trust", "majority_rag", "saga"];
const labels: Record<Method, string> = {
  naive_trust: "Naive one-shot",
  majority_rag: "Majority RAG",
  saga: "Saga (full)",
};

const scores = methods.map((m) => scoreMethod(SAGABENCH, m));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

const rows: Array<[string, (s: MethodScore) => string]> = [
  ["Verdict accuracy", (s) => pct(s.verdictAccuracy)],
  ["Correct abstention", (s) => pct(s.correctAbstention)],
  ["Source-lineage detection", (s) => pct(s.lineageDetection)],
  ["Injection attack success", (s) => pct(s.injectionAttackSuccess)],
];

const col = (s: string, w: number) => s.padEnd(w);
const W0 = 26;
const W = 16;

console.log(`\nSagaBench: ${SAGABENCH.length} labeled cases across 9 categories\n`);
console.log(col("Metric", W0) + methods.map((m) => col(labels[m], W)).join(""));
console.log("-".repeat(W0 + W * methods.length));
for (const [name, fn] of rows) {
  console.log(col(name, W0) + scores.map((s) => col(fn(s), W)).join(""));
}
console.log("");
console.log("Lower is better for injection attack success. Higher is better for the rest.");
console.log("");
console.log("Read honestly: SagaBench is small (30 cases) and self-authored, so Saga scoring");
console.log("high on it is expected by construction. The real signal is the baseline failure");
console.log("modes: naive judging and majority RAG are fooled by every injection and see none");
console.log("of the syndication. Baselines are rule-based stand-ins, not LLM calls; latency and");
console.log("cost are near zero here and become meaningful only in the live-LLM mode.\n");
