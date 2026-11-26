// The run player on the review page: one user's video at a time, with a
// switch between the users in the run. Under the video, each of that
// user's steps is a mark on the timeline: a check is a numbered mark in its
// verdict's color, any other step a small dot. Beside it on a wide screen
// (under it on a phone), every step in order. Picking a step or a mark shows
// that user's video and plays it from there. Under the video, the current
// step: what it says, how it went and how it was checked. The page opens on
// the first failure, or on ?step=<n>.
import { clock, esc, LABELS, spreadMarks } from "../shared/display.js";
import { PLAYER_CSS, PLAYER_SCRIPT, playerHtml } from "./player.js";

/**
 * One step as the player shows it.
 * @typedef {{n: number, text: string, isCheck: boolean, state?: string, by?: string,
 *   at?: number, card: string}} PlayerStep at: seconds into the video of `by`. card: the step's details, as HTML.
 * @typedef {{user: string, src: string, captions?: string}} PlayerVideo
 */

/**
 * @param {{steps: PlayerStep[], videos: PlayerVideo[], openAt: number}} options
 */
export function runPlayerHtml({ steps, videos, openAt }) {
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
        ${playerHtml({ id: `video-${esc(v.user)}`, src: v.src, label: esc(v.user), captions: v.captions })}
        ${ticks ? `<div class="track" role="group" aria-label="Steps in the video of ${esc(v.user)}">${ticks}</div>` : ""}
      </div>`;
    })
    .join("");
  const cards = steps
    .map((s) => `<section class="step-card" data-step="${s.n}" aria-label="Step ${s.n}"${s.n === open?.n ? "" : " hidden"}>
        <p class="how"><span aria-live="polite">Step ${s.n} of ${steps.length}</span>${multipleRoles && s.by ? ` · ${esc(roleName(s.by))}` : ""}</p>
        <h2>${s.isCheck ? '<span class="how">Check:</span> ' : ""}${esc(s.text)}</h2>
        ${s.card}
      </section>`)
    .join("");
  const lines = steps
    .map((s) => `<li><button type="button" class="line" data-step="${s.n}"${s.by && s.at !== undefined && videos.some((v) => v.user === s.by) ? ` data-user="${esc(s.by)}" data-at="${s.at}"` : ""}${s.n === open?.n ? ' aria-current="step"' : ""}>
        <span class="n">${s.n}</span>
        <span class="text"><span class="line-kind">${s.isCheck ? "Check" : "Action"}${multipleRoles && s.by ? ` · ${esc(roleName(s.by))}` : ""}</span>${esc(s.text)}</span>
        <span class="end"><span class="step-status ${statusTone(s)}">${esc(statusLabel(s))}</span>${showTimes && s.at !== undefined ? `<span class="how">${clock(s.at)}</span>` : ""}</span>
      </button></li>`)
    .join("");
  return `<section class="run-player" aria-label="The run" data-open="${open?.n ?? ""}" id="steps">
    <div class="rp-main">${users}${screens}${cards}</div>
    <aside class="steps-panel"><h2>Steps</h2><ol class="rp-steps" aria-label="Every step">${lines}</ol></aside>
  </section>`;
}

/** @param {PlayerStep} step */
const tone = (step) => (!step.isCheck && step.state === "done" ? "plain" : statusTone(step));
/** @param {PlayerStep} step */
const statusTone = (step) => (step.state === "passed" || step.state === "done" ? "good" : step.state === "failed" ? "bad" : "wait");
/** @param {PlayerStep} step */
const statusLabel = (step) => LABELS[/** @type {keyof typeof LABELS} */ (step.state)] ?? (step.isCheck ? "Not checked" : "Not run");
/** @param {string} user */
const roleName = (user) => user.charAt(0).toUpperCase() + user.slice(1);

/** Styles for runPlayerHtml. */
export const RUN_PLAYER_CSS = `${PLAYER_CSS}
.run-player{display:grid;grid-template-columns:minmax(0,1fr) minmax(20rem,36%);gap:var(--s-lg);align-items:start;margin-top:var(--s-md)}
.rp-main{min-width:0}
.users{display:inline-flex;gap:var(--s-xs);padding:var(--s-xs);border-radius:var(--r-full);background:var(--line);margin-bottom:var(--s-sm)}
.users button{background:none;height:var(--control);padding:0 var(--s-md);border-radius:var(--r-full);font-size:var(--fs-sm)}
.users button[aria-pressed="true"]{background:var(--white);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.track{position:relative;height:var(--control);margin:var(--s-sm) var(--s-md) 0}
.track::before{content:"";position:absolute;left:calc(var(--s-md)*-1);right:calc(var(--s-md)*-1);top:50%;height:2px;background:var(--line)}
.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:var(--status);height:var(--status);padding:0;border-radius:50%;font:500 var(--fs-xs)/1 var(--mono);background:var(--white);border:2px solid var(--line)}
.tick.dot{width:var(--s-md);height:var(--s-md)}.tick.good{background:var(--black);border-color:var(--black);color:var(--white)}
.tick.bad{background:var(--error);border-color:var(--error);color:var(--white)}.tick.wait{background:var(--gray-700);border-color:var(--gray-700);color:var(--white)}
.tick[aria-current="step"]{outline:2px solid var(--black);outline-offset:2px}
.step-card{margin-top:var(--s-sm);padding:var(--s-md);border:1px solid var(--line);border-radius:var(--r-md);overflow-wrap:anywhere}
.step-card h2{font:500 var(--fs-xl)/1.5 var(--body);margin:var(--s-xs) 0 var(--s-sm)}.step-card p{margin:var(--s-xs) 0}
.steps-panel h2{font:500 var(--fs-lg)/1.4 var(--body);margin:0 0 var(--s-sm)}
.rp-steps{list-style:none;margin:0;padding:var(--s-xs);border:1px solid var(--line);border-radius:var(--r-md)}
.line{display:grid;grid-template-columns:var(--s-lg) minmax(0,1fr) auto;gap:var(--s-sm);align-items:start;width:100%;min-height:var(--touch);padding:var(--s-sm);border-radius:var(--r-sm);background:none;text-align:left;font-size:var(--fs-sm);line-height:1.5}
.line:hover,.line[aria-current="step"]{background:var(--chalk)}
.line[aria-current="step"]:has(.bad){background:var(--red-50)}
.line .n,.line-kind{color:var(--text-3);font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}.line[aria-current="step"] .n{color:var(--text);font-weight:500}
.line-kind{display:block}
.line .end{display:grid;justify-items:end;gap:var(--s-xs)}
.step-status{border-radius:var(--r-xs);padding:0 var(--s-sm);font:500 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em;color:var(--text-2);background:var(--chalk)}
.step-status.good{color:var(--text);background:none;box-shadow:inset 0 0 0 1px var(--line)}.step-status.bad{color:var(--white);background:var(--error)}
@media(max-width:54em){.run-player{grid-template-columns:1fr}}`;

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
      if (!on) s.querySelector("video").pause();
      s.hidden = !on;
    }
    for (const b of all(".users button")) b.setAttribute("aria-pressed", String(b.dataset.user === user));
    place();
  };
  const pick = (n, play) => {
    for (const el of all("[data-step]")) {
      if (el.classList.contains("step-card")) el.hidden = el.dataset.step !== String(n);
      else if (el.dataset.step === String(n)) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    }
    const line = root.querySelector('.line[data-step="' + n + '"]');
    if (line && line.dataset.user) {
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
    const step = e.target.closest(".line, .tick");
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
