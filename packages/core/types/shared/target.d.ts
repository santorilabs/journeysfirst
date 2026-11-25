/** Printed when a config sets neither use.baseURL nor webServer. */
export declare const MISSING_TARGET: string;
/**
 * The message when neither an address nor a server is set. Null when a run can open a page.
 * @param {{baseURL?: unknown, webServer?: unknown}} [target]
 * @returns {string | null}
 */
export declare function missingTarget(target?: {
    baseURL?: unknown;
    webServer?: unknown;
}): string | null;
