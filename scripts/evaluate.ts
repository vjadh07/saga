// Run the small hidden-label Live evaluation. These are deterministic mock-provider cases,
// not an external benchmark. Gold verdicts are consulted only after each audit returns.
import { runHiddenLabelEvaluation } from "../src/verify/evaluation/hidden-label.js";

const result = await runHiddenLabelEvaluation();
console.log(JSON.stringify(result, null, 2));
