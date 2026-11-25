// What a run's measure files say about the criteria a number can settle (the
// journey-review skill has the criteria). The runner saves measure-<line>.txt
// after each line. This reads them, compares with the earlier reviewed run,
// and gives one fact for each thing a review should look at. It judges
// nothing a number cannot show. It keeps no list of the product's values: the
// design system journeys/README.md links to is that list, and a review reads it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readRunJson } from "../format/run-folder.js";

const VALUE_KINDS = /** @type {const} */ (["spacing", "type", "fonts", "radius"]);

/**
 * @typedef {Record<string, {n: number, on: string}>} Tally
 * @typedef {{width: number, pageWidth: number, text?: string, spacing: Tally, type: Tally, fonts: Tally, radius: Tally, effects: Tally,
 *   controls: Array<{name: string, in: string, width: number, height: number, small?: boolean, strong?: boolean}>,
 *   cut: Array<{name: string, left: number, width: number}>}} Screen
 * @typedef {{url?: string, wide?: Screen, phone?: Screen, actions: import("../runner/measure.js").ActionTime[]}} Measure
 * @typedef {{criterion: string, step: number, says: string, measured: object}} Fact
 */

/**
 * The measure files in a run folder, by line number.
 * @param {string} folder
 * @returns {Map<number, Measure>}
 */
export function readMeasures(folder) {
  /** @type {Map<number, Measure>} */
  const lines = new Map();
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    const line = /^measure-(\d+)\.txt$/.exec(name);
    if (line) lines.set(Number(line[1]), JSON.parse(readFileSync(join(folder, name), "utf8")));
  }
  return new Map([...lines].sort(([a], [b]) => a - b));
}

/**
 * The newest run before this one, of the same journey and case, that was
 * reviewed and has measure files. null when there is none.
 * @param {string} folder a run folder
 * @returns {string|null}
 */
export function earlierRun(folder) {
  const run = readRunJson(folder);
  const dir = dirname(folder);
  const before = readdirSync(dir)
    .map((id) => join(dir, id))
    .filter((other) => existsSync(join(other, "run.json")))
    .map((other) => ({ folder: other, raw: readRunJson(other) }))
    .filter(({ raw }) => raw.id !== run.id && (raw.journey?.case ?? null) === (run.journey?.case ?? null) && Array.isArray(raw.findings) && Date.parse(raw.started_at) < Date.parse(run.started_at))
    .filter((other) => readMeasures(other.folder).size)
    .sort((a, b) => Date.parse(b.raw.started_at) - Date.parse(a.raw.started_at));
  return before[0]?.folder ?? null;
}

/**
 * Every spacing, type size, font and radius these screens use, sorted, as one line.
 * @param {Map<number, Measure>} lines
 */
export function valuesUsed(lines) {
  const all = Object.fromEntries(VALUE_KINDS.map((kind) => [kind, new Set()]));
  for (const measure of lines.values()) for (const screen of screens(measure)) for (const kind of VALUE_KINDS) for (const value of Object.keys(screen[kind] ?? {})) all[kind].add(value);
  /** @param {Set<string>} set */
  const numbers = (set) => [...set].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ");
  return `Spacing ${numbers(all.spacing)} px. Type ${numbers(all.type)} px. Font ${[...all.fonts].sort().join(", ")}. Radius ${numbers(all.radius) || "0"} px.`;
}

/**
 * One fact for each thing the measure files show that a criterion names.
 * @param {{lines: Map<number, Measure>, earlier?: Map<number, Measure>|null}} measured
 *   lines: this run. earlier: the earlier reviewed run.
 * @returns {{facts: Fact[], counts: string[], notMeasured: string[], differ: number[]}}
 *   differ: the steps whose screen is not the one the earlier run measured (its words, controls, values or actions).
 */
export function measuredFacts({ lines, earlier = null }) {
  /** @type {Fact[]} */
  const facts = [];
  const counts = [];
  const notMeasured = [];
  const used = new Set([...lines.values()].flatMap((m) => m.actions.map((a) => a.name.slice(0, 30))));
  const reported = new Set();
  const differ = [...lines].filter(([step, measure]) => earlier && outline(measure) !== outline(earlier.get(step))).map(([step]) => step);
  for (const [step, measure] of lines) {
    const clicks = measure.actions.filter((a) => !a.field && !a.name.startsWith("open "));
    const fields = measure.actions.filter((a) => a.field);
    for (const a of clicks) {
      if (a.ms === null) facts.push({ criterion: "intuitive-feedback", step, says: `Nothing on the screen changes after "${a.name}".`, measured: a });
      else if (/** @type {number} */ (a.ms) >= 1000) facts.push({ criterion: "simple-fast", step, says: `"${a.name}" shows nothing for ${a.ms} ms.`, measured: a });
    }
    if (clicks.length || fields.length) counts.push(`step ${step}: ${count(clicks.length, "click")}, ${count(fields.length, "field")}`);
    const before = earlier?.get(step);
    if (before) {
      const was = { clicks: before.actions.filter((a) => !a.field && !a.name.startsWith("open ")).length, fields: before.actions.filter((a) => a.field).length };
      if (clicks.length + fields.length > was.clicks + was.fields) {
        facts.push({ criterion: "simple-no-longer", step, says: `This line takes ${count(clicks.length, "click")} and ${count(fields.length, "field")}. In the earlier run it took ${count(was.clicks, "click")} and ${count(was.fields, "field")}.`, measured: { now: measure.actions.map((a) => a.name), earlier: before.actions.map((a) => a.name) } });
      }
    }
    /** @type {Map<string, Screen["controls"]>} */
    const groups = new Map();
    for (const c of measure.wide?.controls ?? []) if (c.strong && /^(dialog|alertdialog|form)/.test(c.in)) groups.set(c.in, [...(groups.get(c.in) ?? []), c]);
    for (const [region, strong] of groups) {
      const key = `strong ${region} ${strong.map((c) => c.name).join()}`;
      if (strong.length > 1 && !reported.has(key)) reported.add(key) && facts.push({ criterion: "simple-one-action", step, says: `The ${region} has ${strong.length} buttons that stand out: ${strong.map((c) => c.name).join(", ")}.`, measured: { in: region, strong: strong.map((c) => c.name) } });
    }
    /** @type {string[]} */
    const fresh = [];
    for (const kind of /** @type {const} */ ([...VALUE_KINDS, "effects"])) {
      if (!before) continue;
      const seen = new Set(screens(before).flatMap((screen) => Object.keys(screen[kind] ?? {})));
      for (const screen of screens(measure)) {
        for (const [value, { on }] of Object.entries(screen[kind] ?? {})) {
          const key = `${kind} ${value}`;
          if (seen.has(value) || reported.has(key)) continue;
          reported.add(key);
          fresh.push(`${kind === "effects" ? value : `${kind} ${value}${kind === "fonts" ? "" : " px"}`} on ${on}`);
        }
      }
    }
    if (fresh.length) {
      facts.push({ criterion: "foundation-values", step, says: `New since the earlier run: ${fresh.join("; ")}.`, measured: { new: fresh } });
    }
    const phone = measure.phone;
    if (!phone) notMeasured.push(`foundation-phone on step ${step}: the run did not measure at 375 px`);
    else {
      if (phone.pageWidth > phone.width && !reported.has("page")) {
        reported.add("page");
        facts.push({ criterion: "foundation-phone", step, says: `At ${phone.width} px the page is ${phone.pageWidth} px wide, so it scrolls sideways.`, measured: { width: phone.width, pageWidth: phone.pageWidth } });
      }
      const cut = phone.cut.filter((c) => !reported.has(`cut ${c.name}`));
      const small = phone.controls.filter((c) => c.small && used.has(quoted(c.name)) && !reported.has(`small ${c.name}`));
      for (const c of cut) reported.add(`cut ${c.name}`);
      for (const c of small) reported.add(`small ${c.name}`);
      // One fact for a step, so a review writes one finding that names every control.
      const said = [
        ...cut.map((c) => `${c.name} is ${c.width} px wide and runs off the screen.`),
        ...(small.length ? [`${small.map((c) => `${c.name} is ${c.width} by ${c.height} px`).join(", ")}. A control needs 24 px each way.`] : []),
      ];
      if (said.length) facts.push({ criterion: "foundation-phone", step, says: `At ${phone.width} px: ${said.join(" ")}`, measured: { cut, small: small.map(({ name, width, height }) => ({ name, width, height })) } });
    }
  }
  return { facts, counts, notMeasured, differ };
}

/**
 * What makes two measurements the same screen: the words, the controls, the values and what each click did.
 * A page the script opened is left out: its paint can land on either side of a line's start.
 * @param {Measure|undefined} measure
 */
const outline = (measure) =>
  JSON.stringify([
    measure?.actions.filter((a) => !a.name.startsWith("open ")).map((a) => [a.name, a.changed, a.ms === null]),
    screens(measure).map((s) => [s.text, s.pageWidth > s.width, s.controls.map((c) => [c.name, c.in, c.small, c.strong]), s.cut.length, VALUE_KINDS.map((kind) => Object.keys(s[kind] ?? {})), Object.keys(s.effects ?? {})]),
  ]);

/** @param {Measure|undefined} measure */
const screens = (measure) => /** @type {Screen[]} */ ([measure?.wide, measure?.phone].filter(Boolean));

/** The words in a control's name, like Share from button "Share". @param {string} name */
const quoted = (name) => /"(.*)"$/.exec(name)?.[1] ?? name;

/** @param {number} n @param {string} word */
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The report `journeysfirst measured` prints for a run folder.
 * @param {string} folder
 */
export function measuredReport(folder) {
  readRunJson(folder);
  const lines = readMeasures(folder);
  if (!lines.size) return `${folder} has no measure files. A run made by a saved Playwright script has them. Without them every measured criterion is "not measured".`;
  const before = earlierRun(folder);
  const { facts, counts, notMeasured, differ } = measuredFacts({ lines, earlier: before ? readMeasures(before) : null });
  const said = [`${folder}`, before ? `Compared with the earlier reviewed run, ${before}.` : "No earlier reviewed run to compare with."];
  if (before) said.push(differ.length ? `Screens that differ from the earlier run: step ${differ.join(", ")}.` : "No screen differs from the earlier run.");
  else said.push("Values this run uses. Check them against the design system journeys/README.md links to:", `  ${valuesUsed(lines)}`);
  said.push("", ...(facts.length ? facts.map((f) => `fact  ${f.criterion}  step ${f.step}  ${f.says}  (measure-${f.step}.txt)`) : ["No measured criterion fails."]));
  if (counts.length) said.push("", `Counts: ${counts.join("; ")}.`);
  for (const line of notMeasured) said.push(`Not measured: ${line}.`);
  return said.join("\n");
}
