export type PlayerStep = {
    n: number;
    text: string;
    isCheck: boolean;
    state?: string;
    by?: string;
    at?: number;
    card: string;
};
export type PlayerVideo = {
    user: string;
    src: string;
    captions?: string;
};
/**
 * One step as the player shows it.
 * @typedef {{n: number, text: string, isCheck: boolean, state?: string, by?: string,
 *   at?: number, card: string}} PlayerStep at: seconds into the video of `by`. card: the step's details, as HTML.
 * @typedef {{user: string, src: string, captions?: string}} PlayerVideo
 */
/**
 * @param {{steps: PlayerStep[], videos: PlayerVideo[], openAt: number}} options
 */
export declare function runPlayerHtml({ steps, videos, openAt }: {
    steps: PlayerStep[];
    videos: PlayerVideo[];
    openAt: number;
}): string;
/** Styles for runPlayerHtml. */
export declare const RUN_PLAYER_CSS = ".player{background:#000;border-radius:12px;overflow:hidden;margin-top:8px}\n.player video{display:block;width:100%;border:0;border-radius:0;margin:0;background:#000;cursor:pointer}\n.player:fullscreen{display:flex;flex-direction:column;justify-content:center;border-radius:0}.player:fullscreen video{flex:1;min-height:0;object-fit:contain}\n.controls{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#141516;color:#fff;font-size:13px}\n.controls button{flex:none;width:32px;height:32px;padding:0;border-radius:6px;background:#2a2b2d;font-size:14px}\n.controls .seek{flex:1;min-width:40px;accent-color:#f5c542}\n.controls .time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}\n.controls .cc{font-size:11px;font-weight:700}.controls .cc[aria-pressed=\"true\"]{background:#f5c542;color:#000}\n.controls select{flex:none;font:inherit;background:#2a2b2d;color:#fff;border:0;border-radius:6px;height:32px;padding:0 4px}\n.run-player{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start;margin-top:24px}\n.rp-main{min-width:0}\n.users{display:inline-flex;gap:4px;padding:4px;border-radius:999px;background:var(--tint);margin-bottom:8px}\n.users button{display:inline-flex;align-items:center;gap:6px;background:none;color:var(--ink);padding:6px 12px 6px 6px;min-height:36px}\n.users button[aria-pressed=\"true\"]{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.15)}\n.badge{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--ink);color:#fff;font-size:11px;font-weight:700;flex:none}\n.track{position:relative;height:36px;margin:8px 14px 0}\n.track::before{content:\"\";position:absolute;left:-14px;right:-14px;top:50%;height:2px;background:var(--rule)}\n.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:28px;height:28px;padding:0;border-radius:50%;font-size:12px;font-weight:700;background:#fff;color:var(--ink);border:2px solid var(--rule)}\n.tick.dot{width:12px;height:12px}.tick.good{background:var(--pass);border-color:var(--pass);color:#fff}\n.tick.bad{background:var(--fail);border-color:var(--fail);color:#fff}.tick.wait{background:var(--wait);border-color:var(--wait);color:#fff}\n.tick[aria-current=\"step\"]{outline:2px solid var(--ink);outline-offset:2px}\n.step-card{margin-top:16px;padding:16px;border:1px solid var(--rule);border-radius:12px}\n.step-card h2{font-size:20px;margin:4px 0 8px}.step-card p{margin:4px 0}\n.rp-steps{list-style:none;margin:0;padding:4px;border:1px solid var(--rule);border-radius:12px}\n.line{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:start;width:100%;text-align:left;background:none;color:var(--ink);border-radius:8px;padding:10px 8px;font-size:15px;min-height:44px}\n.line:hover{background:var(--tint)}.line[aria-current=\"step\"]{background:var(--tint)}\n.line .n{color:var(--muted);font-size:13px;padding-top:2px}.line[aria-current=\"step\"] .n{color:var(--ink);font-weight:700}\n.line .end{display:inline-flex;gap:6px;align-items:center}\n.mark{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:var(--wait)}\n.mark.good{background:var(--pass)}.mark.bad{background:var(--fail)}\n@media(max-width:800px){.run-player{grid-template-columns:1fr}}";
/** Wires the run player. Runs in the browser. */
export declare const RUN_PLAYER_SCRIPT: string;
