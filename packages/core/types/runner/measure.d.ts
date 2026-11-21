/** The width the phone half is measured at, in px. */
export declare const PHONE_WIDTH = 375;
/** The name the page calls to report an action, a change or a paint. */
export declare const WATCH_BINDING = "__journeysfirstSaw";
export type Seen = {
    kind: "action";
    at: number;
    name: string;
} | {
    kind: "change";
    at: number;
    text: string;
} | {
    kind: "paint";
    at: number;
    ms: number;
    path: string;
} | {
    kind: "field";
    at: number;
    name: string;
};
export type ActionTime = {
    name: string;
    ms?: number | null;
    changed?: string;
    field?: true;
};
export type Watch = {
    take: () => Promise<ActionTime[]>;
    forget: () => void;
};
export type Page = import("@playwright/test").Page;
/**
 * @typedef {{kind: "action", at: number, name: string} | {kind: "change", at: number, text: string}
 *   | {kind: "paint", at: number, ms: number, path: string} | {kind: "field", at: number, name: string}} Seen
 *   what a page reported, with its clock in ms
 * @typedef {{name: string, ms?: number|null, changed?: string, field?: true}} ActionTime a click, with ms to the first
 *   change (null when the page never changed), or a field the user filled or set (field: true, no ms)
 * @typedef {{take: () => Promise<ActionTime[]>, forget: () => void}} Watch
 * @typedef {import("@playwright/test").Page} Page
 */
/**
 * Runs in the page. Everything it returns is a number or a word read from the
 * page: nothing here judges it.
 *   spacing, type, fonts, radius, effects: each value in use, with how many elements have it and the first one.
 *   controls: each link, button and field, with its box, its fill and the region it sits in (a dialog, a form, the header).
 *     small: under 24 px in a direction (WCAG 2.2 target size). A text field, and a link or button that is only words
 *       (no fill, no border), are never marked.
 *     strong: a button whose fill has a contrast of 3 or more with the background behind it.
 *   cut: a dialog or fixed panel that runs off the side of the screen.
 *   text: a short hash of the words on the screen, so a later run can tell whether they changed.
 */
export declare function measurePage(): {
    width: number;
    pageWidth: number;
    text: string;
    controls: object[];
    cut: object[];
};
/**
 * Runs in every document a user opens. It reports each click on a control,
 * the first change to the page after it, and the document's first paint.
 * A change is a change to the DOM inside body, so a button that only copies
 * something and shows nothing reports no change. It also reports each field
 * the user fills or sets, so a review can count them.
 * @param {string} binding
 */
export declare function watchPage(binding: string): void;
/**
 * What a page reported, as one time for each action. A click that opened a new
 * page is timed to that page's first paint. A page opened another way (the
 * script went to its url) is its own line, "open /path". Paints are paired
 * within one journey line only, so a click that showed nothing is not credited
 * with a page the next line opened.
 * @param {Seen[]} seen in the order reported
 * @returns {ActionTime[]}
 */
export declare function actionTimes(seen: Seen[]): ActionTime[];
/** How long a line's last click is given to show a change after the script moved on, in ms. */
export declare const LAST_CLICK_GRACE = 300;
/**
 * Start watching a user's pages. take gives the actions since the last take
 * or forget. A script often goes on as soon as the response arrives, a few ms
 * before the page shows it. So when the last click has no change yet, take
 * waits a moment before it answers. forget drops what was seen so far.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {number} [grace] ms
 * @returns {Promise<Watch>}
 */
export declare function watchActions(context: import("@playwright/test").BrowserContext, grace?: number): Promise<Watch>;
/**
 * Delay each data request (fetch and XHR) a user's pages make, so a screen
 * that shows nothing while it waits can be told from one that shows it is
 * loading. Documents, scripts and styles are not delayed: a blank browser
 * says nothing about the product.
 * @param {import("@playwright/test").BrowserContext} context
 * @param {number} ms
 */
export declare function delayData(context: import("@playwright/test").BrowserContext, ms: number): Promise<void>;
/**
 * The screen at the run's width and, unless phone is false, at 375 px. The
 * page is set back to its own width after.
 * @param {Page} page
 * @param {{phone?: boolean}} [options]
 */
export declare function measureScreen(page: Page, { phone }?: {
    phone?: boolean;
}): Promise<{
    wide: {
        width: number;
        pageWidth: number;
        text: string;
        controls: object[];
        cut: object[];
    };
    phone?: undefined;
} | {
    wide: {
        width: number;
        pageWidth: number;
        text: string;
        controls: object[];
        cut: object[];
    };
    phone: {
        width: number;
        pageWidth: number;
        text: string;
        controls: object[];
        cut: object[];
    };
}>;
/**
 * The lines a slow replay prints: each action and how long the page took to
 * show anything, with data requests delayed.
 * @param {number} delay ms
 * @param {Array<{line: number, user: string, actions: ActionTime[]}>} lines
 */
export declare function slowReport(delay: number, lines: Array<{
    line: number;
    user: string;
    actions: ActionTime[];
}>): string;
