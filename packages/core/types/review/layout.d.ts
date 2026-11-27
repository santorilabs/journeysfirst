/**
 * @param {string} heading
 * @param {string} body
 * @param {Array<{text: string, href?: string}>} path where this page is, for the header bar. The last one is this page.
 * @param {boolean} [fit] the page fills one screen and its panels scroll, where a page otherwise scrolls as a whole
 */
export declare function layout(heading: string, body: string, path: Array<{
    text: string;
    href?: string;
}>, fit?: boolean): string;
