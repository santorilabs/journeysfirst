/** After a check, its verdict stays up for this many pauses, so it can be read. */
export declare const CHECK_PAUSES = 5;
/** The longest caption, in characters. A longer one is cut at a word. */
export declare const CAPTION_LENGTH = 90;
/** Where the caption bar goes when nobody says. */
export declare const DEFAULT_POSITION = "top";
export type Position = "top" | "bottom";
export type CaptionsOption = boolean | {
    position?: Position;
};
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
export declare function captionSettings(test: CaptionsOption | undefined, project: CaptionsOption | undefined): {
    position: Position;
} | null;
/**
 * Where Playwright draws clicks and typing: the corner away from the caption bar, so they never overlap.
 * @param {Position} position the caption bar's
 */
export declare function actionsFor(position: Position): {
    position: "bottom-right" | "top-right";
};
export type Caption = {
    by: string;
    text: string;
    lead?: string;
    verdict?: string;
};
export type Values = Record<string, {
    value?: unknown;
    secret?: boolean;
}>;
export type Page = import("@playwright/test").Page;
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
export declare function canCaption(page: Page): boolean;
/**
 * A user's name as a caption shows it: "you" is "You".
 * @param {string} user
 */
export declare function userLabel(user: string): string;
/**
 * The line with each `${name}` filled in when the run knows its value. A
 * secret, or a value not known yet, stays as `${name}`.
 * @param {string} line
 * @param {Values} values
 */
export declare function fillValues(line: string, values: Values): string;
/**
 * A caption is one plain sentence: the first sentence of the text, cut to
 * CAPTION_LENGTH at a word with an ellipsis.
 * @param {string} text the caption the script gave, or else the line or reason
 */
export declare function shortCaption(text: string): string;
/**
 * The caption as one line: "You sign up with your email." or "Failed: the new project is not in Your projects."
 * @param {Caption} caption
 */
export declare function captionText(caption: Caption): string;
/**
 * The caption bar as HTML for one user's page. On the page of the user
 * whose line it is, the bar is bright. On everyone else's it is dimmed.
 * @param {Caption} caption
 * @param {string} viewer the user whose page shows this bar
 * @param {Position} [position]
 */
export declare function captionHtml(caption: Caption, viewer: string, position?: Position): string;
/**
 * Adopt the caption stylesheet on this document. The fixture runs it as an
 * init script, so it runs again on every new document. It runs in the page,
 * so it uses nothing from this module.
 * @param {string} css
 */
export declare function adoptCaptionStyles(css: string): void;
/**
 * Show a caption on a page in place of the one it had. The new bar goes up
 * before the old one comes down, so the video never shows a frame without one.
 * @param {Page} page
 * @param {string} html
 * @param {{dispose: () => Promise<void>} | null} previous
 */
export declare function replaceCaption(page: Page, html: string, previous: {
    dispose: () => Promise<void>;
} | null): Promise<import("@playwright/test").Disposable>;
/**
 * A screenshot without the caption bar or the click and typing marks: they are
 * for the video only.
 * @param {Page} page
 * @param {{position: Position} | null} captions the run's captions, null when this page shows none
 */
export declare function cleanScreenshot(page: Page, captions: {
    position: Position;
} | null): Promise<Buffer<ArrayBufferLike>>;
/**
 * The caption bar's look, as ::part rules. The text scales with the page (28px
 * at 1280 wide), so it stays readable in a scaled-down video and on a phone.
 * Later rules win over earlier ones of the same weight, so the order matters.
 */
export declare const CAPTION_CSS: string;
