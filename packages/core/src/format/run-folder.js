// A run folder on disk: <dir>/<journey name>/<run id>/run.json plus the
// screenshots and media it names. Both reading and writing go through
// checkRun, so a run is settled the same way wherever it is taken in. Writing
// stores the settled run; reading digests run.json as it is, never as settled.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadJourney } from "./format.js";
import { checkRun } from "./run-check.js";
import { runDigest, runFiles, sha256 } from "./runfile.js";

/**
 * The journey file a run belongs to: the one given, or
 * journeys/<name>.journey.yaml in the current folder. journey is null when
 * there is no such file.
 * @param {{journey?: {name?: string}}} run
 * @param {string} [file]
 */
export function findJourney(run, file) {
  if (file) return { file, journey: loadJourney(file) };
  const guess = join("journeys", `${run?.journey?.name}.journey.yaml`);
  return { file: guess, journey: existsSync(guess) ? loadJourney(guess) : null };
}

/**
 * The run.json in a folder, as stored.
 * @param {string} folder
 * @returns {any} parsed JSON, not yet validated
 */
export function readRunJson(folder) {
  const path = join(folder, "run.json");
  if (!existsSync(path)) throw new Error(`${folder} is not a run folder: it has no run.json.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The newest run folder, by started_at, in one journey's folder of runs (like
 * journey-runs/share-by-link), or null when it has none.
 * @param {string} dir
 * @param {(raw: any) => boolean} [keep] which runs count, from their run.json
 * @returns {string|null}
 */
export function newestRunFolder(dir, keep = () => true) {
  if (!existsSync(dir)) return null;
  const started = (/** @type {any} */ raw) => Date.parse(raw?.started_at) || 0;
  const runs = readdirSync(dir)
    .map((id) => join(dir, id))
    .filter((folder) => existsSync(join(folder, "run.json")))
    .map((folder) => ({ folder, raw: readRunJson(folder) }))
    .filter(({ raw }) => keep(raw))
    .sort((a, b) => started(b.raw) - started(a.raw));
  return runs[0]?.folder ?? null;
}

/**
 * Read a run folder and everything a publish needs from it, checked against
 * the journey when given. Throws when it is not valid or a file it points to
 * is missing.
 *   raw: run.json as it is on disk. publish sends this, and digest covers it.
 *   run: the run as these rules settle it, to show. settled: the ids they settled.
 * The rules can change between versions, so they never touch what is digested.
 * @param {string} folder
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 */
export function readRunFolder(folder, { journey } = {}) {
  const raw = readRunJson(folder);
  const { run, settled, problems } = checkRun(raw, journey ?? undefined);
  for (const name of runFiles(run)) if (!existsSync(join(folder, name))) problems.push(`${name} is missing from ${folder}.`);
  if (problems.length) throw new Error(`${folder} is not a valid run:\n- ${problems.join("\n- ")}`);
  const files = new Map(runFiles(run).map((name) => [name, readFileSync(join(folder, name))]));
  const digests = Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)]));
  return { raw, run, settled, files, digests, digest: runDigest(raw, digests) };
}

/**
 * Write the settled run.json and its files to <dir>/<journey name>/<run id>/.
 * Refuses a run that fails validation, so a bad run never lands on disk.
 * @param {string} dir
 * @param {import("./runfile.js").Run} raw
 * @param {Map<string, Buffer>} files
 * @param {import("./format.js").Journey} [journey] to check the steps match its lines
 * @returns {{folder: string, run: import("./runfile.js").Run}}
 */
export function writeRunFolder(dir, raw, files, journey) {
  const { run, problems } = checkRun(raw, journey);
  if (problems.length) throw new Error(`Not a valid run:\n- ${problems.join("\n- ")}`);
  const folder = join(dir, run.journey.name, run.id);
  mkdirSync(folder, { recursive: true });
  for (const [name, bytes] of files) writeFileSync(join(folder, name), bytes);
  writeFileSync(join(folder, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return { folder, run };
}

/**
 * Set a run's findings, from a review, in its run.json. Nothing else in the
 * file changes, so a finding can never change a verdict or the result. Refuses
 * anything but findings, a run that is not valid with them, and dropping a
 * finding a person has already made a call on (a review whose `on` is its id).
 * @param {string} folder
 * @param {unknown} given the parsed findings file: {"findings": [...]}
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 * @returns {import("./runfile.js").Run} the run as written
 */
export function addFindings(folder, given, { journey } = {}) {
  const fields = given && typeof given === "object" && !Array.isArray(given) ? Object.keys(given) : [];
  const extra = fields.filter((field) => field !== "findings");
  if (extra.length) throw new Error(`The findings file may hold only findings. Remove: ${extra.join(", ")}. A finding never changes a verdict or the result.`);
  if (!fields.length) throw new Error('The findings file must be {"findings": [...]}. Write an empty list when the review found nothing.');
  const { reviews, ...rest } = readRunJson(folder);
  const findings = /** @type {{findings: unknown}} */ (given).findings;
  if (Array.isArray(findings) && Array.isArray(rest.findings)) {
    const kept = new Set(findings.map((f) => f?.id));
    const called = new Set((Array.isArray(reviews) ? reviews : []).map((r) => r?.on));
    const dropped = rest.findings.map((/** @type {any} */ f) => f?.id).filter((/** @type {unknown} */ id) => called.has(id) && !kept.has(id));
    if (dropped.length) throw new Error(`A person made a call on ${dropped.join(", ")}. Keep ${dropped.length === 1 ? "it" : "them"} in the findings file.`);
  }
  const run = { ...rest, findings, ...(reviews === undefined ? {} : { reviews }) };
  const { problems } = checkRun(run, journey ?? undefined);
  if (problems.length) throw new Error(`${folder} would not be a valid run with these findings:\n- ${problems.join("\n- ")}`);
  writeFileSync(join(folder, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

/**
 * Add a person's call on a check or a finding to a run's reviews. Nothing else
 * in the file changes: a call never changes a verdict or the result.
 * @param {string} folder
 * @param {{on: string, by: string, says: string, at?: string}} call on: a check id or a finding id. by: the person who made the call.
 * @param {{journey?: import("./format.js").Journey|null}} [options]
 * @returns {import("./runfile.js").Run} the run as written
 */
export function addReview(folder, { on, by, says, at = new Date().toISOString() }, { journey } = {}) {
  const raw = readRunJson(folder);
  const run = { ...raw, reviews: [...(Array.isArray(raw.reviews) ? raw.reviews : []), { by, at, on, says }] };
  const { problems } = checkRun(run, journey ?? undefined);
  if (problems.length) throw new Error(`${folder} would not be a valid run with this review:\n- ${problems.join("\n- ")}`);
  writeFileSync(join(folder, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}
