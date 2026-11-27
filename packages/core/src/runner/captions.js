// Captions for paced journey videos. While a paced run records, each user's page shows
// a bar at the top (or bottom) with the line in progress, so a person watching a video
// can tell which step is happening. Playwright draws the bar with
// page.screencast. A Playwright without it shows no captions, and nothing else
// changes.
//
// The bar has no style attributes: a page's Content-Security-Policy refuses
// them. Its elements carry part names, and CAPTION_CSS styles them with
// ::part rules from a stylesheet the fixture adopts on every document
// (adoptCaptionStyles). A constructed stylesheet is not subject to style-src,
// and ::part reaches into the closed shadow root where Playwright draws its
// overlays. A page that requires Trusted Types refuses Playwright's overlay
// itself, so it shows no bar; the review page still shows each line as a
// captions track.
import { LABELS } from "../shared/display.js";

/** The longest caption, in characters. A longer one is cut at a word. */
export const CAPTION_LENGTH = 90;

/** Where the caption bar goes when nobody says. */
export const DEFAULT_POSITION = "top";

/**
 * @typedef {"top"|"bottom"} Position
 * @typedef {boolean | {position?: Position}} CaptionsOption what test.journey and the journeyCaptions option take
 */

/**
 * The captions a run shows: null for none, else where the bar goes. The
 * test's own option wins over the project's.
 * @param {CaptionsOption | undefined} test the test.journey option
 * @param {CaptionsOption | undefined} project the journeyCaptions option from the Playwright config's use
 * @returns {{position: Position} | null}
 */
export function captionSettings(test, project) {
  if (test === false || (test === undefined && project === false)) return null;
  const pick = (/** @type {CaptionsOption | undefined} */ option) => (typeof option === "object" && option ? option.position : undefined);
  const position = pick(test) ?? pick(project) ?? DEFAULT_POSITION;
  if (position !== "top" && position !== "bottom") throw new Error(`captions position must be "top" or "bottom", not ${JSON.stringify(position)}.`);
  return { position };
}

/**
 * Where Playwright draws clicks and typing: the corner away from the caption bar, so they never overlap.
 * @param {Position} position the caption bar's
 */
export function actionsFor(position) {
  return { position: position === "top" ? /** @type {const} */ ("bottom-right") : /** @type {const} */ ("top-right") };
}

/**
 * @typedef {{by: string, text: string, lead?: string, verdict?: string}} Caption
 *   by: whose line it is. text: one plain sentence.
 *   lead: a word shown first, like "You" or "Checking". verdict: a check's result, shown first.
 * @typedef {Record<string, {value?: unknown, secret?: boolean}>} Values the run's `${name}` values
 * @typedef {import("@playwright/test").Page} Page
 */

/**
 * Whether this Playwright can draw captions on a page.
 * @param {Page} page
 */
export function canCaption(page) {
  return typeof page.screencast?.showOverlay === "function";
}

/**
 * A user's name as a caption shows it: "you" is "You".
 * @param {string} user
 */
export function userLabel(user) {
  return user.charAt(0).toUpperCase() + user.slice(1);
}

/**
 * The line with each `${name}` filled in when the run knows its value. A
 * secret, or a value not known yet, stays as `${name}`.
 * @param {string} line
 * @param {Values} values
 */
export function fillValues(line, values) {
  return line.replace(/\$\{([a-z][a-z0-9_]*)\}/g, (whole, name) => {
    const known = values[name];
    return known && !known.secret && known.value !== undefined && known.value !== null ? String(known.value) : whole;
  });
}

/**
 * A caption is one plain sentence: the first sentence of the text, cut to
 * CAPTION_LENGTH at a word with an ellipsis.
 * @param {string} text the caption the script gave, or else the line or reason
 */
export function shortCaption(text) {
  const first = text.trim().replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0];
  if (first.length <= CAPTION_LENGTH) return first;
  const cut = first.slice(0, CAPTION_LENGTH + 1);
  const word = cut.lastIndexOf(" ");
  return `${(word > 0 ? cut.slice(0, word) : first.slice(0, CAPTION_LENGTH)).replace(/[\s.,;:!?-]+$/, "")}…`;
}

/**
 * The caption's lead, if any: the verdict on a check's result, else the lead
 * a fallback caption carries ("You", "Checking"). A caption the script wrote
 * is a whole sentence and has none.
 * @param {Caption} caption
 */
function lead({ lead, verdict }) {
  return verdict ? (LABELS[/** @type {keyof typeof LABELS} */ (verdict)] ?? verdict) : lead;
}

/**
 * The caption as one line: "You sign up with your email." or "Failed: the new project is not in Your projects."
 * @param {Caption} caption
 */
export function captionText(caption) {
  const first = lead(caption);
  return first ? `${first}: ${caption.text}` : caption.text;
}

/**
 * The caption bar as HTML for one user's page. On the page of the user
 * whose line it is, the bar is bright. On everyone else's it is dimmed.
 * @param {Caption} caption
 * @param {string} viewer the user whose page shows this bar
 * @param {Position} [position]
 */
export function captionHtml(caption, viewer, position = DEFAULT_POSITION) {
  const here = caption.by === viewer;
  const first = lead(caption);
  const verdict = caption.verdict && caption.verdict in VERDICT_COLORS ? ` jf-${caption.verdict}` : "";
  const pill = caption.verdict ? `<span part="jf-pill${verdict}">${esc(first)}:</span> ` : first ? `<span part="jf-lead">${esc(first)}:</span> ` : "";
  return `<div part="jf-bar jf-${position === "top" ? "top" : "bottom"} jf-${here ? "here" : "away"}">${pill}${esc(caption.text)}</div>`;
}

/**
 * Adopt the caption stylesheet on this document. The fixture runs it as an
 * init script, so it runs again on every new document. It runs in the page,
 * so it uses nothing from this module.
 * @param {string} css
 */
export function adoptCaptionStyles(css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // A browser without constructed stylesheets shows an unstyled bar; the run goes on.
  }
}

/**
 * Show a caption on a page in place of the one it had. The new bar goes up
 * before the old one comes down, so the video never shows a frame without one.
 * @param {Page} page
 * @param {string} html
 * @param {{dispose: () => Promise<void>} | null} previous
 */
export async function replaceCaption(page, html, previous) {
  const shown = await page.screencast.showOverlay(html);
  await previous?.dispose();
  return shown;
}

/**
 * A screenshot without the caption bar or the click and typing marks: they are
 * for the video only.
 * @param {Page} page
 * @param {{position: Position} | null} captions the run's captions, null when this page shows none
 */
export async function cleanScreenshot(page, captions) {
  if (!captions) return page.screenshot({ fullPage: false });
  await page.screencast.hideOverlays();
  await page.screencast.hideActions();
  try {
    return await page.screenshot({ fullPage: false });
  } finally {
    await page.screencast.showOverlays();
    await page.screencast.showActions(actionsFor(captions.position));
  }
}

// Solid colors, white text: readable on any page and after video compression.
const VERDICT_COLORS = /** @type {Record<string, string>} */ ({ passed: "#0b7a3e", failed: "#b0124f", blocked: "#7a6440", not_checked: "#7a6440" });

/**
 * The caption bar's look, as ::part rules. The text scales with the page (28px
 * at 1280 wide), so it stays readable in a scaled-down video and on a phone.
 * Later rules win over earlier ones of the same weight, so the order matters.
 */
export const CAPTION_CSS = [
  "*::part(jf-bar){position:fixed;left:0;right:0;z-index:2147483647;box-sizing:border-box;padding:0.7em 1.1em;background:#0d0e0f;color:#d9d9d6;font:600 clamp(18px,2.2vw,32px)/1.3 system-ui,-apple-system,sans-serif;letter-spacing:.005em}",
  "*::part(jf-top){top:0;border-bottom:6px solid #6d6d6d}",
  "*::part(jf-bottom){bottom:0;border-top:6px solid #6d6d6d}",
  "*::part(jf-here){color:#fff;border-color:#f5c542}",
  "*::part(jf-lead){color:#f5c542;font-weight:800}",
  "*::part(jf-pill){display:inline-block;padding:0.12em 0.55em;margin-right:0.25em;border-radius:0.35em;color:#fff;font-weight:800;background:#7a6440}",
  ...Object.entries(VERDICT_COLORS).map(([verdict, color]) => `*::part(jf-${verdict}){background:${color}}`),
].join("\n");

/** @param {unknown} value */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
