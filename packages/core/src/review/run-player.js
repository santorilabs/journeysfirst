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
.run-player{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,36%);gap:24px;align-items:start;margin-top:16px}
.rp-main{min-width:0}
.users{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--tint);margin-bottom:8px}
.users button{background:none;color:var(--ink);padding:6px 12px;min-height:36px}
.users button[aria-pressed="true"]{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.track{position:relative;height:36px;margin:8px 14px 0}
.track::before{content:"";position:absolute;left:-14px;right:-14px;top:50%;height:2px;background:var(--rule)}
.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:28px;height:28px;padding:0;border-radius:50%;font-size:12px;font-weight:700;background:#fff;color:var(--ink);border:2px solid var(--rule)}
.tick.dot{width:12px;height:12px}.tick.good{background:var(--pass);border-color:var(--pass);color:#fff}
.tick.bad{background:var(--fail);border-color:var(--fail);color:#fff}.tick.wait{background:var(--wait);border-color:var(--wait);color:#fff}
.tick[aria-current="step"]{outline:2px solid var(--ink);outline-offset:2px}
.step-card{margin-top:8px;padding:16px;border:1px solid var(--rule);border-radius:12px;overflow-wrap:anywhere}
.step-card h2{font-size:20px;margin:4px 0 8px}.step-card p{margin:4px 0}
.steps-panel h2{font-size:17px;margin:0 0 6px}
.rp-steps{list-style:none;margin:0;padding:4px;border:1px solid var(--rule);border-radius:12px}
.line{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:start;width:100%;text-align:left;background:none;color:var(--ink);border-radius:8px;border-left:3px solid transparent;padding:8px;font-size:14px;min-height:44px}
.line:hover{background:var(--tint)}.line[aria-current="step"]{background:var(--tint);border-left-color:var(--ink)}
.line[aria-current="step"]:has(.bad){background:#fff1f5;border-left-color:var(--fail)}
.line .n{color:var(--muted);font-size:13px;padding-top:2px}.line[aria-current="step"] .n{color:var(--ink);font-weight:700}
.line-kind{display:block;color:var(--muted);font-size:12px;font-weight:600}
.line .end{display:grid;justify-items:end;gap:2px}
.step-status{border-radius:4px;padding:2px 6px;font-size:12px;font-weight:600;color:var(--wait);background:var(--tint)}
.step-status.good{color:var(--pass);background:#e8f6ec}.step-status.bad{color:var(--fail);background:#fdebef}
@media(max-width:800px){.run-player{grid-template-columns:1fr}}`;

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
