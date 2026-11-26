import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { MASK, maskText } from "./mask.js";

export const CAPTURE_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 16 * 1024;
const METHODS = new Set(["initialize", "tools/list", "tools/call", "resources/list", "resources/read", "prompts/list", "prompts/get", "ping"]);
const CUT = JSON.stringify({ kind: "notice", text: "Capture limit reached. More output was not saved." }) + "\n";

/**
 * Run a command with its streams connected normally, saving selected text.
 * @param {string[]} argv
 * @param {{out: string, mcp?: boolean, secrets?: string[], identity?: {login: string} | {key: string}}} options
 */
export async function captureCommand(argv, { out, mcp = false, secrets = [], identity }) {
  if (!argv[0]) throw new Error("Give a command after --.");
  const fd = openSync(out, "wx", 0o600);
  const redact = makeRedactor(secrets);
  let saved = 0, truncated = false, line = 0;
  /** @param {{kind: string, text: string, request?: number}} entry */
  const add = (entry) => {
    if (truncated) return;
    const text = JSON.stringify({ ...entry, text: redact(entry.text), ...(!line ? identity : undefined) }) + "\n";
    if (Buffer.byteLength(text) + saved + Buffer.byteLength(CUT) > CAPTURE_LIMIT) {
      writeFileSync(fd, CUT);
      truncated = true;
      return;
    }
    writeFileSync(fd, text);
    saved += Buffer.byteLength(text);
    return ++line;
  };
  const input = mcp ? mcpTap(add, "client") : null;
  const output = mcp ? mcpTap(add, "server", input?.requests) : terminalTap("stdout", add);
  const error = terminalTap("stderr", add);
  const child = spawn(argv[0], argv.slice(1), { stdio: [mcp ? "pipe" : "inherit", "pipe", "pipe"] });
  const onInt = () => child.kill("SIGINT");
  const onTerm = () => child.kill("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const onInput = (/** @type {Buffer} */ chunk) => input?.read(chunk, output.requests);
  if (child.stdin) {
    child.stdin.on("error", () => {});
    process.stdin.on("data", onInput);
    process.stdin.pipe(child.stdin);
  }
  child.stdout?.on("data", (chunk) => output.read(chunk));
  child.stderr?.on("data", (chunk) => error.read(chunk));
  child.stdout?.pipe(process.stdout, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  try {
    const [code, signal] = await once(child, "close");
    output.finish();
    error.finish();
    return code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  } catch {
    throw new Error("Could not start the command. Check that the executable is installed.");
  } finally {
    if (child.stdin) {
      process.stdin.unpipe(child.stdin);
      process.stdin.off("data", onInput);
      process.stdin.pause();
    }
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    closeSync(fd);
  }
}

/** @param {string[]} secrets */
function makeRedactor(secrets) {
  const variants = [...new Set(secrets.filter(Boolean).flatMap((value) =>
    [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]))].sort((a, b) => b.length - a.length);
  const pattern = variants.length ? new RegExp(variants.map((text) => text.replace(/[.*+?^$${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const credential = /((?:[-\w]*(?:admin[-_]?key|deploy[-_]?key|api[-_]?key|password|secret|token|authorization))["']?(?:\s*[:=]\s*|(?<=key)\s+))("(?:[^"\\]|\\.)*"|'[^']*'|(?:bearer\s+)?[^\s,"';}]+)/gi;
  return (/** @type {string} */ text) => maskText((pattern ? text.replace(pattern, MASK) : text)
    .replace(credential, (_, name) => name + MASK));
}

/**
 * Keep a bounded prefix in memory. A clipped stream may end inside a secret,
 * so do not save its partial tail.
 * @param {string} kind
 * @param {(entry: {kind: string, text: string}) => void} add
 */
function terminalTap(kind, add) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0, clipped = false;
  return {
    requests: undefined,
    read(/** @type {Buffer} */ chunk) {
      const remaining = MESSAGE_LIMIT - size;
      if (remaining > 0) {
        chunks.push(Buffer.from(chunk.subarray(0, remaining)));
        size += Math.min(remaining, chunk.length);
      }
      if (chunk.length > remaining) clipped = true;
    },
    finish() {
      if (clipped) add({ kind: "notice", text: kind + " was too large to save safely." });
      else if (size) {
        const text = decode(Buffer.concat(chunks));
        if (text) add({ kind, text });
      }
    },
  };
}

/**
 * Read a copy of MCP's newline-framed JSON without affecting the forwarded bytes.
 * @param {(entry: {kind: string, text: string, request?: number}) => number | undefined} add
 * @param {"client"|"server"} side
 * @param {Map<string, number>} [other]
 */
function mcpTap(add, side, other) {
  /** @type {Map<string, number>} */
  const requests = new Map();
  /** @type {Buffer[]} */
  let parts = [];
  let size = 0, clipped = false;
  return {
    requests,
    /** @param {Buffer} chunk @param {Map<string, number>} [peer] */
    read(chunk, peer = other) {
      for (let offset = 0; offset < chunk.length;) {
        const newline = chunk.indexOf(10, offset);
        const part = chunk.subarray(offset, newline < 0 ? chunk.length : newline);
        size += part.length;
        if (!clipped && size <= MESSAGE_LIMIT) parts.push(Buffer.from(part));
        else { clipped = true; parts = []; }
        if (newline < 0) break;
        if (!clipped) message(decode(Buffer.concat(parts)), peer);
        parts = [];
        size = 0;
        clipped = false;
        offset = newline + 1;
      }
    },
    finish() {},
  };
  /** @param {string} text @param {Map<string, number>} [peer] */
  function message(text, peer) {
    let data;
    try { data = JSON.parse(text); } catch { return; }
    if (data?.jsonrpc !== "2.0" || (typeof data.id !== "number" && typeof data.id !== "string")) return;
    const id = JSON.stringify(data.id);
    if (typeof data.method === "string") {
      requests.delete(id);
      if (!METHODS.has(data.method)) return;
      const tool = data.method === "tools/call" && /^[\w.-]{1,80}$/.test(data.params?.name ?? "") ? " " + data.params.name : "";
      const line = add({ kind: "request", text: side + " " + data.method + tool });
      if (line !== undefined && requests.size < 128) requests.set(id, line);
    } else if (peer?.has(id) && ("result" in data || "error" in data)) {
      const request = peer.get(id);
      peer.delete(id);
      const reported = typeof data.error?.message === "string" ? data.error.message
        : data.result?.isError && Array.isArray(data.result.content)
          ? data.result.content.find((/** @type {any} */ item) => item?.type === "text" && typeof item.text === "string")?.text
          : null;
      add({ kind: "response", request, text: reported || (data.error || data.result?.isError ? "Error" : "Result returned") });
    }
  }
}

/** @param {Buffer} bytes */
function decode(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\0") ? "" : text;
  } catch { return ""; }
}
