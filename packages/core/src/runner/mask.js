// Cover passwords and other obvious secrets before they are saved.
// A screenshot runs applyMask in the page, then restoreMask, so the test
// still sees the real value. A trace is a zip: read it from the central
// directory (Playwright leaves the local sizes at zero) and rewrite the text
// entries. The run file is masked only after the declared-secret check, so a
// value marked secret is still refused rather than quietly rewritten.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** What a covered value is replaced with. The same text in a field, a trace and a run. */
export const MASK = "••••••••";

const NAMED = "password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization";
const LOOSE = "secret|token";
const SECRET_KEY = /(?:^|[_-]|(?<=[a-z]))(?:password|passwd|secret|token|api[_-]?key|authorization)(?:$|[_-])/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|webm|mp4|wasm)$/i;
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/**
 * Obvious secret patterns in a string: a bearer token, a key assignment, a
 * private key. A short ordinary word is left as written.
 * @param {string} text
 * @returns {string}
 */
export function maskText(text) {
  if (!text) return text;
  let next = text;
  next = next.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK);
  next = next.replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/g, "Bearer ••••");
  next = next.replace(/\bAKIA[0-9A-Z]{16}\b/g, MASK);
  next = next.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, MASK);
  next = next.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, MASK);
  next = next.replace(/\bsk-[A-Za-z0-9]{20,}\b/g, MASK);
  next = next.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, MASK);
  return maskAssignments(next);
}

/**
 * Replace secret-like strings in a run, in place. Call it only after the
 * declared-secret check, which must still see the original text.
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
export function maskRun(value, key = "") {
  if (typeof value === "string") {
    if (key && SECRET_KEY.test(key) && value.length >= 4 && !/^(true|false|null)$/i.test(value)) return MASK;
    return maskText(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = maskRun(value[i], key);
    return value;
  }
  if (value && typeof value === "object") {
    const object = /** @type {Record<string, unknown>} */ (value);
    for (const [child, item] of Object.entries(object)) object[child] = maskRun(item, child);
  }
  return value;
}

/**
 * Cover password fields and secret text. Playwright runs this in the page.
 * It takes one argument and uses no outer names, so the page can run it.
 * @param {{secrets?: string[], mask?: string}} arg
 */
export function applyMask(arg) {
  const doc = /** @type {any} */ (globalThis).document;
  if (!doc?.querySelectorAll) return;
  const secrets = (arg?.secrets ?? []).filter((secret) => typeof secret === "string" && secret.length >= 4);
  const mask = arg?.mask || "••••••••";
  const named = /password|passwd|secret|token|api[-_]?key|authorization|one-time-code/i;
  for (const el of doc.querySelectorAll("input, textarea")) {
    if (el.getAttribute("data-jf-mask") !== null) continue;
    const hint = `${el.getAttribute("type") || ""} ${el.getAttribute("name") || ""} ${el.getAttribute("id") || ""} ${el.getAttribute("autocomplete") || ""}`;
    const value = String(el.value ?? "");
    const hit = secrets.some((secret) => value.includes(secret));
    if (!value || (!hit && !named.test(hint))) continue;
    el.setAttribute("data-jf-mask", value);
    el.value = mask;
  }
  if (!secrets.length || typeof doc.createTreeWalker !== "function" || !doc.body) return;
  const walker = doc.createTreeWalker(doc.body, 4);
  /** @type {any[]} */
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  const saved = [];
  for (const node of nodes) {
    const parent = node.parentElement?.tagName;
    if (parent === "SCRIPT" || parent === "STYLE" || parent === "NOSCRIPT") continue;
    let next = String(node.nodeValue ?? "");
    for (const secret of secrets) next = next.split(secret).join(mask);
    if (next !== node.nodeValue) {
      saved.push({ node, value: node.nodeValue });
      node.nodeValue = next;
    }
  }
  if (saved.length) doc.__jfMask = saved;
}

/** Put back what applyMask covered. Playwright runs this in the page. */
export function restoreMask() {
  const doc = /** @type {any} */ (globalThis).document;
  if (!doc?.querySelectorAll) return;
  for (const el of doc.querySelectorAll("[data-jf-mask]")) {
    el.value = el.getAttribute("data-jf-mask") ?? "";
    el.removeAttribute("data-jf-mask");
  }
  const saved = doc.__jfMask;
  if (Array.isArray(saved)) {
    for (const item of saved) item.node.nodeValue = item.value;
    doc.__jfMask = [];
  }
}

/**
 * A trace zip with secret text replaced. An unreadable zip is returned as it
 * is: a broken rewrite would hide the failure. Image entries are kept.
 * @param {Buffer} buffer
 * @param {string[]} [secrets] declared secret values, searched for as text
 * @returns {Buffer}
 */
export function redactZip(buffer, secrets = []) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let entries;
  try {
    entries = readZip(source);
  } catch {
    return source;
  }
  if (!entries) return source;
  try {
    return writeZip(entries.map((entry) => ({ name: entry.name, data: redactEntry(entry.name, entry.data, secrets) })));
  } catch {
    return source;
  }
}

/**
 * Entries of a zip Playwright can write: sizes live in the central directory.
 * Returns null when the bytes are not a zip this reader understands.
 * @param {Buffer} buffer
 * @returns {{name: string, data: Buffer}[] | null}
 */
export function readZip(buffer) {
  const eocd = findEocd(buffer);
  if (eocd < 0) return null;
  const count = buffer.readUInt16LE(eocd + 8);
  let at = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) return null;
  /** @type {{name: string, data: Buffer}[]} */
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL) return null;
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    if (size === 0xffffffff || local === 0xffffffff) return null;
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLen);
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOCAL) return null;
    const localName = buffer.readUInt16LE(local + 26);
    const localExtra = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localName + localExtra;
    if (dataStart + size > buffer.length) return null;
    const compressed = buffer.subarray(dataStart, dataStart + size);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) return null;
    entries.push({ name, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * @param {string} name
 * @param {Buffer} data
 * @param {string[]} secrets
 */
function redactEntry(name, data, secrets) {
  if (BINARY.test(name) || data.includes(0)) return data;
  return Buffer.from(maskTraceText(data.toString("utf8"), secrets));
}

/**
 * @param {string} text
 * @param {string[]} secrets
 */
function maskTraceText(text, secrets) {
  let waitingForFill = false;
  let sincePassword = 0;
  const lines = text.split("\n").map((line) => {
    let next = line;
    if (/"type"\s*:\s*"password"|type=\\?"password\\?"/i.test(next)) {
      waitingForFill = true;
      sincePassword = 0;
    }
    // The fill that follows a password field often names the field only as a
    // selector, so cover fills for a few lines after the field is seen.
    if (waitingForFill && /"method"\s*:\s*"fill"/.test(next)) next = next.replace(/("value"\s*:\s*")([^"\\]*)(")/, `$1${MASK}$3`);
    else if (waitingForFill && /fill\(\\"/.test(next)) next = next.replace(/(fill\(\\")([^"\\]*)(\\")/, `$1${MASK}$3`);
    else if (waitingForFill && ++sincePassword > 40) waitingForFill = false;
    next = maskPasswordObjects(next);
    next = maskText(next);
    return maskKnownSecrets(next, secrets);
  });
  return lines.join("\n");
}

/** Snapshot nodes and HTML attributes that name a password field. @param {string} line */
function maskPasswordObjects(line) {
  let next = line.replace(/\{[^{}]*"(?:type|name|id)"\s*:\s*"(?:password|passwd)"[^{}]*\}/gi, maskValueKeys);
  next = next.replace(/\{[^{}]*"(?:name|id)"\s*:\s*"(?:secret|token|api[_-]?key|authorization)"[^{}]*\}/gi, maskValueKeys);
  next = next.replace(/(type=\\?"password\\?"[^>]{0,500}?value=\\?")([^"\\]*)(\\?")/gi, `$1${MASK}$3`);
  next = next.replace(/(value=\\?")([^"\\]*)(\\?"[^>]{0,500}?type=\\?"password\\?")/gi, `$1${MASK}$3`);
  return next;
}

/** @param {string} object */
function maskValueKeys(object) {
  return object.replace(/("(?:__playwright_value_|value)"\s*:\s*")([^"\\]*)(")/g, `$1${MASK}$3`);
}

/** @param {string} text @param {string[]} secrets */
function maskKnownSecrets(text, secrets) {
  const list = secrets.filter((secret) => typeof secret === "string" && secret.length >= 4).sort((a, b) => b.length - a.length);
  let next = text;
  for (const secret of list) {
    next = next.split(secret).join(MASK);
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) next = next.split(escaped).join(MASK);
  }
  return next;
}

/** @param {string} text */
function maskAssignments(text) {
  const pattern = new RegExp(`((?:["']?)(?:${NAMED}|${LOOSE})(?:["']?)\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s"',}]*)`, "gi");
  return text.replace(pattern, (match, prefix, raw) => {
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    const value = quoted ? raw.slice(1, -1) : raw;
    if (!hideValue(prefix, value)) return match;
    const hidden = quoted ? `${raw[0]}${MASK}${raw[0]}` : MASK;
    return prefix + hidden;
  });
}

/** @param {string} prefix @param {string} value */
function hideValue(prefix, value) {
  if (value.length < 4 || /^(true|false|null)$/i.test(value)) return false;
  const key = prefix.toLowerCase();
  const loose = /secret|token/.test(key) && !/access[_-]?token|refresh[_-]?token/.test(key);
  if (!loose) return true;
  return value.length >= 12 || /\d/.test(value);
}

/** @param {Buffer} buffer */
function findEocd(buffer) {
  const stop = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= stop; i--) if (buffer.readUInt32LE(i) === END) return i;
  return -1;
}

/** @param {{name: string, data: Buffer}[]} entries */
function writeZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const compressed = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, compressed);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
