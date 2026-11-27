// The compare pages. One page for a change: each journey, with one sentence
// for each user. One page for a journey: the same sentences, then only the
// lines that differ, each with main on the left and the change on the right,
// both showing the clicks taken and the screen they end on. What differs is
// written under them in words. compare.js decides everything shown here.
import { esc, isCheck, runTitle, screenshotFile } from "../shared/display.js";
import { MAX_QUESTIONS, OUTCOMES } from "./compare.js";
import { layout } from "./layout.js";
import { badge } from "./primitives.js";
import { roleName } from "./run-player.js";
import { count, seconds } from "./tool-calls.js";

/**
 * @typedef {import("./compare.js").Comparison} Comparison
 * @typedef {{file: (name: string | undefined) => string | undefined, mainFile: (name: string | undefined) => string | undefined,
 *   run: string, all: string, shown?: Shown, folder?: string}} Links file, mainFile: the address of a file in the change's run and in main's.
 *   run: the page of the change's run. all: the page for the whole change. shown: the run with its journey's title and promise, when known.
 *   folder: the change's run folder, to print in a command. An export leaves it out, so no path on this machine is shared.
 * @typedef {{journey?: {name?: string, title?: string}, promise?: string}} Shown
 */

/** The branch and commit a run tested, when it recorded them. @param {import("./compare.js").Side | null} side @param {string} name */
const tested = (side, name) => {
  const { branch, commit } = side?.run.repos?.[0] ?? {};
  return `${name}${branch && branch !== name ? `: ${branch}` : ""}${commit ? ` @ ${String(commit).slice(0, 7)}` : ""}`;
};
/** @param {Comparison} c @param {Shown} [shown] */
const title = (c, shown) => `${runTitle(shown ?? c.change.run)}${c.change.run.journey.case ? ` (${c.change.run.journey.case})` : ""}`;

/** One sentence for each user, worst first. @param {Comparison} c */
const userRows = (c) => c.users.map((u) => `<div class="row"><span class="title">${badge(u.outcome, OUTCOMES[u.outcome])} ${esc(roleName(u.user))}</span><span class="summary">${esc(u.says)}</span></div>`).join("");

/** How many users have each outcome, as tags. @param {Comparison[]} all */
function tally(all) {
  const users = all.flatMap((c) => c.users);
  return Object.entries(OUTCOMES).map(([outcome, label]) => [users.filter((u) => u.outcome === outcome).length, outcome, label]).filter(([n]) => n)
    .map(([n, outcome, label]) => badge(String(outcome), `${n} ${String(label).toLowerCase()}`)).join(" ");
}

/** What a page says when its run is not the current one. @param {Comparison} c */
const staleNote = (c) => (c.stale ? `<section class="problems cmp-callout"><p><b>Stale.</b> ${esc(c.stale)}</p></section>` : "");

/**
 * The page for a change: every journey that ran, each with one sentence for each user.
 * @param {Comparison[]} all
 * @param {(c: Comparison) => string} url the compare page of one journey
 * @param {(c: Comparison) => Shown | undefined} [shown] the run with its journey's title, when known
 */
export function changePage(all, url, shown = () => undefined) {
  const rows = all.map((c) => `<div class="day"><a href="${esc(url(c))}">${esc(title(c, shown(c)))}</a>${c.stale ? " · stale" : ""}</div>${userRows(c)}`).join("");
  return layout("Compared with main", `<p class="verdict-row">${tally(all)}</p><h1>What this change did to each user</h1>
    ${rows ? `<div class="rows">${rows}</div>` : '<p class="empty">No runs to compare yet. Run a journey and it shows up here.</p>'}${PRIVATE}`, [{ text: "Compared with main" }]);
}

const PRIVATE = '<p class="how cmp-note">These pages are files on your machine. Nobody else sees them until you put them somewhere.</p>';

/**
 * The page for one journey of a change.
 * @param {Comparison} c
 * @param {Links} links
 */
export function comparePage(c, links) {
  const { run } = c.change;
  const planted = typeof run.tags?.planted === "string" ? `<section class="problems cmp-callout"><p><b>Planted for a demo.</b> ${esc(run.tags.planted)}</p></section>` : "";
  const facts = [c.main ? tested(c.main, c.against) : "main: no run", tested(c.change, "this change"), run.started_at && new Date(run.started_at).toLocaleString(), run.ran_by?.agent].filter(Boolean);
  const pairs = c.steps.map((pair) => {
    const shot = (/** @type {import("./compare.js").Side | null} */ side, /** @type {Links["file"]} */ file) => {
      const src = file(screenshotFile(side?.run.steps[pair.n - 1]?.screenshots?.[0]));
      return src ? `<img src="${esc(src)}" alt="The screen after step ${pair.n}">` : '<p class="empty">No screenshot of this step.</p>';
    };
    const column = (/** @type {string} */ name, /** @type {typeof pair.main} */ { actions }, /** @type {string} */ image) => `<div class="cmp-side"><p class="line-kind">${name}</p>
      ${actions.length ? `<ol class="cmp-actions">${actions.map((a) => `<li>${a.field ? "fill" : a.name.startsWith("open ") ? "" : "click"} ${esc(a.name)}${typeof a.ms === "number" && !a.field ? ` <span class="how">${esc(a.ms)} ms</span>` : ""}</li>`).join("")}</ol>` : '<p class="how">No click or field.</p>'}${image}</div>`;
    return `<section class="cmp-step" id="step-${pair.n}"><p class="line-kind">Step ${pair.n} · ${pair.isCheck ? "Check" : "Action"}${pair.by ? ` · ${esc(roleName(pair.by))}` : ""} · ${badge(pair.state)}</p><h2>${esc(pair.text)}</h2>
      <div class="cmp-cols">${column(esc(c.against), pair.main, shot(c.main, links.mainFile))}${column("this change", pair.change, shot(c.change, links.file))}</div>
      <ul class="findings">${pair.items.map(itemHtml).join("")}</ul></section>`;
  });
  const whole = c.items.filter((item) => item.step === undefined);
  const sides = /** @type {Array<[string, import("./compare.js").Side | null]>} */ ([[esc(c.against), c.main], ["this change", c.change]]);
  const calls = whole.length ? `<section class="cmp-step"><p class="line-kind">The whole run · Agent</p><h2>The agent's tool calls</h2>
    <div class="cmp-cols">${sides.map(([name, side]) => `<div class="cmp-side"><p class="line-kind">${name}</p><ol class="cmp-actions">${[...(side?.calls.values() ?? [])].flat().map((call) => `<li>${esc(call.tool)} <span class="${call.error ? "error" : "how"}">${call.error ? "error" : call.ms === undefined ? "" : esc(seconds(call.ms))}</span></li>`).join("")}</ol></div>`).join("")}</div>
    <ul class="findings">${whole.map(itemHtml).join("")}</ul></section>` : "";
  const checks = run.steps.filter(isCheck);
  const questions = c.questions.length ? `<section class="start" aria-label="Questions"><h2>${count(c.questions.length, "question")} for a person</h2>
    <p class="how">Each is about a measured change, not a failed check. At most ${MAX_QUESTIONS} are asked. Only a person can accept one, with words that start with Accepted. When each is accepted, this run is what the next run of the change is compared with.</p>
    <ul class="findings">${c.questions.map((q) => `<li><p class="says">${esc(q.says)}</p><p>${esc(q.ask)}</p>${callsHtml(q)}${q.calls.length ? "" : `<pre>npx journeysfirst add-review ${esc(links.folder ?? "<run folder>")} --on ${esc(q.id)} --by &lt;you&gt; --says "Accepted: &lt;why&gt;"</pre>`}</li>`).join("")}</ul>
    <p class="how">A question can be answered once it is in the run. Write it there with: npx journeysfirst compare ${esc(links.folder ?? "<run folder>")} --main &lt;main's runs&gt; --add-findings</p></section>` : "";
  const name = title(c, links.shown);
  return layout(`${name}: compared with main`, `<section class="strip cmp-strip${c.stale ? " stale" : ""}">
      <p class="verdict-row">${tally([c])} <span class="facts">${facts.map(esc).join(" · ")}</span></p>
      <h1>${esc(links.shown?.promise ?? name)}</h1>
    </section>
    <div class="cmp-body">${staleNote(c)}${planted}${c.why ? `<section class="problems cmp-callout"><p><b>Not compared.</b> ${esc(c.why)}</p></section>` : ""}
    <div class="rows">${userRows(c)}</div>
    <p class="how cmp-note">${c.why ? "" : `${count(c.steps.length, "step")} of ${run.steps.length} differ from ${esc(c.against)}. ${c.same} ${c.same === 1 ? "is" : "are"} the same and not shown. `}${checks.filter((s) => s.verdict === "passed").length} of ${count(checks.length, "check")} passed. A change that makes a user's work harder never fails a check. <a href="${esc(links.run)}">Open the run</a></p>
    ${pairs.join("")}${calls}${questions}${PRIVATE}</div>`, [{ text: "Compared with main", href: links.all }, { text: name }]);
}

/** One measured change, in words, with any call a person made on it. @param {import("./compare.js").Item} item */
const itemHtml = (item) => `<li><p class="says">${badge(item.kind, item.kind === "worse" ? OUTCOMES.worse : OUTCOMES.changed)} ${esc(item.says)}</p>${callsHtml(item)}</li>`;
/** @param {import("./compare.js").Item} item */
const callsHtml = (item) => item.calls.map((r) => `<p class="call"><b>${esc(r.by)}</b>: ${esc(r.says)} <span class="how">${esc(new Date(r.at).toLocaleString())}</span></p>`).join("");
