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
export declare const RUN_PLAYER_CSS = ".player{background:var(--black);border-radius:var(--r-md);overflow:hidden;margin-top:var(--s-sm)}\n.player video{display:block;width:100%;border:0;border-radius:0;margin:0;background:var(--black);cursor:pointer}\n.player:fullscreen{display:flex;flex-direction:column;justify-content:center;border-radius:0}.player:fullscreen video{flex:1;min-height:0;object-fit:contain}\n.controls{display:flex;align-items:center;gap:var(--s-sm);padding:var(--s-sm) var(--s-md);background:var(--black);color:var(--white);font:400 var(--fs-xs)/1 var(--mono)}\n.controls button,.controls select{flex:none;height:var(--control-sm);border-radius:var(--r-full);background:none;color:var(--white);box-shadow:inset 0 0 0 1px var(--gray-800)}\n.controls button{width:var(--control-sm);padding:0;font-size:var(--fs-sm)}\n.controls .seek{flex:1;min-width:var(--control);accent-color:var(--yellow-300)}\n.controls .time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}\n.controls .cc{font-size:var(--fs-xs);font-weight:500}.controls .play,.controls .cc[aria-pressed=\"true\"]{background:var(--yellow-300);color:var(--black);box-shadow:none}\n.controls select{font:inherit;border:0;padding:0 var(--s-sm)}\n.run-player{display:grid;grid-template-columns:minmax(0,1fr) minmax(20rem,36%);gap:var(--s-lg);align-items:start;margin-top:var(--s-md)}\n.rp-main{min-width:0}\n.users{display:inline-flex;gap:var(--s-xs);padding:var(--s-xs);border-radius:var(--r-full);background:var(--line);margin-bottom:var(--s-sm)}\n.users button{background:none;height:var(--control);padding:0 var(--s-md);border-radius:var(--r-full);font-size:var(--fs-sm)}\n.users button[aria-pressed=\"true\"]{background:var(--white);box-shadow:0 1px 2px rgba(0,0,0,.04)}\n.track{position:relative;height:var(--control);margin:var(--s-sm) var(--s-md) 0}\n.track::before{content:\"\";position:absolute;left:calc(var(--s-md)*-1);right:calc(var(--s-md)*-1);top:50%;height:2px;background:var(--line)}\n.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:var(--status);height:var(--status);padding:0;border-radius:50%;font:500 var(--fs-xs)/1 var(--mono);background:var(--white);border:2px solid var(--line)}\n.tick.dot{width:var(--s-md);height:var(--s-md)}.tick.good{background:var(--black);border-color:var(--black);color:var(--white)}\n.tick.bad{background:var(--error);border-color:var(--error);color:var(--white)}.tick.wait{background:var(--gray-700);border-color:var(--gray-700);color:var(--white)}\n.tick[aria-current=\"step\"]{outline:2px solid var(--black);outline-offset:2px}\n.step-card{margin-top:var(--s-sm);padding:var(--s-md);border:1px solid var(--line);border-radius:var(--r-md);overflow-wrap:anywhere}\n.step-card h2{font:500 var(--fs-xl)/1.5 var(--body);margin:var(--s-xs) 0 var(--s-sm)}.step-card p{margin:var(--s-xs) 0}\n.steps-panel h2{font:500 var(--fs-lg)/1.4 var(--body);margin:0 0 var(--s-sm)}\n.rp-steps{list-style:none;margin:0;padding:var(--s-xs);border:1px solid var(--line);border-radius:var(--r-md)}\n.line{display:grid;grid-template-columns:var(--s-lg) minmax(0,1fr) auto;gap:var(--s-sm);align-items:start;width:100%;min-height:var(--touch);padding:var(--s-sm);border-radius:var(--r-sm);background:none;text-align:left;font-size:var(--fs-sm);line-height:1.5}\n.line:hover,.line[aria-current=\"step\"]{background:var(--chalk)}\n.line[aria-current=\"step\"]:has(.bad){background:var(--red-50)}\n.line .n,.line-kind{color:var(--text-3);font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}.line[aria-current=\"step\"] .n{color:var(--text);font-weight:500}\n.line-kind{display:block}\n.line .end{display:grid;justify-items:end;gap:var(--s-xs)}\n.step-status{border-radius:var(--r-xs);padding:0 var(--s-sm);font:500 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em;color:var(--text-2);background:var(--chalk)}\n.step-status.good{color:var(--text);background:none;box-shadow:inset 0 0 0 1px var(--line)}.step-status.bad{color:var(--white);background:var(--error)}\n@media(max-width:54em){.run-player{grid-template-columns:1fr}}";
/** Wires the run player. Runs in the browser. */
export declare const RUN_PLAYER_SCRIPT: string;
