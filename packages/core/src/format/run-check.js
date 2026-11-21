// How every reader takes in a run file (validate-run, publish, the dev server,
// the review UI, writing a run folder): validate it as stored, against the
// journey's lines when given, then settle it.
import { journeyPlan } from "./format.js";
import { settle, validateRun } from "./runfile.js";

/**
 * The run's problems as stored, and the run as the rules say it stands. A
 * valid run with nothing to settle comes back unchanged, so the runner's own
 * words in not_verified are kept.
 * @param {import("./runfile.js").Run} raw
 * @param {import("./format.js").Journey} [journey]
 * @returns {{run: import("./runfile.js").Run, settled: string[], problems: string[]}}
 */
export function checkRun(raw, journey) {
  /** @type {string[]} */
  const problems = [];
  let plan;
  if (journey) {
    try {
      plan = journeyPlan(journey, raw?.journey?.case ?? null);
    } catch (error) {
      problems.push(`journey.case: ${/** @type {Error} */ (error).message}`);
    }
  }
  problems.push(...validateRun(raw, plan));
  if (!Array.isArray(raw?.steps) || Array.isArray(raw.outcomes)) return { run: raw, settled: [], problems };
  const { run, settled } = settle(raw);
  if (!settled.length && !problems.length) return { run: raw, settled, problems };
  // The runner's summary describes its own result; drop it when the rules give another.
  if (run.result !== raw.result) delete run.summary;
  return { run, settled, problems };
}
