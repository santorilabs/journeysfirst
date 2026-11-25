import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { CAPTURE_LIMIT } from "./capture.js";

/**
 * Record steps and checks for one seat, using files selected by the runner.
 * @param {import("./recorder.js").RunRecorder} run
 * @param {string} by
 */
export function recording(run, by) {
  run.knows(by);
  /** @type {Map<string, Map<number, string>>} */
  const captures = new Map();
  return {
    /**
     * Attach a private capture the runner has checked for secrets.
     * @param {string} name
     * @param {string} path
     */
    attach(name, path) {
      if (run.files.has(name)) throw new Error("Choose a different name for this capture.");
      const rows = readCapture(path).map((row) => ({ ...row, text: run.redact(row.text) }));
      const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      /** @type {Map<number, string>} */
      const entries = new Map();
      rows.forEach((row, index) => {
        if (["stdout", "stderr", "response"].includes(row.kind)) entries.set(index + 1, row.text);
      });
      const file = run.attach({ name, body: text, kind: "transcript" });
      captures.set(file, entries);
      return file;
    },
    /** @param {Parameters<typeof run.step>[0]} line @param {Omit<NonNullable<Parameters<typeof run.step>[1]>, "by">} [result] */
    step(line, result) {
      run.step(line, { ...result, by });
    },
    /**
     * Resolve refs against captures owned by this seat, not arbitrary paths.
     * @param {string} id
     * @param {Omit<NonNullable<Parameters<typeof run.check>[1]>, "by"|"evidence"> & {refs?: {file: string, line: number}[]}} [result]
     */
    check(id, { refs = [], ...result } = {}) {
      if (result.verdict === "passed" && !refs.length) throw new Error("A passed check needs at least one captured evidence reference.");
      const evidence = refs.map(({ file, line }) => {
        const got = captures.get(file)?.get(line);
        if (!got) throw new Error("Use an output or response line from a capture attached to this seat.");
        return { source: "log", login: by, query: `${file}, line ${line}`, got };
      });
      run.check(id, { ...result, evidence, by });
    },
  };
}

/** @param {string} path */
function readCapture(path) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > CAPTURE_LIMIT) throw new Error("Give a capture file no larger than 64 KiB.");
    const bytes = Buffer.alloc(CAPTURE_LIMIT + 1);
    let read = 0;
    while (read < bytes.length) {
      const size = readSync(fd, bytes, read, bytes.length - read, null);
      if (!size) break;
      read += size;
    }
    if (read > CAPTURE_LIMIT) throw new Error("Give a capture file no larger than 64 KiB.");
    const text = bytes.toString("utf8", 0, read);
    if (!text.endsWith("\n")) throw new Error("Give a finished, nonempty capture.");
    return text.slice(0, -1).split("\n").map((line) => {
      let row;
      try { row = JSON.parse(line); } catch { throw new Error("Give a file written by capture or mcp-proxy."); }
      if (!row || typeof row.text !== "string" || !["request", "response", "stdout", "stderr", "notice"].includes(row.kind)) {
        throw new Error("Give a file written by capture or mcp-proxy.");
      }
      return { kind: /** @type {string} */ (row.kind), text: row.text, ...(Number.isSafeInteger(row.request) ? { request: row.request } : {}) };
    });
  } finally { closeSync(fd); }
}
