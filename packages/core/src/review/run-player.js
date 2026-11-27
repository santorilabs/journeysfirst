// The run player on the review page. It fits one screen. On the left, one
// user's video at a time, with a switch between the users in the run. Under
// the video, each of that user's steps is a mark on the timeline: a check is a
// numbered mark in its verdict's color, any other step a small dot. A step
// that is in no video shows its screenshot there. On the right (under it on
// a phone), every step in order, in a panel that scrolls. Picking a step or a
// mark plays that user's video from there and opens the step's details under
// its line: how it went and how it was checked. Tabs beside the steps hold
// what the page passes in. The page opens on the first failure, or on ?step=<n>.
import { clock, esc, LABELS, spreadMarks } from "../shared/display.js";
import { PLAYER_CSS, PLAYER_SCRIPT, playerHtml } from "./player.js";
import { panel, tabs } from "./primitives.js";

/**
 * One step as the player shows it.
 * @typedef {{n: number, text: string, isCheck: boolean, state?: string, by?: string,
 *   at?: number, card: string, shot?: string}} PlayerStep at: seconds into the video of `by`. card: the step's details, as HTML.
 *   shot: the step's screenshots, as HTML, when the step is in no video.
 * @typedef {{user: string, src: string, captions?: string, holds?: import("./player.js").Hold[]}} PlayerVideo
 * @typedef {{name: string, label: string, html: string}} SidePanel one more tab beside the steps
 */

/**
 * @param {{steps: PlayerStep[], videos: PlayerVideo[], openAt: number, panels?: SidePanel[], log?: string}} options
 *   log: what takes the videos' place in a run that has none, as HTML.
 */
export function runPlayerHtml({ steps, videos, openAt, panels = [], log = "" }) {
  const open = steps.find((s) => s.n === openAt) ?? steps[steps.length - 1];
  const shown = (open?.by && videos.some((v) => v.user === open.by) ? open.by : videos[0]?.user) ?? "";
  const multipleRoles = new Set(steps.map((s) => s.by).filter(Boolean)).size > 1;
  // When every step is at the same second, the times say nothing; leave them out.
  const showTimes = new Set(steps.filter((s) => s.at !== undefined).map((s) => clock(/** @type {number} */ (s.at)))).size > 1;
  const users =
    videos.length > 1
      ? `<div class="users" role="group" aria-label="Whose screen">${videos.map((v) => `<button type="button" data-user="${esc(v.user)}" aria-pressed="${v.user === shown}">${esc(roleName(v.user))}</button>`).join("")}</div>`
      : "";
  const screens = videos
    .map((v) => {
      const marks = steps.filter((s) => s.by === v.user && s.at !== undefined);
      const ticks = marks
        .map((s) => `<button type="button" class="tick ${tone(s)}${s.isCheck ? "" : " dot"}" data-step="${s.n}" data-at="${s.at}" aria-label="Step ${s.n}, at ${clock(/** @type {number} */ (s.at))}">${s.isCheck ? s.n : ""}</button>`)
        .join("");
      return `<div class="screen" data-user="${esc(v.user)}"${v.user === shown ? "" : " hidden"}>
        ${playerHtml({ id: `video-${esc(v.user)}`, src: v.src, label: esc(v.user), captions: v.captions, holds: v.holds })}
        ${ticks ? `<div class="track" role="group" aria-label="Steps in the video of ${esc(v.user)}">${ticks}</div>` : ""}
      </div>`;
    })
    .join("");
  // A step that is in no video shows its screenshot where the video would be.
  const shots = steps.filter((s) => s.shot).map((s) => `<div class="shot" data-step="${s.n}"${s.n === open?.n ? "" : " hidden"}>${s.shot}</div>`).join("");
  const lines = steps
    .map((s) => `<li${s.isCheck ? ' class="check"' : ""}><button type="button" class="line" data-step="${s.n}"${s.by && s.at !== undefined && videos.some((v) => v.user === s.by) ? ` data-user="${esc(s.by)}" data-at="${s.at}"` : ""}${s.n === open?.n ? ' aria-current="step"' : ""}>
        <span class="n">${s.n}</span>
        <span class="text"><span class="line-kind">${s.isCheck ? "Check" : "Action"}${multipleRoles && s.by ? ` · ${esc(roleName(s.by))}` : ""}</span>${esc(s.text)}</span>
        <span class="end"><span class="step-status ${statusTone(s)}">${esc(statusLabel(s))}</span>${showTimes && s.at !== undefined ? `<span class="how">${clock(s.at)}</span>` : ""}</span>
      </button>
      <section class="step-card" data-step="${s.n}" aria-label="Step ${s.n}"${s.n === open?.n ? "" : " hidden"}>${s.card}</section></li>`)
    .join("");
  const checks = steps.filter((s) => s.isCheck).length;
  return `<section class="run-player" aria-label="The run" data-open="${open?.n ?? ""}" id="steps">
    ${log || `<div class="rp-main">${users}${screens}${shots}</div>`}
    <aside class="steps-panel tabbed">
      ${tabs("What to show beside the run", [{ name: "steps", label: `Steps ${steps.length}` }, ...(checks && checks < steps.length ? [{ name: "checks", label: `Checks ${checks}` }] : []), ...panels.map((p) => ({ name: p.name, label: esc(p.label) }))])}
      ${panel("steps", `<ol class="rp-steps" aria-label="Every step">${lines}</ol>`)}
      ${panels.map((p) => panel(p.name, p.html, true)).join("")}
    </aside>
  </section>`;
}

/** @param {PlayerStep} step */
const tone = (step) => (!step.isCheck && step.state === "done" ? "plain" : statusTone(step));
/** @param {PlayerStep} step */
const statusTone = (step) => (step.state === "passed" || step.state === "done" ? "good" : step.state === "failed" ? "bad" : "wait");
/** @param {PlayerStep} step */
const statusLabel = (step) => LABELS[/** @type {keyof typeof LABELS} */ (step.state)] ?? (step.isCheck ? "Not checked" : "Not run");
/** A user's name as a page shows it, like Viewer. @param {string} user */
export const roleName = (user) => user.charAt(0).toUpperCase() + user.slice(1);

/** Styles for runPlayerHtml. */
export const RUN_PLAYER_CSS = `${PLAYER_CSS}
.run-player{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 27rem;grid-template-rows:minmax(0,1fr);border-top:1px solid var(--line)}
.run-player:not(:has(.rp-main>*,.rp-log)){grid-template-columns:minmax(0,1fr)}.rp-main:empty{display:none}
.rp-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:var(--s-lg);background:var(--black);color:var(--white)}
.users{flex:none;display:flex;gap:var(--s-lg);overflow-x:auto;white-space:nowrap;margin:calc(var(--s-lg)*-1) calc(var(--s-lg)*-1) var(--s-lg);padding:0 var(--s-lg);border-bottom:1px solid var(--gray-800)}
.users button{color:var(--gray-500)}.users button[aria-pressed="true"]{color:var(--white);border-bottom-color:var(--yellow-300)}
.screen,.shot{flex:1;min-height:0;display:flex;flex-direction:column}.screen[hidden],.shot[hidden]{display:none}
/* The video takes the room that is left, so its controls and marks are always on screen. */
.screen .player{flex:1;min-height:0;display:flex;flex-direction:column;margin-top:0}.screen .player video{flex:1;min-height:0;object-fit:contain}.screen .controls{flex:none}
.shot{gap:var(--s-sm)}.shot img{flex:1;min-height:0;width:100%;object-fit:contain;margin:0;border:0}
.track{position:relative;flex:none;height:var(--control);margin:var(--s-sm) var(--s-md) 0}
.track::before{content:"";position:absolute;left:calc(var(--s-md)*-1);right:calc(var(--s-md)*-1);top:50%;height:2px;background:var(--gray-800)}
.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:var(--status);height:var(--status);padding:0;border-radius:50%;font:var(--label-strong);background:var(--black);color:var(--white);border:2px solid var(--gray-500)}
.tick.dot{width:var(--s-md);height:var(--s-md)}.tick.good{background:var(--white);border-color:var(--white);color:var(--black)}
.tick.bad{background:var(--error);border-color:var(--error)}.tick.wait{background:var(--gray-700);border-color:var(--gray-700)}
.tick[aria-current="step"]{outline:2px solid var(--yellow-300);outline-offset:2px}
.steps-panel{min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--line)}
.rp-steps{list-style:none;margin:0;padding:0}.rp-steps[data-only="checks"] li:not(.check){display:none}
.rp-steps li:has(>.line[aria-current="step"]){background:var(--chalk);border-radius:var(--r-sm)}
.line{position:relative;display:grid;grid-template-columns:var(--s-lg) minmax(0,1fr) auto;column-gap:var(--s-sm);align-items:start;width:100%;min-height:var(--touch);padding:var(--s-sm);border-radius:var(--r-sm);background:none;text-align:left;font-size:var(--fs-sm);line-height:1.5}
.line:hover{background:var(--chalk)}.line[aria-current="step"]{font-weight:500}
.line .n,.line-kind,.line .end .how{color:var(--text-3);font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}
.line .n{text-align:center}.line-kind{display:block}
.line .end{display:contents}.line .end .how{grid-column:3;grid-row:1}
.step-status{grid-column:3;grid-row:2;justify-self:end;border-radius:var(--r-xs);padding:0 var(--s-sm);font:500 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em;color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line)}
/* A check that passed or failed shows a tick or a cross where its number would be. An action that was done shows only its number. */
.check .step-status.good,.step-status.bad{grid-column:1;grid-row:1;justify-self:center;margin-top:calc((1.75*var(--fs-xs) - var(--s-md))/2)}
li:not(.check) .step-status.good{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.check:has(.step-status.good) .n,li:has(.step-status.bad) .n{display:none}
.step-card{padding:0 var(--s-sm) var(--s-md) calc(var(--s-lg) + var(--s-md));font-size:var(--fs-sm);overflow-wrap:anywhere}.step-card p{margin:var(--s-xs) 0}
.step-card pre,.step-card .evidence li{background:var(--white)}
@media(max-width:54em){.run-player{grid-template-columns:minmax(0,1fr);grid-template-rows:auto}.rp-main{padding:var(--s-md)}.users{margin:calc(var(--s-md)*-1) calc(var(--s-md)*-1) var(--s-md);padding:0 var(--s-md)}.steps-panel{border-left:0}.panel{overflow:visible}.shot img,.screen .player:not(:fullscreen) video{flex:none}}`;

/** Wires the run player. Runs in the browser. */
export const RUN_PLAYER_SCRIPT = `${PLAYER_SCRIPT}
const spreadMarks = ${spreadMarks.toString()};
const root = document.querySelector(".run-player");
if (root) {
  const screens = [...root.querySelectorAll(".screen")];
  const all = (selector) => [...root.querySelectorAll(selector)];
  const showUser = (user) => {
    for (const s of screens) {
      const on = s.dataset.user === user;
      if (!on) s.querySelector(".player").stop();
      s.hidden = !on;
    }
    for (const b of all(".users button")) b.setAttribute("aria-pressed", String(b.dataset.user === user));
    place();
  };
  const pick = (n, play) => {
    for (const el of all("[data-step]")) {
      if (el.matches(".step-card, .shot")) el.hidden = el.dataset.step !== String(n);
      else if (el.dataset.step === String(n)) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    const line = root.querySelector('.line[data-step="' + n + '"]');
    if (line) line.scrollIntoView({ block: "nearest" });
    // In an agent's run, picking a step brings what the agent did for it into view.
    const mark = root.querySelector('.at-step[data-step="' + n + '"]');
    if (mark && play) mark.scrollIntoView({ block: "start", behavior: "smooth" });
    // A step with a screenshot of its own takes the videos' place.
    if (root.querySelector('.shot[data-step="' + n + '"]')) showUser("");
    else if (line && line.dataset.user) {
      showUser(line.dataset.user);
      const video = root.querySelector('.screen[data-user="' + line.dataset.user + '"] video');
      video.currentTime = Number(line.dataset.at);
      if (play) video.play().catch(() => {});
    }
    const url = new URL(location.href); url.searchParams.set("step", n); history.replaceState(null, "", url);
  };
  // Each mark's place on its video's timeline, spread so none sits on another.
  function place() {
    for (const s of screens) {
      const track = s.querySelector(".track"), video = s.querySelector("video");
      if (!track || s.hidden || !track.offsetWidth) continue;
      const ticks = [...track.querySelectorAll(".tick")];
      const marks = ticks.map((t) => ({ n: Number(t.dataset.step), seconds: Number(t.dataset.at), t }));
      const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Math.max(...marks.map((m) => m.seconds)) + 1;
      for (const m of spreadMarks(marks, length, 32 / track.offsetWidth)) m.t.style.left = (m.at * 100) + "%";
    }
  }
  for (const s of screens) s.querySelector("video").addEventListener("loadedmetadata", place);
  addEventListener("resize", place);
  root.addEventListener("click", (e) => {
    const user = e.target.closest(".users button");
    if (user) return showUser(user.dataset.user);
    const tab = e.target.closest(".tab");
    if (tab) {
      // "Checks" is the steps panel, with only its checks.
      const panel = tab.dataset.tab === "checks" ? "steps" : tab.dataset.tab;
      // Each set of tabs switches only its own panels.
      const box = tab.closest(".tabbed");
      for (const t of box.querySelectorAll(":scope > .tabs .tab")) t.setAttribute("aria-selected", String(t === tab));
      for (const p of box.querySelectorAll(":scope > .panel")) p.hidden = p.dataset.panel !== panel;
      const list = box.querySelector(".rp-steps");
      if (!list) return;
      if (tab.dataset.tab === "checks") list.dataset.only = "checks"; else delete list.dataset.only;
      return;
    }
    const kind = e.target.closest(".kind");
    if (kind) {
      for (const k of all(".kind")) k.setAttribute("aria-pressed", String(k === kind));
      const acts = root.querySelector(".acts");
      if (kind.dataset.kind) acts.dataset.only = kind.dataset.kind; else delete acts.dataset.only;
      return;
    }
    const step = e.target.closest(".line, .tick, .at-step[data-step]");
    if (step) pick(step.dataset.step, true);
  });
  root.addEventListener("keydown", (e) => {
    const line = e.target.closest(".line"); if (!line) return;
    const lines = all(".line"), next = lines[lines.indexOf(line) + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0)];
    if (!next || next === line) return;
    e.preventDefault(); next.focus(); next.click();
  });
  const asked = new URL(location.href).searchParams.get("step");
  pick(root.querySelector('.line[data-step="' + asked + '"]') ? asked : root.dataset.open, false);
}
`;
