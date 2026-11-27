// A run of a change compared with main's run of the same journey: what each
// user lost or now pays for. Code decides, from what both runs measured. A
// model's view of a screenshot is never used.
//   worse: a control gone from a screen the user walks, or further away; a line
//     that takes more clicks or fields; a click or a tool call that crosses 1
//     second; a tool call that newly returns an error.
//   changed: something new on a screen, new words or a new look, fewer clicks,
//     a different number of tool calls.
// A failed check is "broke" and a check nobody decided is "not verified",
// whatever was measured. With no main run, a changed journey, or nothing
// measured, a user is "not compared", never "same". Each item has the shape of
// a finding, so it never changes a verdict and a person answers it with add-review.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkRun } from "../format/run-check.js";
import { addFindings, earlierRuns, newestRunFolder, readRunJson } from "../format/run-folder.js";
import { isCheck } from "../shared/display.js";
import { SLOW_MS, clicksOf, fieldsOf, outline, readMeasures } from "./measured.js";
import { count, readToolCalls, seconds } from "./tool-calls.js";

/** The most questions a comparison asks a person. More than a few and nobody reads them. */
export const MAX_QUESTIONS = 3;
/** Every outcome a user can have, worst first, with what a page calls it. */
export const OUTCOMES = { broke: "Broke", worse: "Got worse", not_verified: "Not verified", not_compared: "Not compared", changed: "Changed", same: "Same" };
const ORDER = Object.keys(OUTCOMES);

/**
 * @typedef {import("../format/runfile.js").Run} Run
 * @typedef {import("./measured.js").Measure} Measure
 * @typedef {import("./tool-calls.js").ToolCall} ToolCall
 * @typedef {{run: Run, measures: Map<number, Measure>, calls: Map<string, ToolCall[]>, folder?: string}} Side one run:
 *   the run as the rules settle it, its measure files by line, and its tool calls by transcript.
 * @typedef {{id: string, criterion: string, says: string, step?: number, ask?: string, evidence: import("../format/runfile.js").Evidence[],
 *   kind: "worse" | "changed", by: string, measured: Record<string, any>, calls: Array<{by: string, at: string, says: string}>}} Item
 *   a finding, with whose it is, whether it needs a person, and the calls people made on it.
 * @typedef {{user: string, outcome: keyof typeof OUTCOMES, says: string}} UserLine
 * @typedef {{n: number, text: string, by?: string, isCheck: boolean, state?: string, items: Item[],
 *   main: {actions: import("../runner/measure.js").ActionTime[]}, change: {actions: import("../runner/measure.js").ActionTime[]}}} StepPair a line that differs, with each side's actions
 * @typedef {{why: string|null, stale: string|null, users: UserLine[], items: Item[], questions: Item[], steps: StepPair[], same: number,
 *   main: Side|null, change: Side, against: string}} Comparison why: why nothing was compared. same: how many lines do not differ.
 *   main: the run compared with. against: what a page calls it, "main" or "the accepted run".
 */

/** @param {Measure|undefined} measure */
const names = (measure) => new Set((measure?.wide?.controls ?? []).map((c) => c.name));
/** @param {Measure|undefined} measure */
const took = (measure) => `${count(clicksOf(measure).length, "click")} and ${count(fieldsOf(measure).length, "field")}`;
/** @param {string} user */
const their = (user) => (user === "you" ? "your" : `the ${user}'s`);
/** Who a line belongs to. A line that names no one is yours. @param {{by?: string}} step */
const byOf = (step) => step.by || "you";
/** @param {any} a a stored run.json @param {any} b */
const sameCase = (a, b) => (a?.journey?.case ?? null) === (b?.journey?.case ?? null);
/** A draft 0 run has no users to compare. @param {any} raw a stored run.json */
const isLegacy = (raw) => Array.isArray(raw?.outcomes);

/**
 * @param {Side|null} main main's run of the journey, or null when there is none
 * @param {Side} change the run of the change
 * @param {{head?: string, why?: string, against?: string}} [options] head: the commit the change is at now. why: why there is no main run.
 *   against: what the first run is called, when it is not main's.
 * @returns {Comparison}
 */
export function compareRuns(main, change, { head, why: noMain, against = "main" } = {}) {
  const steps = change.run.steps;
  const users = [...new Set(steps.map(byOf))];
  const on = against === "main" ? "On main" : `In ${against}`;
  const versions = [main?.run.journey?.version, change.run.journey?.version];
  const why = !main ? noMain ?? "There is no run from main to compare with." : versions[0] !== versions[1] ? "The journey's lines changed since main's run, so the two runs are not the same journey." : null;
  /** @type {Item[]} */
  const items = [];
  /** @type {Set<string>} */
  const measured = new Set();
  const reviews = Array.isArray(change.run.reviews) ? change.run.reviews : [];
  /** @param {Omit<Item, "id" | "calls" | "evidence"> & {evidence: {source: string, [field: string]: unknown}}} item */
  const add = (item) => {
    const base = `${item.criterion}-${item.step ?? "run"}`;
    const n = items.filter((other) => other.id === base || other.id.startsWith(`${base}-`)).length;
    const id = n ? `${base}-${n + 1}` : base;
    items.push({ ...item, id, evidence: [{ login: item.by, ...item.evidence, measured: item.measured }], calls: reviews.filter((r) => r?.on === id).map(({ by, at, says }) => ({ by, at, says })) });
  };
  if (main && !why) {
    /** @type {Set<string>} */
    const said = new Set();
    steps.forEach((step, i) => {
      const n = i + 1;
      const by = byOf(step);
      const [was, now] = [main.measures.get(n), change.measures.get(n)];
      if (!was || !now) return;
      measured.add(by);
      const evidence = { source: "page", url: now.url ?? was.url ?? "not captured", file: `measure-${n}.txt` };
      const before = items.length;
      for (const name of names(was)) {
        if (names(now).has(name) || said.has(name)) continue;
        said.add(name);
        const later = steps.findIndex((s, j) => j > i && byOf(s) === by && names(change.measures.get(j + 1)).has(name)) + 1;
        const between = steps.flatMap((s, j) => (j > i && j < later && byOf(s) === by ? clicksOf(change.measures.get(j + 1)) : []));
        if (later) add({ criterion: "compare-moved", kind: "worse", by, step: n, says: `${name} is not on this screen. ${on} it was. It first shows at step ${later}${between.length ? `, ${count(between.length, "click")} later (${between.map((a) => a.name).join(", ")})` : ""}.`, measured: { control: name, at: later, clicks: between.length }, evidence });
        else add({ criterion: "compare-gone", kind: "worse", by, step: n, says: `${name} is not on any screen this run walked. ${on} it was on this one.`, measured: { control: name }, evidence });
      }
      const [paid, paidOnMain] = [clicksOf(now).length + fieldsOf(now).length, clicksOf(was).length + fieldsOf(was).length];
      if (paid !== paidOnMain) add({ criterion: paid > paidOnMain ? "compare-more-steps" : "compare-fewer-steps", kind: paid > paidOnMain ? "worse" : "changed", by, step: n, says: `This line takes ${took(now)}. ${on} it took ${took(was)}.`, measured: { now: now.actions.map((a) => a.name), main: was.actions.map((a) => a.name) }, evidence });
      for (const a of clicksOf(now)) {
        const earlier = clicksOf(was).find((b) => b.name === a.name);
        const slow = a.ms === null || /** @type {number} */ (a.ms) >= SLOW_MS;
        if (!earlier || earlier.ms === null || /** @type {number} */ (earlier.ms) >= SLOW_MS || !slow) continue;
        add({ criterion: "compare-slow", kind: "worse", by, step: n, says: a.ms === null ? `Nothing on the screen changes after "${a.name}". ${on} it changed in ${earlier.ms} ms.` : `"${a.name}" shows nothing for ${a.ms} ms. ${on} it took ${earlier.ms} ms.`, measured: { click: a.name, ms: a.ms, main: earlier.ms }, evidence });
      }
      const fresh = [...names(now)].filter((name) => !names(was).has(name) && !said.has(`new ${name}`));
      for (const name of fresh) said.add(`new ${name}`);
      if (fresh.length) add({ criterion: "compare-new", kind: "changed", by, step: n, says: `New on this screen: ${fresh.join(", ")}.`, measured: { new: fresh }, evidence });
      // A screen that only carries a difference already said, like a button that stays, is not said again.
      else if (items.length === before && outline(now) !== outline(was) && ![...names(now), ...names(was)].some((name) => said.has(name) || said.has(`new ${name}`))) add({ criterion: "compare-differs", kind: "changed", by, step: n, says: `This screen's words or look differ. ${on} they were not these.`, measured: {}, evidence });
    });
    // An agent's calls are not tied to a line, so they are compared for the whole run.
    const caller = users.includes("agent") ? "agent" : users[0];
    for (const [file, calls] of change.calls) {
      const was = main.calls.get(file);
      if (!was) continue;
      measured.add(caller);
      const evidence = (/** @type {ToolCall} */ call) => ({ source: "log", query: `${file}, line ${call.reply ?? "none"}` });
      for (const call of calls.filter((c) => c.error && !was.some((b) => b.tool === c.tool && b.error))) {
        add({ criterion: "compare-error", kind: "worse", by: caller, says: `${call.tool} returned an error: ${call.says || "Error"} ${on} no ${call.tool} call did.`, measured: { tool: call.tool }, evidence: evidence(call) });
      }
      for (const call of calls) {
        const slowest = Math.max(-1, ...was.filter((b) => b.tool === call.tool && b.ms !== undefined).map((b) => /** @type {number} */ (b.ms)));
        if (call.ms === undefined || call.ms < SLOW_MS || slowest < 0 || slowest >= SLOW_MS) continue;
        add({ criterion: "compare-slow", kind: "worse", by: caller, says: `${call.tool} took ${seconds(call.ms)}. ${on} it took ${seconds(slowest)}.`, measured: { tool: call.tool, ms: call.ms, main: slowest }, evidence: evidence(call) });
      }
      if (calls.length !== was.length) add({ criterion: calls.length > was.length ? "compare-more-calls" : "compare-fewer-calls", kind: "changed", by: caller, says: `The agent made ${count(calls.length, "tool call")}. ${on} it made ${was.length}.`, measured: { calls: calls.length, main: was.length }, evidence: evidence(calls[calls.length - 1]) });
    }
  }
  const lines = users.map((user) => userLine(user, steps, items.filter((item) => item.by === user), against, why ?? (measured.has(user) ? null : `Nothing was measured for ${user === "you" ? "you" : `the ${user}`} in both runs: no measure files and no tool calls to compare.`)));
  const pairs = steps.map((step, i) => ({ n: i + 1, text: String(isCheck(step) ? step.check : step.says), by: byOf(step), isCheck: isCheck(step), state: isCheck(step) ? step.verdict : step.status,
    items: items.filter((item) => item.step === i + 1), main: { actions: main?.measures.get(i + 1)?.actions ?? [] }, change: { actions: change.measures.get(i + 1)?.actions ?? [] } })).filter((pair) => pair.items.length);
  const questions = items.filter((item) => item.kind === "worse").slice(0, MAX_QUESTIONS);
  for (const q of questions) q.ask = `Is that OK for ${q.by === "you" ? "you" : `the ${q.by}`}?`;
  const commit = String(change.run.repos?.[0]?.commit ?? "");
  const stale = head && commit && !head.startsWith(commit) && !commit.startsWith(head) ? `This run is from commit ${commit.slice(0, 7)}. The change is now at ${head.slice(0, 7)}. Run the journey again.` : null;
  return { why, stale, users: lines.sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome)), items, questions, steps: pairs, same: steps.length - pairs.length, main, change, against };
}

/**
 * One user's outcome and the sentence that says it.
 * @param {string} user @param {Run["steps"]} steps @param {Item[]} items the user's items
 * @param {string} against what the run compared with is called
 * @param {string|null} notCompared why this user could not be compared
 * @returns {UserLine}
 */
function userLine(user, steps, items, against, notCompared) {
  const mine = steps.filter((s) => byOf(s) === user);
  const checks = mine.filter(isCheck);
  const failed = /** @type {any} */ (mine.find((s) => (isCheck(s) ? s.verdict : s.status) === "failed"));
  if (failed) return { user, outcome: "broke", says: `${failed.check ?? failed.says} ${failed.reason ?? ""}`.trim() };
  const open = checks.filter((s) => s.verdict !== "passed");
  if (open.length) return { user, outcome: "not_verified", says: `${open.length} of ${count(checks.length, "check")} ${open.length === 1 ? "was" : "were"} not verified: ${open[0].check}` };
  if (notCompared) return { user, outcome: "not_compared", says: notCompared };
  const pass = checks.length ? ` ${checks.length === 1 ? "The 1 check" : `All ${checks.length} checks`} still pass${checks.length === 1 ? "es" : ""}.` : "";
  for (const kind of /** @type {const} */ (["worse", "changed"])) {
    const found = items.filter((item) => item.kind === kind);
    const first = found.find((item) => item.criterion === "compare-moved") ?? found[0];
    if (first) return { user, outcome: kind, says: `${first.step ? `Step ${first.step}: ` : ""}${first.says}${found.length > 1 ? ` And ${count(found.length - 1, "more change")}.` : ""}${pass}` };
  }
  return { user, outcome: "same", says: `Nothing measured differs from ${against} in ${their(user)} lines.${pass}` };
}

/**
 * A run folder as one side of a comparison.
 * @param {string} folder
 * @returns {Side}
 */
function readSide(folder) {
  return { folder, run: checkRun(readRunJson(folder)).run, measures: readMeasures(folder), calls: readToolCalls(folder) };
}

/**
 * A run of the change a person accepted: it has comparison findings, and on
 * each a person made a call that starts with "Accept". Any other call, like
 * "No, put it back", accepts nothing.
 * @param {any} raw a stored run.json
 */
function accepted(raw) {
  const found = (Array.isArray(raw.findings) ? raw.findings : []).filter((/** @type {any} */ f) => String(f?.criterion).startsWith("compare-"));
  const called = new Set((Array.isArray(raw.reviews) ? raw.reviews : []).filter((/** @type {any} */ r) => /^\s*accept/i.test(String(r?.says))).map((/** @type {any} */ r) => r.on));
  return found.length > 0 && found.every((/** @type {any} */ f) => called.has(f.id));
}

/**
 * The run a run of a change is compared with: the newest of main's runs of the
 * same journey, case and journey version, and the earlier runs of the change a
 * person accepted. Merging is how a run gets to main, so a main run needs no call.
 * @param {string} folder the run folder of the change
 * @param {string} [mainDir] main's runs folder
 * @returns {{folder: string|null, why?: string, accepted?: true}}
 */
export function baselineFor(folder, mainDir) {
  const raw = readRunJson(folder);
  const journey = join(mainDir ?? "", String(raw.journey?.name));
  const same = (/** @type {any} */ other) => sameCase(other, raw) && !isLegacy(other) && other?.journey?.version === raw.journey?.version;
  const fromMain = mainDir ? newestRunFolder(journey, same) : null;
  const own = earlierRuns(folder).find((run) => same(run.raw) && accepted(run.raw));
  if (own && (!fromMain || Date.parse(own.raw.started_at) > Date.parse(readRunJson(fromMain).started_at))) return { folder: own.folder, accepted: true };
  if (fromMain) return { folder: fromMain };
  if (!mainDir) return { folder: null, why: "No folder of main's runs was given. Pass --main <runs folder>." };
  return { folder: null, why: newestRunFolder(journey, (other) => sameCase(other, raw)) ? "The journey's lines changed since main's run, so the two runs are not the same journey." : `There is no run of this journey from main in ${mainDir}.` };
}

/**
 * Compare a run folder with its baseline.
 * @param {string} folder the run folder of the change
 * @param {{mainDir?: string, head?: string}} [options]
 * @returns {Comparison}
 */
export function compareFolder(folder, { mainDir, head } = {}) {
  const raw = readRunJson(folder);
  if (isLegacy(raw)) throw new Error(`${folder} is a draft 0 run. Run the journey again to write a v1 run, then compare.`);
  const baseline = baselineFor(folder, mainDir);
  const result = compareRuns(baseline.folder ? readSide(baseline.folder) : null, readSide(folder), { head, why: baseline.why, against: baseline.accepted ? "the accepted run" : "main" });
  const newer = newestRunFolder(dirname(resolve(folder)), (other) => sameCase(other, raw));
  return { ...result, stale: result.stale ?? (newer && newer !== resolve(folder) ? "A newer run of this journey is in the same folder. This one is not the current run." : null) };
}

/**
 * The newest run of each journey and case in a runs folder, each compared with its baseline.
 * @param {string} runsDir
 * @param {{mainDir?: string, head?: string}} [options]
 * @returns {Comparison[]}
 */
export function compareAll(runsDir, options = {}) {
  /** @type {Comparison[]} */
  const all = [];
  for (const journey of existsSync(runsDir) ? readdirSync(runsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []) {
    const dir = join(runsDir, journey);
    const runs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "run.json"))).map((e) => readRunJson(join(dir, e.name))).filter((raw) => !isLegacy(raw));
    for (const id of new Set(runs.map((raw) => raw.journey?.case ?? null))) {
      const folder = newestRunFolder(dir, (raw) => !isLegacy(raw) && (raw?.journey?.case ?? null) === id);
      if (folder) all.push(compareFolder(folder, options));
    }
  }
  return all;
}

/**
 * What `journeysfirst compare` prints: each journey, then one line for each user.
 * @param {Comparison[]} all
 * @param {{markdown?: boolean}} [options] markdown: a table for a pull request
 */
export function compareReport(all, { markdown = false } = {}) {
  const name = (/** @type {Comparison} */ c) => `${c.change.run.journey.name}${c.change.run.journey.case ? ` (${c.change.run.journey.case})` : ""}`;
  if (!all.length) return "No runs to compare.";
  if (markdown) {
    const cell = (/** @type {string} */ text) => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
    const rows = all.flatMap((c) => c.users.map((u) => `| ${cell(name(c))} | ${cell(u.user)} | ${OUTCOMES[u.outcome]} | ${cell(u.says)}${c.stale ? " Stale." : ""} |`));
    return `| Journey | User | Against main | What changed |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n`;
  }
  const wide = Math.max(...all.flatMap((c) => c.users.map((u) => u.user.length)));
  return all.flatMap((c) => [`${name(c)}  ${c.change.folder ?? ""}`, ...(c.main?.folder ? [`  Compared with ${c.against}, ${c.main.folder}.`] : []), ...(c.stale ? [`  Stale: ${c.stale}`] : []),
    ...c.users.map((u) => `  ${u.user.padEnd(wide)}  ${OUTCOMES[u.outcome].toLowerCase().padEnd(12)}  ${u.says}`),
    ...c.questions.map((q) => `  question  ${q.id}  ${q.says} ${q.ask}`), ""]).join("\n").trimEnd();
}

/**
 * Write a comparison's items into the run as findings, beside the findings a
 * review wrote. Nothing else in the run changes. A person then answers one with add-review.
 * @param {string} folder the run folder of the change
 * @param {Comparison} comparison
 * @returns {Run} the run as written
 */
export function addCompareFindings(folder, comparison) {
  const raw = readRunJson(folder);
  const others = (Array.isArray(raw.findings) ? raw.findings : []).filter((/** @type {any} */ f) => !String(f?.criterion).startsWith("compare-"));
  const found = comparison.items.map(({ id, criterion, says, step, ask, evidence }) => ({ id, criterion, says, ...(step === undefined ? {} : { step }), ...(ask === undefined ? {} : { ask }), evidence }));
  return addFindings(folder, { findings: [...others, ...found] });
}
