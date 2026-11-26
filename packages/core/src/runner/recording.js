import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { CAPTURE_LIMIT } from "./capture.js";

/**
 * Record steps and checks for one seat, using files selected by the runner.
 * @param {import("./recorder.js").RunRecorder} run
 * @param {string} by
 */
export function recording(run, by) {
  run.knows(by);
  /** @type {Map<string, {entries: Map<number, string>, login?: string, key?: string}>} */
  const captures = new Map();
  return {
    /**
     * Attach a private capture the runner has checked for secrets.
     * @param {string} name
     * @param {string} path
     * @param {{login: string, key?: never} | {key: string, login?: never} | "recorded"} [identity] the session the runner actually used
     */
    attach(name, path, identity) {
      if (run.files.has(name)) throw new Error("Choose a different name for this capture.");
      const rows = readCapture(path).map((row) => ({ ...row, text: run.redact(row.text) }));
      if (identity === "recorded") {
        const { key, login } = rows[0];
        if (key !== undefined && login !== undefined) throw new Error("Give a login or a key name, not both.");
        identity = key !== undefined ? { key } : login !== undefined ? { login } : undefined;
      }
      if (identity?.login !== undefined) {
        if (identity.key !== undefined) throw new Error("Give a login or a key name, not both.");
        run.knows(identity.login);
      } else if (identity !== undefined && (typeof identity.key !== "string" || !identity.key.trim())) {
        throw new Error("Give the name of the key used for this capture, not its value.");
      }
      const text = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
      /** @type {Map<number, string>} */
      const entries = new Map();
      rows.forEach((row, index) => {
        if (["stdout", "stderr", "response"].includes(row.kind)) entries.set(index + 1, row.text);
      });
      const file = run.attach({ name, body: text, kind: "transcript" });
      captures.set(file, { entries, ...identity });
      return file;
    },
    /** @param {Parameters<typeof run.step>[0]} line @param {Omit<NonNullable<Parameters<typeof run.step>[1]>, "by">} [result] */
    step(line, result) {
      const reason = typeof result?.reason === "string" ? run.redact(result.reason) : result?.reason;
      run.step(line, { ...result, reason, by });
    },
    /**
     * Resolve refs against captures owned by this seat, not arbitrary paths.
     * @param {string} id
     * @param {Omit<NonNullable<Parameters<typeof run.check>[1]>, "by"|"evidence"> & {refs?: {file: string, line: number}[]}} [result]
     */
    check(id, { refs = [], ...result } = {}) {
      if (result.verdict === "passed" && !refs.length) throw new Error("A passed check needs at least one captured evidence reference.");
      const evidence = refs.map(({ file, line }) => {
        const capture = captures.get(file);
        const got = capture?.entries.get(line);
        if (!got) throw new Error("Use an output or response line from a capture attached to this seat.");
        if (!capture?.login && !capture?.key) throw new Error("Name the session the capture used before citing it as evidence.");
        if (result.verdict === "passed" && capture.login !== by) throw new Error("A passed check must cite evidence from this seat's own session.");
        return { source: "log", ...(capture.key ? { key: capture.key } : { login: capture.login }), query: `${file}, line ${line}`, got };
      });
      const proof = typeof result.proof === "string" ? run.redact(result.proof) : result.proof;
      const reason = typeof result.reason === "string" ? run.redact(result.reason) : result.reason;
      run.check(id, { ...result, proof, reason, evidence, by });
    },
  };
}

/** @param {string} path */
function readCapture(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
      return { kind: /** @type {string} */ (row.kind), text: row.text,
        ...(Number.isSafeInteger(row.request) ? { request: row.request } : {}),
        ...(typeof row.login === "string" ? { login: row.login } : {}),
        ...(typeof row.key === "string" && /^[A-Z_][A-Z0-9_]*$/.test(row.key) ? { key: row.key } : {}) };
    });
  } finally { closeSync(fd); }
}
