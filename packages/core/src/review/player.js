// The video player on the review page. Its controls sit under the video, never
// over it, so they never hide the caption bar a journey video shows.
// Each video also has its lines as a captions track. It is off at first:
// most videos already show the caption bar, and two sets of captions would overlap.
// The CC button turns it on, for a video recorded without the bar.

/**
 * One player: the video, then its controls in a row under it.
 * @param {{id: string, src: string, label: string, captions?: string}} video id: the video element's id.
 *   captions: the address of its WebVTT track.
 */
export function playerHtml({ id, src, label, captions }) {
  return `<div class="player">
    <video id="${id}" src="${src}" preload="metadata" playsinline>${captions ? `<track kind="captions" src="${captions}" srclang="en" label="Steps">` : ""}</video>
    <div class="controls">
      <button type="button" class="play" aria-label="Play">▶</button>
      <input type="range" class="seek" min="0" max="1000" value="0" step="1" aria-label="Position in ${label}'s video">
      <span class="time">0:00 / 0:00</span>
      <select class="speed" aria-label="Speed">${SPEEDS.map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}x</option>`).join("")}</select>
      ${captions ? '<button type="button" class="cc" aria-label="Show captions" aria-pressed="false">CC</button>' : ""}
      <button type="button" class="full" aria-label="Full screen">⛶</button>
    </div>
  </div>`;
}

const SPEEDS = [0.5, 1, 1.5, 2];

/** Styles for playerHtml. */
export const PLAYER_CSS = `.player{background:#000;border-radius:12px;overflow:hidden;margin-top:8px}
.player video{display:block;width:100%;border:0;border-radius:0;margin:0;background:#000;cursor:pointer}
.player:fullscreen{display:flex;flex-direction:column;justify-content:center;border-radius:0}.player:fullscreen video{flex:1;min-height:0;object-fit:contain}
.controls{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#141516;color:#fff;font-size:13px}
.controls button{flex:none;width:32px;height:32px;padding:0;border-radius:6px;background:#2a2b2d;font-size:14px}
.controls .seek{flex:1;min-width:40px;accent-color:#f5c542}
.controls .time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.controls .cc{font-size:11px;font-weight:700}.controls .cc[aria-pressed="true"]{background:#f5c542;color:#000}
.controls select{flex:none;font:inherit;background:#2a2b2d;color:#fff;border:0;border-radius:6px;height:32px;padding:0 4px}`;

/** Wires every player on the page. Runs in the browser. */
export const PLAYER_SCRIPT = `
const clock = (s) => Number.isFinite(s) ? Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") : "0:00";
for (const player of document.querySelectorAll(".player")) {
  const video = player.querySelector("video"), play = player.querySelector(".play"), seek = player.querySelector(".seek");
  const time = player.querySelector(".time");
  const show = () => {
    play.textContent = video.paused ? "▶" : "❚❚"; play.setAttribute("aria-label", video.paused ? "Play" : "Pause");
    if (Number.isFinite(video.duration) && video.duration > 0) seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    time.textContent = clock(video.currentTime) + " / " + clock(video.duration);
  };
  const toggle = () => (video.paused ? video.play() : video.pause());
  play.addEventListener("click", toggle);
  video.addEventListener("click", toggle);
  for (const event of ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "seeked"]) video.addEventListener(event, show);
  seek.addEventListener("input", () => { if (Number.isFinite(video.duration)) video.currentTime = (Number(seek.value) / 1000) * video.duration; });
  player.querySelector(".speed").addEventListener("change", (e) => { video.playbackRate = Number(e.target.value); });
  const cc = player.querySelector(".cc");
  if (cc) cc.addEventListener("click", () => {
    const track = video.textTracks[0], on = track.mode !== "showing";
    track.mode = on ? "showing" : "hidden";
    cc.setAttribute("aria-pressed", String(on)); cc.setAttribute("aria-label", on ? "Hide captions" : "Show captions");
  });
  player.querySelector(".full").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen()));
}
`;
