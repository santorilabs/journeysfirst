// Whether a change may merge, from the runs of every journey in the repo.
// Each journey (each case, for a journey with cases) needs a valid run in
// which every check passed. A check that is blocked may stay blocked only if
// the same check was blocked in main's latest run too, so a change never
// merges on a check that it stopped from being checked.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { caseIds, journeyName, loadJourney } from "./format.js";
import { newestRunFolder, readRunFolder, readRunJson } from "./run-folder.js";
import { checkRun } from "./run-check.js";
import { isCheck } from "./runfile.js";

/**
 * @typedef {{journey: string, case: string|null, ok: boolean, says: string}} MergeLine
 */

/**
 * @param {{journeysDir?: string, runsDir?: string, mainDir?: string}} [options]
 * @returns {{ok: boolean, lines: MergeLine[]}}
 */
export function mergeCheck({ journeysDir = "journeys", runsDir = "journey-runs", mainDir } = {}) {
  if (!existsSync(journeysDir)) throw new Error(`No ${journeysDir} folder. Run this from the repo root.`);
  const files = readdirSync(journeysDir).filter((name) => /\.journey\.ya?ml$/.test(name)).sort();
  if (!files.length) throw new Error(`No journeys in ${journeysDir}.`);
  /** @type {MergeLine[]} */
  const lines = [];
  for (const file of files) {
    const journey = loadJourney(join(journeysDir, file));
    const name = journeyName(file);
    const cases = caseIds(journey);
    for (const id of cases.length ? cases : [null]) {
      lines.push({ journey: name, case: id, ...judge(journey, name, id, runsDir, mainDir) });
    }
  }
  return { ok: lines.every((line) => line.ok), lines };
}

/**
 * @param {import("./format.js").Journey} journey
 * @param {string} name @param {string|null} id
 * @param {string} runsDir @param {string} [mainDir]
 * @returns {{ok: boolean, says: string}}
 */
function judge(journey, name, id, runsDir, mainDir) {
  const folder = newestRun(runsDir, name, id);
  if (!folder) return { ok: false, says: `no run in ${runsDir}` };
  let run;
  try {
    ({ run } = readRunFolder(folder, { journey }));
  } catch (error) {
    return { ok: false, says: /** @type {Error} */ (error).message };
  }
  const checks = run.steps.filter(isCheck);
  if (!checks.length) return { ok: false, says: "the run has no checks" };
  const notPassed = checks.filter((s) => s.verdict !== "passed");
  if (run.result === "passed") return { ok: true, says: "passed" };
  // Any failed step stops the merge, whatever its cause: a script that throws
  // is recorded as failed with cause test, and its run is not_fully_checked.
  const failedStep = /** @type {import("./runfile.js").ActionStep | undefined} */ (run.steps.find((s) => !isCheck(s) && s.status === "failed"));
  if (failedStep && !notPassed.some((s) => s.verdict === "failed")) {
    return { ok: false, says: `a step failed (cause ${failedStep.cause ?? "unknown"}): ${failedStep.says}` };
  }
  if (!notPassed.length) return { ok: false, says: `${run.result.replaceAll("_", " ")}: a step was not done` };
  const base = mainChecks(mainDir, name, id);
  const stops = notPassed.filter((s) => !(s.verdict === "blocked" && base.get(s.id) === "blocked"));
  if (stops.length) {
    return { ok: false, says: stops.map((s) => `${s.id} ${s.verdict}${s.verdict === "blocked" ? (base.size ? " (not blocked on main)" : " (no main run to compare)") : ""}`).join("; ") };
  }
  return { ok: true, says: `passed, except ${notPassed.map((s) => s.id).join(", ")}: blocked here and on main` };
}

/**
 * The newest run folder of one journey case: <runsDir>/<name>/<run id>/.
 * @param {string|undefined} runsDir @param {string} name @param {string|null} id
 * @returns {string|null}
 */
function newestRun(runsDir, name, id) {
  return runsDir ? newestRunFolder(join(runsDir, name), (raw) => (raw?.journey?.case ?? null) === id) : null;
}

/**
 * The settled verdict of each check in main's newest run, by check id.
 * Empty when there is no run from main.
 * @param {string|undefined} mainDir @param {string} name @param {string|null} id
 * @returns {Map<string, string>}
 */
function mainChecks(mainDir, name, id) {
  const folder = newestRun(mainDir, name, id);
  if (!folder) return new Map();
  const { run } = checkRun(readRunJson(folder));
  return new Map((run.steps ?? []).filter(isCheck).map((s) => [s.id, s.verdict]));
}
