/** What a covered value is replaced with. The same text in a field, a trace and a run. */
export declare const MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
/**
 * Obvious secret patterns in a string: a bearer token, a key assignment, a
 * private key. A short ordinary word is left as written.
 * @param {string} text
 * @returns {string}
 */
export declare function maskText(text: string): string;
/**
 * Replace secret-like strings in a run, in place. Call it only after the
 * declared-secret check, which must still see the original text.
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
export declare function maskRun(value: unknown, key?: string): unknown;
/**
 * Cover password fields and secret text. Playwright runs this in the page.
 * It takes one argument and uses no outer names, so the page can run it.
 * @param {{secrets?: string[], mask?: string}} arg
 */
export declare function applyMask(arg: {
    secrets?: string[];
    mask?: string;
}): void;
/** Put back what applyMask covered. Playwright runs this in the page. */
export declare function restoreMask(): void;
/**
 * A trace zip with secret text replaced. An unreadable zip is returned as it
 * is: a broken rewrite would hide the failure. Image entries are kept.
 * @param {Buffer} buffer
 * @param {string[]} [secrets] declared secret values, searched for as text
 * @returns {Buffer}
 */
export declare function redactZip(buffer: Buffer, secrets?: string[]): Buffer;
/**
 * Entries of a zip Playwright can write: sizes live in the central directory.
 * Returns null when the bytes are not a zip this reader understands.
 * @param {Buffer} buffer
 * @returns {{name: string, data: Buffer}[] | null}
 */
export declare function readZip(buffer: Buffer): {
    name: string;
    data: Buffer;
}[] | null;
