// The video player on the review page. Its controls sit under the video, never
// over it, so they never hide the caption bar a paced journey video shows.
// Each video also has its lines as a captions track. The player shows the line
// in progress under the video, and the CC button turns that on and off.
// A paced video waited after each line while it recorded and shows its own
// caption bar, so its captions are off at first. Any other video recorded with
// no waiting: its captions are on, and the player holds at the end of each line
// for as long as a paced run waits there. On the screen of the user who did the
// line, the hold shows the line's screenshot, which is exactly how the line ended.
import { esc } from "../shared/display.js";

/**
 * Where the player stops a video that recorded with no waiting.
 * @typedef {{at: number, ms: number, shot?: string}} Hold at: seconds into the video. ms: how long to stay.
 *   shot: the address of the screenshot to show meanwhile.
 */

/**
 * One player: the video, the line in progress, then its controls in a row under it.
 * @param {{id: string, src: string, label: string, captions?: string, holds?: Hold[]}} video id: the video element's id.
 *   captions: the address of its WebVTT track. holds: set for a video that recorded with no waiting.
 */
export function playerHtml({ id, src, label, captions, holds }) {
  return `<div class="player"${holds ? ` data-holds="${esc(JSON.stringify(holds))}"` : ""}>
    <video id="${id}" src="${src}" preload="metadata" playsinline>${captions ? `<track kind="captions" src="${captions}" srclang="en" label="Steps">` : ""}</video>
    ${holds ? '<img class="still" alt="" hidden>' : ""}
    ${captions ? `<p class="caption"${holds ? "" : " hidden"}></p>` : ""}
    <div class="controls">
      <button type="button" class="play" aria-label="Play">▶</button>
      <input type="range" class="seek" min="0" max="1000" value="0" step="1" aria-label="Position in ${label}'s video">
      <span class="time">0:00 / 0:00</span>
      <select class="speed" aria-label="Speed">${SPEEDS.map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}x</option>`).join("")}</select>
      ${captions ? `<button type="button" class="cc" aria-label="${holds ? "Hide" : "Show"} captions" aria-pressed="${Boolean(holds)}">CC</button>` : ""}
      <button type="button" class="full" aria-label="Full screen">⛶</button>
    </div>
  </div>`;
}

const SPEEDS = [0.5, 1, 1.5, 2];

/** Styles for playerHtml. */
export const PLAYER_CSS = `.player{position:relative;background:var(--black);border-radius:var(--r-md);overflow:hidden;margin-top:var(--s-sm)}
.player video{display:block;width:100%;border:0;border-radius:0;margin:0;background:var(--black);cursor:pointer}
.player .still{position:absolute;top:0;left:0;margin:0;border:0;border-radius:0;object-fit:contain;background:var(--black);cursor:pointer}.player .still[hidden]{display:none}
.caption{flex:none;margin:0;padding:var(--s-sm) var(--s-md);min-height:calc(3em + 2*var(--s-sm));background:var(--black);color:var(--white);font:500 var(--fs-sm)/1.5 var(--body)}
.player:fullscreen{display:flex;flex-direction:column;justify-content:center;border-radius:0}.player:fullscreen video{flex:1;min-height:0;object-fit:contain}
.controls{display:flex;align-items:center;gap:var(--s-sm);padding:var(--s-sm) var(--s-md);background:var(--black);color:var(--white);font:400 var(--fs-xs)/1 var(--mono)}
.controls button,.controls select{flex:none;height:var(--control-sm);border-radius:var(--r-full);background:none;color:var(--white);box-shadow:inset 0 0 0 1px var(--gray-800)}
.controls button{width:var(--control-sm);padding:0;font-size:var(--fs-sm)}
.controls .seek{flex:1;min-width:var(--control);accent-color:var(--yellow-300)}
.controls .time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.controls .cc{font-size:var(--fs-xs);font-weight:500}.controls .play,.controls .cc[aria-pressed="true"]{background:var(--yellow-300);color:var(--black);box-shadow:none}
.controls select{font:inherit;border:0;padding:0 var(--s-sm)}`;

/** Wires every player on the page. Runs in the browser. */
export const PLAYER_SCRIPT = `
const clock = (s) => Number.isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
for (const player of document.querySelectorAll(".player")) {
  const video = player.querySelector("video"), play = player.querySelector(".play"), seek = player.querySelector(".seek");
  const time = player.querySelector(".time"), still = player.querySelector(".still"), caption = player.querySelector(".caption");
  const holds = JSON.parse(player.dataset.holds || "[]");
  // held: the timer of the hold in progress. last: where the video was when last looked at.
  // placing: the player is moving the video to a hold's exact place, which is not a jump by the viewer.
  let held = 0, last = 0, placing = false;
  const stopped = () => video.paused && !held;
  const show = () => {
    play.textContent = stopped() ? "▶" : "❚❚"; play.setAttribute("aria-label", stopped() ? "Play" : "Pause");
    if (Number.isFinite(video.duration) && video.duration > 0) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    time.textContent = clock(video.currentTime) + " / " + clock(video.duration);
  };
  const release = () => { clearTimeout(held); held = 0; if (still) still.hidden = true; };
  // While the video plays, stop at each hold it reaches, then play on. The video is looked at once
  // a frame, so it stops a little before the hold and goes to the hold's exact place. Stopping
  // after it could show the next line's caption for a frame.
  const watch = () => {
    // A jump in progress is the viewer's: it is not a hold the video played into. Look again once it lands.
    if (video.seeking) return void requestAnimationFrame(watch);
    const now = video.currentTime, hold = holds.find((h) => last < h.at && h.at <= now + 0.05 * video.playbackRate);
    last = hold ? hold.at : now;
    if (hold) {
      video.pause();
      placing = true; video.currentTime = hold.at;
      if (hold.shot) { still.src = hold.shot; still.hidden = false; }
      held = setTimeout(() => { release(); video.play().catch(() => {}); }, hold.ms / video.playbackRate);
    } else if (!video.paused) requestAnimationFrame(watch);
  };
  video.addEventListener("play", watch);
  // A jump to another place ends the hold and plays from there. A hold at or before that place is not made.
  video.addEventListener("seeking", () => {
    if (placing) return void (placing = false);
    const was = held; release(); last = video.currentTime; if (was) video.play().catch(() => {});
  });
  player.stop = () => { release(); video.pause(); show(); };
  const toggle = () => (stopped() ? video.play() : player.stop());
  for (const el of [play, video, still]) if (el) el.addEventListener("click", toggle);
  if (still) new ResizeObserver(() => { still.style.width = video.offsetWidth + "px"; still.style.height = video.offsetHeight + "px"; }).observe(video);
  for (const event of ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "seeked"]) video.addEventListener(event, show);
  seek.addEventListener("input", () => { if (Number.isFinite(video.duration)) video.currentTime = (Number(seek.value) / 1000) * video.duration; });
  player.querySelector(".speed").addEventListener("change", (e) => { video.playbackRate = Number(e.target.value); });
  const cc = player.querySelector(".cc");
  if (cc) {
    // Hidden, not off: the track still says which line is in progress, and the player shows it under the video.
    const track = video.textTracks[0];
    track.mode = "hidden";
    track.addEventListener("cuechange", () => { const cue = track.activeCues[track.activeCues.length - 1]; caption.replaceChildren(cue ? cue.getCueAsHTML() : ""); });
    cc.addEventListener("click", () => {
      caption.hidden = !caption.hidden;
      cc.setAttribute("aria-pressed", String(!caption.hidden)); cc.setAttribute("aria-label", caption.hidden ? "Show captions" : "Hide captions");
    });
  }
  player.querySelector(".full").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen()));
}
`;
