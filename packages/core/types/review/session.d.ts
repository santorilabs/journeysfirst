export type SessionItem = {
    kind: "said" | "command" | "call";
    name: string;
    where?: string;
    ok: boolean;
    at?: number;
    ms?: number;
    note?: string;
    parts: Array<{
        label: string;
        text: string;
    }>;
    step?: number;
};
export type StepLike = {
    says?: unknown;
    check?: unknown;
    id?: unknown;
};
/**
 * One thing the agent did.
 * @typedef {{kind: "said" | "command" | "call", name: string, where?: string, ok: boolean, at?: number, ms?: number,
 *   note?: string, parts: Array<{label: string, text: string}>, step?: number}} SessionItem
 *   name: the command, the tool, or what was said. where: the tool's server. at: seconds into the run.
 *   note: a short fact for the row's end, like "exit 1". step: the step this row ended, when it recorded one.
 * @typedef {{says?: unknown, check?: unknown, id?: unknown}} StepLike
 */
/**
 * The run's saved session, when it has one that can be read.
 * @param {{media?: unknown, started_at?: unknown, steps?: unknown}} run
 * @param {string} folder
 * @returns {{file: string, items: SessionItem[], truncated: boolean} | null}
 */
export declare function readSession(run: {
    media?: unknown;
    started_at?: unknown;
    steps?: unknown;
}, folder: string): {
    file: string;
    items: SessionItem[];
    truncated: boolean;
} | null;
/**
 * The rows in a session file. Reads both forms Codex saves: its session
 * record (each line has a time) and the events it prints (no times).
 * @param {string} text one JSON object per line
 * @param {string} [startedAt] when the run started, to say how far in each row is
 * @param {StepLike[]} [steps] the run's steps, to find where each one ended
 * @returns {SessionItem[]}
 */
export declare function sessionItems(text: string, startedAt?: string, steps?: StepLike[]): SessionItem[];
/**
 * What an agent's run recorded, as tabs: its session first, then each file it kept.
 * @param {{items: SessionItem[], truncated: boolean}} session
 * @param {StepLike[]} steps
 * @param {Array<{file: string, body: string, truncated: boolean}>} files the run's other transcripts
 */
export declare function sessionHtml(session: {
    items: SessionItem[];
    truncated: boolean;
}, steps: StepLike[], files: Array<{
    file: string;
    body: string;
    truncated: boolean;
}>): string;
/** Styles for sessionHtml. */
export declare const SESSION_CSS = ".rp-log{min-width:0;min-height:0;display:flex;flex-direction:column}\n.rp-log>.panel{padding:0}.rp-log>.panel>*{margin-left:0;margin-right:0}\n.rp-log .meta{padding:var(--s-sm) var(--s-lg)}\n.kept{margin:0;background:none;border:0;padding:var(--s-md) var(--s-lg)}\n.kept-lines{margin:0;padding:var(--s-sm) var(--s-lg) var(--s-md) var(--s-2xl);font:var(--label);letter-spacing:.01em;white-space:pre-wrap;overflow-wrap:anywhere}\n.kept-lines li{padding:var(--s-sm) 0 var(--s-sm) var(--s-sm)}.kept-lines li+li{border-top:1px solid var(--line)}.kept-lines li::marker{color:var(--text-3)}\n.kinds{position:sticky;top:0;z-index:1;display:flex;gap:var(--s-sm);overflow-x:auto;padding:var(--s-sm) var(--s-lg);background:var(--white);border-bottom:1px solid var(--line)}\n.kind{flex:none;height:var(--control-sm);padding:0 var(--s-md);border-radius:var(--r-full);background:none;box-shadow:inset 0 0 0 1px var(--line);font:var(--label-strong);font-weight:400;letter-spacing:.01em;color:var(--text-2)}\n.kind[aria-pressed=\"true\"]{background:var(--black);box-shadow:none;color:var(--white)}\n.acts{list-style:none;margin:0;padding:0 0 var(--s-md)}\n.acts[data-only=\"call\"] .act:not(.call),.acts[data-only=\"command\"] .act:not(.command),.acts[data-only=\"said\"] .act:not(.said){display:none}\n.at-step{display:block;width:100%;padding:var(--s-sm) var(--s-lg);background:var(--chalk);border-top:1px solid var(--line);text-align:left;font-size:var(--fs-sm);line-height:1.5}\n.acts>li:first-child .at-step{border-top:0}.at-step[aria-current=\"step\"]{font-weight:500}\n.act-who,.act-at,.act-where,.act-end,.act-parts dt{font:var(--label);line-height:1.75;letter-spacing:.01em;color:var(--text-3)}\n.act-who{display:block}\n.act{display:grid;grid-template-columns:var(--s-2xl) minmax(0,1fr);column-gap:var(--s-md);align-items:start;padding:0 var(--s-lg)}\n.act{border-top:1px solid var(--line)}\n.act-at{text-align:right;padding-top:calc((var(--touch) - 1.75*var(--fs-xs))/2)}\n.act-said{padding:var(--s-sm) 0 var(--s-md);font-size:var(--fs-sm);line-height:1.5;max-width:44em;white-space:pre-wrap;overflow-wrap:anywhere}\n.act-said code{font:var(--label)}\n.act details{margin:0;min-width:0}\n.act-line{display:flex;align-items:center;gap:var(--s-sm);min-height:var(--touch);list-style:none;color:var(--text)}\n.act summary::-webkit-details-marker{display:none}\n.act summary:hover .act-name{text-decoration:underline;text-underline-offset:.2em}\n.act-mark{flex:none;width:var(--s-md);height:var(--s-md);overflow:hidden;color:transparent;background:var(--text);-webkit-mask:var(--tick) center/contain no-repeat;mask:var(--tick) center/contain no-repeat}\n.act-mark.bad{background:var(--error);-webkit-mask-image:var(--cross);mask-image:var(--cross)}\n.act-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 var(--fs-xs)/1.75 var(--mono);letter-spacing:.01em}\n.act-name b{font-weight:500;font-size:var(--fs-sm)}\n.act details[open] .act-name{white-space:pre-wrap;overflow-wrap:anywhere}\n.act-end{flex:none;display:flex;gap:var(--s-sm);white-space:nowrap}\n/* Red is for a call to the product that failed. A command of the agent's own that exits with an error is gray: the agent was finding its way. */\n.command .act-mark.bad{background:var(--text-3)}\n.act-parts{display:grid;grid-template-columns:minmax(0,1fr);margin:0 0 var(--s-md)}\n.act-parts dd{margin:0 0 var(--s-sm)}.act-parts pre{margin:0;max-height:24rem;overflow:auto}\n@media(max-width:54em){.rp-log{order:1;border-top:1px solid var(--line)}.kinds,.at-step,.rp-log .meta{padding-left:var(--s-md);padding-right:var(--s-md)}.kept{padding:var(--s-md)}.kept-lines{padding-right:var(--s-md)}.kind{height:var(--touch)}\n  .act{grid-template-columns:minmax(0,1fr);padding:0 var(--s-md)}.act-at{display:none}}";
