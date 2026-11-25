import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { test } from "node:test";
import { MASK, applyMask, maskText, readZip, redactZip, restoreMask } from "../src/runner/mask.js";

test("obvious secret patterns are covered and ordinary text is kept", () => {
  const key = "AKIAIOSFODNN7EXAMPLE";
  const covered = maskText(`Bearer abcdefghijklmnop ${key} password=hunter2 "api_key":"abcd1234" token=abcdefghijkl secret: true code 481516`);
  assert.doesNotMatch(covered, /abcdefghijklmnop|AKIAIOSFODNN7EXAMPLE|hunter2|abcd1234|abcdefghijkl/);
  assert.match(covered, /Bearer ••••/);
  assert.match(covered, /password=/);
  assert.match(covered, /secret: true/);
  assert.match(covered, /481516/);
  const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
  assert.equal(maskText(pem).includes("BEGIN"), false);
});

test("a password field and a secret in the text are covered, then put back", () => {
  const password = field({ type: "password", name: "password" }, "hunter2");
  const empty = field({ type: "password", name: "password" }, "");
  const note = field({ type: "text", name: "note" }, "hello");
  const apiKey = field({ type: "text", name: "api_key" }, "abcd1234");
  const sentence = { nodeValue: "code s3cr3t-value here", parentElement: { tagName: "P" } };
  const script = { nodeValue: "s3cr3t-value", parentElement: { tagName: "SCRIPT" } };
  globalThis.document = fakeDoc([password, empty, note, apiKey], [sentence, script]);
  try {
    applyMask({ secrets: ["s3cr3t-value"], mask: MASK });
    assert.equal(password.value, MASK);
    assert.equal(password.getAttribute("data-jf-mask"), "hunter2");
    assert.equal(empty.value, "");
    assert.equal(note.value, "hello");
    assert.equal(apiKey.value, MASK);
    assert.equal(sentence.nodeValue, `code ${MASK} here`);
    assert.equal(script.nodeValue, "s3cr3t-value", "a script is not visible, so it is left for the page to run");
    restoreMask();
    assert.equal(password.value, "hunter2");
    assert.equal(password.getAttribute("data-jf-mask"), null);
    assert.equal(sentence.nodeValue, "code s3cr3t-value here");
  } finally {
    delete globalThis.document;
  }
});

test("a trace zip loses password values and declared secrets, and keeps images", () => {
  const trace = [
    JSON.stringify({ method: "setContent", params: { html: '<input type="password" name="password" value="hunter2"><p>token=abcdefghijkl</p>' } }),
    JSON.stringify({ snapshot: ["INPUT", { __playwright_value_: "hunter2", type: "password", name: "password", value: "hunter2" }] }),
    JSON.stringify({ method: "fill", params: { selector: "#pw", value: "s3cr3t-value" } }),
    JSON.stringify({ message: '  fill("s3cr3t-value")' }),
    "network only-in-the-trace",
  ].join("\n");
  const image = Buffer.from([0xff, 0xd8, 0xff, 0, ...Buffer.from("s3cr3t-value")]);
  const zip = playwrightZip([
    { name: "trace.trace", data: trace },
    { name: "shot.jpeg", data: image },
  ]);
  const redacted = redactZip(zip, ["only-in-the-trace"]);
  const entries = readZip(redacted);
  const text = entries.find((entry) => entry.name === "trace.trace").data.toString("utf8");
  assert.doesNotMatch(text, /hunter2|s3cr3t-value|abcdefghijkl/);
  assert.match(text, /token=/);
  assert.deepEqual(entries.find((entry) => entry.name === "shot.jpeg").data, image);
  assert.equal(redactZip(Buffer.from("zip bytes")).toString(), "zip bytes");
});

/** @param {Record<string, string>} attrs @param {string} value */
function field(attrs, value) {
  return {
    value,
    attrs: { ...attrs },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    setAttribute(name, next) {
      this.attrs[name] = next;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
}

/** @param {ReturnType<typeof field>[]} inputs @param {{nodeValue: string, parentElement: {tagName: string}}[]} texts */
function fakeDoc(inputs, texts) {
  return {
    body: {},
    querySelectorAll(selector) {
      if (selector === "input, textarea") return inputs;
      if (selector === "[data-jf-mask]") return inputs.filter((el) => el.getAttribute("data-jf-mask") !== null);
      return [];
    },
    createTreeWalker() {
      let index = 0;
      return { nextNode() { return texts[index++] ?? null; } };
    },
  };
}

/**
 * A zip with sizes only in the central directory, as Playwright writes a trace.
 * @param {{name: string, data: string|Buffer}[]} entries
 */
function playwrightZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    locals.push(local, compressed, descriptor);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
