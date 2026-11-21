// The publish edge cases: two publishers at once, retries, refused upload
// addresses, the file cap, the method rule and the store contract.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { readRunFolder } from "../src/format/run-folder.js";
import { runDigest } from "../src/format/runfile.js";
import { memoryStore } from "../src/publish/dev-server.js";
import { MAX_FILES, MAX_FILE_BYTES, publishHandler } from "../src/publish/publish-handler.js";
import { publishRun } from "../src/publish/publish.js";
import { directService } from "./direct-service.js";
import { recordAllPassed, recorder } from "./helpers.js";

const folder = (files = 0) => {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-edges-")) }));
  run.attach({ name: "you.webm", body: "video", kind: "video", tags: { user: "you" } });
  for (let i = 0; i < files; i++) run.attach({ name: `extra-${i}.txt`, body: `capture ${i}`, kind: "capture" });
  return run.finish();
};
const opening = (dir) => {
  const { raw, digest, digests } = readRunFolder(dir);
  return { run: raw, digest, files: digests };
};
const noWait = async () => {};
/** A service for one test, closed after it. */
async function withService(options, body) {
  const service = await directService(options);
  try {
    return await body(service);
  } finally {
    await service.close();
  }
}
const http = (service, path, init = {}) => fetch(`${service.api}${path}`, init).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));

test("two publishers of one run id with different content: the replaced one is told so at finalize, and the other seals", () =>
  withService({}, async (service) => {
    const { folder: dir, run } = folder();
    const a = opening(dir);
    const b = { ...a, run: { ...a.run, summary: "Another publish." } };
    b.digest = runDigest(b.run, b.files);
    const openedA = await http(service, `/runs/${run.id}`, { method: "PUT", body: JSON.stringify(a) });
    const openedB = await http(service, `/runs/${run.id}`, { method: "PUT", body: JSON.stringify(b) });
    assert.equal(openedA.status, 201);
    assert.equal(openedB.status, 201);
    assert.notEqual(openedA.body.run_id, openedB.body.run_id);
    const late = await http(service, `/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: a.digest }) });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.message, `Run ${run.id} was replaced by another publish before it finished. Publish again.`);
    // B sends its files and seals; A's finalize after that is still told it was replaced.
    for (const { name, upload } of openedB.body.missing) await fetch(upload.url, { method: "PUT", headers: upload.headers, body: readRunFolder(dir).files.get(name) });
    assert.equal((await http(service, `/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: b.digest }) })).body.state, "sealed");
    assert.equal((await http(service, `/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: a.digest }) })).status, 409);
  }));

test("two publishers of the same run at once both end with the one sealed run", () =>
  withService({}, async (service) => {
    const { folder: dir } = folder();
    const [one, two] = await Promise.all([publishRun(dir, { to: service.api, sleep: noWait }), publishRun(dir, { to: service.api, sleep: noWait })]);
    assert.equal(one.state, "sealed");
    assert.equal(two.state, "sealed");
    assert.equal(one.runId, two.runId);
  }));

test("a storage address that refuses every upload with an S3-style XML 403 ends with the plain message", () =>
  withService({ refuse: (name) => (name.endsWith("step-1.png") ? { status: 403 } : null) }, async (service) => {
    const { folder: dir } = folder();
    await assert.rejects(publishRun(dir, { to: service.api, sleep: noWait }), (error) => {
      assert.equal(error.message, "The upload address for step-1.png was refused or has expired. Publish again.");
      return true;
    });
  }));

test("an HTML 403 from a storage address is not reported as blocked before the service", () =>
  withService({ refuse: (name) => (name.endsWith("step-1.png") ? { status: 403, type: "text/html", body: "<html><body>Blocked</body></html>" } : null) }, async (service) => {
    await assert.rejects(publishRun(folder().folder, { to: service.api, sleep: noWait }), /^Error: The upload address for step-1\.png was refused or has expired\. Publish again\.$/);
  }));

test("an upload address that has expired is replaced by the fresh one finalize gives, and a rerun after sends nothing", () => {
  let expired = true;
  return withService({ refuse: (name) => (name.endsWith("step-1.png") && expired ? ((expired = false), { status: 400, body: "<Error><Code>ExpiredToken</Code></Error>" }) : null) }, async (service) => {
    const { folder: dir } = folder();
    const published = await publishRun(dir, { to: service.api, sleep: noWait });
    assert.equal(published.state, "sealed");
    assert.equal(service.seen.storage.filter((s) => s.name.endsWith("step-1.png")).length, 2);
    const again = await publishRun(dir, { to: service.api, sleep: noWait });
    assert.equal(again.state, "sealed");
    assert.deepEqual(again.uploaded, []);
  });
});

test("a file that arrived wrong once is sent again to its fresh target from the 422, and the run seals", () =>
  withService({}, async (service) => {
    const { folder: dir } = folder();
    let first = true;
    const once = async (url, init) => (url.includes("/storage/") && url.endsWith("you.webm") && first ? ((first = false), fetch(url, { ...init, body: "cut" })) : fetch(url, init));
    const published = await publishRun(dir, { to: service.api, fetch: once, sleep: noWait });
    assert.equal(published.state, "sealed");
    assert.deepEqual(service.seen.removed, ["you.webm"]);
  }));

test("a 502, a 504 and a dropped connection are tried again after 1, 2 and 4 seconds", () =>
  withService({}, async (service) => {
    const failures = [new Response("bad gateway", { status: 502 }), new Response("timeout", { status: 504 }), new TypeError("fetch failed")];
    const waits = [];
    const flaky = async (url, init) => {
      if (init.method === "PUT" && url.endsWith(`/runs/${encodeURIComponent(readRunFolder(dir).raw.id)}`) && failures.length) {
        const next = failures.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      return fetch(url, init);
    };
    const { folder: dir } = folder();
    const published = await publishRun(dir, { to: service.api, fetch: flaky, sleep: async (ms) => waits.push(ms) });
    assert.equal(published.state, "sealed");
    assert.deepEqual(waits, [1000, 2000, 4000]);
  }));

test(`a run of more than ${MAX_FILES} files is refused before it exists`, () =>
  withService({}, async (service) => {
    const { folder: dir, run } = folder(MAX_FILES);
    const opened = await http(service, `/runs/${run.id}`, { method: "PUT", body: JSON.stringify(opening(dir)) });
    assert.equal(opened.status, 422);
    assert.equal(opened.body.error.problems[0], `Run ${run.id} has ${MAX_FILES + 3} files. A run can have at most ${MAX_FILES}.`);
    assert.equal(service.seen.created, 0);
  }));

test("the upload target is told each file's declared size at open, and null when finalize hands out a fresh one", () =>
  withService({}, async (service) => {
    const { folder: dir, run } = folder();
    const { files } = readRunFolder(dir);
    const sizes = Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.length]));
    await http(service, `/runs/${run.id}`, { method: "PUT", body: JSON.stringify({ ...opening(dir), sizes }) });
    assert.deepEqual(Object.fromEntries(service.seen.sizes), sizes);
    service.seen.sizes.length = 0;
    await http(service, `/runs/${run.id}/finalize`, { method: "POST" });
    assert.deepEqual(service.seen.sizes.map(([, size]) => size), [null, null, null]);
  }));

test("each route answers another method with 405 method_not_allowed and says what it allows", () =>
  withService({}, async (service) => {
    for (const [path, method, allow] of [["/runs/x", "DELETE", "GET, PUT"], ["/runs/x/files/a.png", "GET", "PUT"], ["/runs/x/finalize", "GET", "POST"]]) {
      const reply = await http(service, path, { method });
      assert.equal(reply.status, 405, `${method} ${path}`);
      assert.equal(reply.body.error.code, "method_not_allowed");
      assert.equal(reply.headers.get("allow"), allow);
    }
  }));

test("the memory store never discards a sealed run", async () => {
  const store = memoryStore();
  const { created, stored } = await store.createRun(null, "r", { digest: "0".repeat(64), sent: /** @type {any} */ ({}), run: /** @type {any} */ ({}), manifest: {}, journey: null, settled: [], unverified: true });
  assert.ok(created);
  await store.seal(null, stored);
  await store.discard(null, stored);
  assert.equal((await store.findRun(null, { run_key: "r" }))?.state, "sealed");
});

test(`finalize reads back ${MAX_FILES} files of 50 MB each in one bounded pass`, async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  const sha = (() => {
    const hash = createHash("sha256");
    for (let i = 0; i < MAX_FILE_BYTES / chunk.length; i++) hash.update(chunk);
    return hash.digest("hex");
  })();
  const names = Array.from({ length: MAX_FILES }, (_, i) => `f${i}.webm`);
  const base = memoryStore();
  const kept = [];
  const store = Object.assign(base, {
    uploadTarget: async () => ({ method: "PUT", url: "https://storage.example.test/x", headers: {} }),
    // Each object is 50 MB, made as it is read, so the test holds none of it.
    readUpload: async () => ({ stream: Readable.from((function* () { for (let i = 0; i < MAX_FILE_BYTES / chunk.length; i++) yield chunk; })()), type: "video/webm" }),
    keepUpload: async (_scope, stored, upload) => {
      for await (const _ of upload.stream);
      kept.push((await upload.verify()).bytes);
      stored.stored.push(upload.name);
    },
  });
  const { handle } = publishHandler(store, { apiUrl: (p) => p, runLink: (id) => id, fileUrl: (id, n) => `${id}/${n}`, fileType: () => "video/webm" });
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-many-")) }));
  const { run: done } = run.finish();
  const manifest = Object.fromEntries(names.map((n) => [n, sha]));
  // Stored straight, as a run with these files: what matters here is finalize.
  await store.createRun(null, done.id, { digest: "0".repeat(64), sent: done, run: done, manifest, journey: null, settled: [], unverified: true });
  const started = Date.now();
  const reply = await handle(null, { method: "POST", path: `/runs/${done.id}/finalize`, headers: {}, body: Readable.from([]) });
  const seconds = (Date.now() - started) / 1000;
  assert.equal(reply.status, 200);
  assert.equal(kept.length, MAX_FILES);
  assert.ok(kept.every((bytes) => bytes === MAX_FILE_BYTES));
  console.log(`finalize read back ${MAX_FILES} x 50 MB in ${seconds.toFixed(1)} s`);
});

test("a file another publish already sent has no target: it is left out of missing, and finalize checks it", async () => {
  const base = memoryStore();
  const sent = new Map();
  const store = Object.assign(base, {
    // Storage already holds you.webm, so no target can be signed for it.
    uploadTarget: async (_scope, _stored, name) => (sent.has(name) ? null : { method: "PUT", url: `https://storage.example.test/${name}`, headers: {} }),
    readUpload: async (_scope, _stored, name) => (sent.has(name) ? { stream: Readable.from([sent.get(name)]), type: name.endsWith(".webm") ? "video/webm" : "image/png" } : null),
    keepUpload: (scope, stored, upload) => base.putFile(scope, stored, upload),
  });
  const { handle } = publishHandler(store, { apiUrl: (p) => p, runLink: (id) => id, fileUrl: (id, n) => `${id}/${n}`, fileType: (n) => (n.endsWith(".webm") ? "video/webm" : "image/png") });
  const { folder: dir, run } = folder();
  sent.set("you.webm", readRunFolder(dir).files.get("you.webm"));
  const opened = await handle(null, { method: "PUT", path: `/runs/${run.id}`, headers: {}, body: Readable.from([JSON.stringify(opening(dir))]) });
  assert.deepEqual(opened.body.missing.map((m) => m.name), ["step-1.png", "step-3.png"]);
  for (const name of ["step-1.png", "step-3.png"]) sent.set(name, readRunFolder(dir).files.get(name));
  const sealed = await handle(null, { method: "POST", path: `/runs/${run.id}/finalize`, headers: {}, body: Readable.from([]) });
  assert.equal(sealed.body.state, "sealed");
});

test("finalize that lists no target, because the last file is already in storage, is tried once more and seals", async () => {
  let finalizes = 0;
  const fake = async (url, init) => {
    if (url.endsWith("/finalize")) return ++finalizes === 1 ? new Response(JSON.stringify({ error: { code: "conflict", message: "still missing", hint: null, problems: [] }, missing: [] }), { status: 409 }) : new Response(JSON.stringify({ run_id: "r", state: "sealed", url: "u" }));
    if (init.method === "PUT" && !url.includes("/files/")) return new Response(JSON.stringify({ run_id: "r", state: "open", missing: [], url: "u" }), { status: 201 });
    return new Response("{}");
  };
  const published = await publishRun(folder().folder, { to: "https://journeys.example.test/v1", fetch: fake, sleep: noWait });
  assert.equal(published.state, "sealed");
  assert.equal(finalizes, 2);
});
