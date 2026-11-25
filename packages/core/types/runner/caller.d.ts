/**
 * fn, called from code that sits at the place test.journey was called from.
 * Playwright names a test by the file and line its test() was called from,
 * read from the stack. Called from here, every journey test would be listed
 * at this file. A function compiled with the caller's file name and position
 * makes Playwright list the user's spec file and line instead. Playwright maps
 * that position through the spec's source map, as it does for its own calls.
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {Function} from the function the caller called; stack frames from it inward are skipped
 * @returns {F}
 */
export declare function atCaller<F extends (...args: any[]) => any>(fn: F, from: Function): F;
