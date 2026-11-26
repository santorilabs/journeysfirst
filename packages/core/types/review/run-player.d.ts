export type PlayerStep = {
    n: number;
    text: string;
    isCheck: boolean;
    state?: string;
    by?: string;
    at?: number;
    card: string;
    shot?: string;
};
export type PlayerVideo = {
    user: string;
    src: string;
    captions?: string;
};
export type SidePanel = {
    name: string;
    label: string;
    html: string;
};
/**
 * One step as the player shows it.
 * @typedef {{n: number, text: string, isCheck: boolean, state?: string, by?: string,
 *   at?: number, card: string, shot?: string}} PlayerStep at: seconds into the video of `by`. card: the step's details, as HTML.
 *   shot: the step's screenshots, as HTML, when the step is in no video.
 * @typedef {{user: string, src: string, captions?: string}} PlayerVideo
 * @typedef {{name: string, label: string, html: string}} SidePanel one more tab beside the steps
 */
/**
 * @param {{steps: PlayerStep[], videos: PlayerVideo[], openAt: number, panels?: SidePanel[]}} options
 */
export declare function runPlayerHtml({ steps, videos, openAt, panels }: {
    steps: PlayerStep[];
    videos: PlayerVideo[];
    openAt: number;
    panels?: SidePanel[];
}): string;
/** Styles for runPlayerHtml. */
export declare const RUN_PLAYER_CSS = ".player{background:var(--black);border-radius:var(--r-md);overflow:hidden;margin-top:var(--s-sm)}\n.player video{display:block;width:100%;border:0;border-radius:0;margin:0;background:var(--black);cursor:pointer}\n.player:fullscreen{display:flex;flex-direction:column;justify-content:center;border-radius:0}.player:fullscreen video{flex:1;min-height:0;object-fit:contain}\n.controls{display:flex;align-items:center;gap:var(--s-sm);padding:var(--s-sm) var(--s-md);background:var(--black);color:var(--white);font:400 var(--fs-xs)/1 var(--mono)}\n.controls button,.controls select{flex:none;height:var(--control-sm);border-radius:var(--r-full);background:none;color:var(--white);box-shadow:inset 0 0 0 1px var(--gray-800)}\n.controls button{width:var(--control-sm);padding:0;font-size:var(--fs-sm)}\n.controls .seek{flex:1;min-width:var(--control);accent-color:var(--yellow-300)}\n.controls .time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}\n.controls .cc{font-size:var(--fs-xs);font-weight:500}.controls .play,.controls .cc[aria-pressed=\"true\"]{background:var(--yellow-300);color:var(--black);box-shadow:none}\n.controls select{font:inherit;border:0;padding:0 var(--s-sm)}\n.run-player{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 27rem;grid-template-rows:minmax(0,1fr);border-top:1px solid var(--line)}\n.run-player:not(:has(.rp-main>*)){grid-template-columns:minmax(0,1fr)}.rp-main:empty{display:none}\n.rp-main{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:var(--s-lg);background:var(--black);color:var(--white)}\n.users{display:flex;gap:var(--s-lg);margin:calc(var(--s-lg)*-1) calc(var(--s-lg)*-1) var(--s-lg);padding:0 var(--s-lg);border-bottom:1px solid var(--gray-800)}\n.users button,.tab{height:var(--tab);padding:0;background:none;border-bottom:2px solid transparent;font:400 var(--fs-xs)/1 var(--mono);letter-spacing:.01em}\n.users button{color:var(--gray-500)}.users button[aria-pressed=\"true\"]{color:var(--white);border-bottom-color:var(--yellow-300)}\n.screen,.shot{flex:1;min-height:0;display:flex;flex-direction:column}.screen[hidden],.shot[hidden]{display:none}\n.shot{gap:var(--s-sm)}.shot img{flex:1;min-height:0;width:100%;object-fit:contain;margin:0;border:0}\n.track{position:relative;flex:none;height:var(--control);margin:var(--s-sm) var(--s-md) 0}\n.track::before{content:\"\";position:absolute;left:calc(var(--s-md)*-1);right:calc(var(--s-md)*-1);top:50%;height:2px;background:var(--gray-800)}\n.tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:var(--status);height:var(--status);padding:0;border-radius:50%;font:500 var(--fs-xs)/1 var(--mono);background:var(--black);color:var(--white);border:2px solid var(--gray-500)}\n.tick.dot{width:var(--s-md);height:var(--s-md)}.tick.good{background:var(--white);border-color:var(--white);color:var(--black)}\n.tick.bad{background:var(--error);border-color:var(--error)}.tick.wait{background:var(--gray-700);border-color:var(--gray-700)}\n.tick[aria-current=\"step\"]{outline:2px solid var(--yellow-300);outline-offset:2px}\n.steps-panel{min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--line)}\n.tabs{flex:none;display:flex;gap:var(--s-lg);padding:0 var(--s-md);border-bottom:1px solid var(--line);overflow-x:auto}\n.tab{flex:none;color:var(--text-3)}.tab[aria-selected=\"true\"]{color:var(--text);border-bottom-color:var(--black)}\n.panel{flex:1;min-height:0;overflow-y:auto;padding:var(--s-sm)}.panel[hidden]{display:none}\n.rp-steps{list-style:none;margin:0;padding:0}.rp-steps[data-only=\"checks\"] li:not(.check){display:none}\n.rp-steps li:has(>.line[aria-current=\"step\"]){background:var(--chalk);border-radius:var(--r-sm)}\n.line{position:relative;display:grid;grid-template-columns:var(--s-lg) minmax(0,1fr) auto;column-gap:var(--s-sm);align-items:start;width:100%;min-height:var(--touch);padding:var(--s-sm);border-radius:var(--r-sm);background:none;text-align:left;font-size:var(--fs-sm);line-height:1.5}\n.line:hover{background:var(--chalk)}.line[aria-current=\"step\"]{font-weight:500}\n.line .n,.line-kind,.line .end .how{color:var(--text-3);font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}\n.line .n{text-align:center}.line-kind{display:block}\n.line .end{display:contents}.line .end .how{grid-column:3;grid-row:1}\n.step-status{grid-column:3;grid-row:2;justify-self:end;border-radius:var(--r-xs);padding:0 var(--s-sm);font:500 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em;color:var(--text-2);box-shadow:inset 0 0 0 1px var(--line)}\n/* A check that passed or failed shows a tick or a cross where its number would be. An action that was done shows only its number. */\n.check .step-status.good,.step-status.bad{grid-column:1;grid-row:1;justify-self:center;width:var(--s-md);height:var(--s-md);margin-top:calc((1.75*var(--fs-xs) - var(--s-md))/2);padding:0;overflow:hidden;color:transparent;box-shadow:none;background:var(--text);-webkit-mask:var(--tick) center/contain no-repeat;mask:var(--tick) center/contain no-repeat}\n.step-status.bad{background:var(--error);-webkit-mask-image:var(--cross);mask-image:var(--cross)}\nli:not(.check) .step-status.good{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}\n.check:has(.step-status.good) .n,li:has(.step-status.bad) .n{display:none}\n.step-card{padding:0 var(--s-sm) var(--s-md) calc(var(--s-lg) + var(--s-md));font-size:var(--fs-sm);overflow-wrap:anywhere}.step-card p{margin:var(--s-xs) 0}\n.step-card pre,.step-card .evidence li{background:var(--white)}\n@media(max-width:54em){.run-player{grid-template-columns:minmax(0,1fr);grid-template-rows:auto}.rp-main{padding:var(--s-md)}.users{margin:calc(var(--s-md)*-1) calc(var(--s-md)*-1) var(--s-md);padding:0 var(--s-md)}.steps-panel{border-left:0}.panel{overflow:visible}.shot img{flex:none}}";
/** Wires the run player. Runs in the browser. */
export declare const RUN_PLAYER_SCRIPT: string;
