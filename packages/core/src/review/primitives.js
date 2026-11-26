// The small pieces every part of the review page is built from: a result
// tag, the tick and cross marks, tabs and their panels, the text roles and a
// list of names and values. Each has one look, set here.
import { LABELS, esc } from "../shared/display.js";

/**
 * A result as a tag, like "Failed". In a list it shows as a tick or a cross.
 * @param {string | undefined} state
 */
export function badge(state) {
  return state ? `<span class="verdict ${esc(state)}">${esc(LABELS[/** @type {keyof typeof LABELS} */ (state)] ?? state)}</span>` : "";
}

/**
 * A row of tabs. The first is on. Each shows the panel with its name.
 * @param {string} label what the tabs choose between, for a screen reader
 * @param {Array<{name: string, label: string}>} items label: already safe HTML
 */
export function tabs(label, items) {
  return `<div class="tabs" role="tablist" aria-label="${esc(label)}">${items.map((t, i) => `<button type="button" class="tab" role="tab" data-tab="${esc(t.name)}" aria-selected="${i === 0}">${t.label}</button>`).join("")}</div>`;
}

/**
 * What one tab shows. It scrolls on its own.
 * @param {string} name
 * @param {string} html
 * @param {boolean} [hidden]
 */
export function panel(name, html, hidden = false) {
  return `<div class="panel" data-panel="${esc(name)}"${hidden ? " hidden" : ""}>${html}</div>`;
}

/** Styles for the pieces above, and for the text roles. */
export const PRIMITIVES_CSS = `.meta,.how,.empty{color:var(--text-3);font-size:var(--fs-sm)}
.verdict{display:inline-flex;align-items:center;height:var(--s-lg);padding:0 var(--s-sm);border-radius:var(--r-xs);vertical-align:middle;white-space:nowrap;font:var(--label-strong);letter-spacing:.01em;color:var(--text-2);background:var(--chalk)}
.verdict.passed,.verdict.done{color:var(--text);background:none;box-shadow:inset 0 0 0 1px var(--line)}.verdict.failed{color:var(--white);background:var(--error)}
.error{color:var(--error);font-size:var(--fs-sm)}
.evidence dl,.run-details dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s-xs) var(--s-md);margin:var(--s-sm) 0}
.evidence dt,.run-details dt{color:var(--text-3)}.evidence dd,.run-details dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
/* A tick and a cross, drawn once. The element keeps its word for a screen reader. */
.row .verdict.passed,.row .verdict.failed,.check .step-status.good,.step-status.bad{flex:none;width:var(--s-md);height:var(--s-md);padding:0;overflow:hidden;color:transparent;box-shadow:none;border-radius:0;background:var(--text);-webkit-mask:var(--tick) center/contain no-repeat;mask:var(--tick) center/contain no-repeat}
.row .verdict.failed,.step-status.bad{background:var(--error);-webkit-mask-image:var(--cross);mask-image:var(--cross)}
/* Tabs, and a switch between users, look the same. */
.tabs{flex:none;display:flex;gap:var(--s-lg);padding:0 var(--s-md);border-bottom:1px solid var(--line);overflow-x:auto}
.tab,.users button{flex:none;height:var(--tab);padding:0;background:none;border-bottom:2px solid transparent;font:var(--label-strong);font-weight:400;letter-spacing:.01em;color:var(--text-3)}
.tab[aria-selected="true"]{color:var(--text);border-bottom-color:var(--black)}
.panel{flex:1;min-height:0;overflow-y:auto;padding:var(--s-sm)}.panel[hidden]{display:none}
.panel>*{margin-left:var(--s-sm);margin-right:var(--s-sm)}`;
