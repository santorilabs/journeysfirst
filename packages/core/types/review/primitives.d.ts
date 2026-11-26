/**
 * A result as a tag, like "Failed". In a list it shows as a tick or a cross.
 * @param {string | undefined} state
 */
export declare function badge(state: string | undefined): string;
/**
 * A row of tabs. The first is on. Each shows the panel with its name.
 * @param {string} label what the tabs choose between, for a screen reader
 * @param {Array<{name: string, label: string}>} items label: already safe HTML
 */
export declare function tabs(label: string, items: Array<{
    name: string;
    label: string;
}>): string;
/**
 * What one tab shows. It scrolls on its own.
 * @param {string} name
 * @param {string} html
 * @param {boolean} [hidden]
 */
export declare function panel(name: string, html: string, hidden?: boolean): string;
/** Styles for the pieces above, and for the text roles. */
export declare const PRIMITIVES_CSS = ".meta,.how,.empty{color:var(--text-3);font-size:var(--fs-sm)}\n.verdict{display:inline-flex;align-items:center;height:var(--s-lg);padding:0 var(--s-sm);border-radius:var(--r-xs);vertical-align:middle;white-space:nowrap;font:var(--label-strong);letter-spacing:.01em;color:var(--text-2);background:var(--chalk)}\n.verdict.passed,.verdict.done{color:var(--text);background:none;box-shadow:inset 0 0 0 1px var(--line)}.verdict.failed{color:var(--white);background:var(--error)}\n.error{color:var(--error);font-size:var(--fs-sm)}\n.evidence dl,.run-details dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s-xs) var(--s-md);margin:var(--s-sm) 0}\n.evidence dt,.run-details dt{color:var(--text-3)}.evidence dd,.run-details dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}\n/* A tick and a cross, drawn once. The element keeps its word for a screen reader. */\n.row .verdict.passed,.row .verdict.failed,.check .step-status.good,.step-status.bad{flex:none;width:var(--s-md);height:var(--s-md);padding:0;overflow:hidden;color:transparent;box-shadow:none;border-radius:0;background:var(--text);-webkit-mask:var(--tick) center/contain no-repeat;mask:var(--tick) center/contain no-repeat}\n.row .verdict.failed,.step-status.bad{background:var(--error);-webkit-mask-image:var(--cross);mask-image:var(--cross)}\n/* Tabs, and a switch between users, look the same. */\n.tabs{flex:none;display:flex;gap:var(--s-lg);padding:0 var(--s-md);border-bottom:1px solid var(--line);overflow-x:auto}\n.tab,.users button{flex:none;height:var(--tab);padding:0;background:none;border-bottom:2px solid transparent;font:var(--label-strong);font-weight:400;letter-spacing:.01em;color:var(--text-3)}\n.tab[aria-selected=\"true\"]{color:var(--text);border-bottom-color:var(--black)}\n.panel{flex:1;min-height:0;overflow-y:auto;padding:var(--s-sm)}.panel[hidden]{display:none}\n.panel>*{margin-left:var(--s-sm);margin-right:var(--s-sm)}";
