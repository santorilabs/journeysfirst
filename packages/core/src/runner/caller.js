// Makes Playwright list a journey test at the user's spec file and line.
// Only playwright.js uses it.
import { compileFunction } from "node:vm";

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
export function atCaller(fn, from) {
  const where = callerFrame(from);
  if (!where) return fn;
  const call = compileFunction("fn(...args)", ["fn", "args"], { filename: where.file, lineOffset: where.line - 1, columnOffset: where.column - 1 });
  return /** @type {F} */ ((...args) => call(fn, args));
}

/**
 * The file, line and column of the code that called from, unmapped.
 * @param {Function} from
 */
function callerFrame(from) {
  const prepare = Error.prepareStackTrace;
  const limit = Error.stackTraceLimit;
  /** @type {{stack?: any}} */
  const holder = {};
  try {
    Error.stackTraceLimit = 1;
    Error.prepareStackTrace = (_, frames) => frames[0];
    Error.captureStackTrace(holder, from);
    const frame = holder.stack;
    const file = frame?.getFileName();
    return file ? { file, line: frame.getLineNumber() ?? 1, column: frame.getColumnNumber() ?? 1 } : null;
  } finally {
    Error.prepareStackTrace = prepare;
    Error.stackTraceLimit = limit;
  }
}
