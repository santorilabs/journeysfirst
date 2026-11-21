// The publish protocol as any service answers it: status codes, the one error
// shape, the GET answer, and the rules for uploads and stuck runs. Driven over
// HTTP against the dev server, and directly against publishHandler.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { memoryStore, startDevServer } from "../src/publish/dev-server.js";
import { parseJourney } from "../src/format/format.js";
import { publishHandler } from "../src/publish/publish-handler.js";
import { publishRun } from "../src/publish/publish.js";
import { checkRun } from "../src/format/run-check.js";
import { readRunFolder } from "../src/format/run-folder.js";
import { runDigest, sha256 } from "../src/format/runfile.js";
import { directService } from "./direct-service.js";
import { JOURNEY, VIEWER_SAW, recordAllPassed, recorder } from "./helpers.js";

let server;
before(async () => {
  server = await startDevServer({ token: "secret" });
});
after(() => server.close());

const auth = { authorization: "Bearer secret" };
const folder = (options = {}) => {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-handler-")), ...options }));
  run.attach({ name: "you.webm", body: "video", kind: "video", tags: { user: "you" } });
  return run;
};
const open = (id, body) => fetch(`${server.url}/runs/${id}`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
// What a client sends: run.json as it is on disk, its digest and the file hashes.
const opening = (dir) => {
  const { raw, digest, digests } = readRunFolder(dir);
  return { run: raw, digest, files: digests };
};
const handlerOn = (store) => publishHandler(store, { apiUrl: (p) => p, runLink: (id) => id, fileUrl: (id, n) => `${id}/${n}` });
const put = (handle, id, body) => handle(null, { method: "PUT", path: `/runs/${id}`, headers: {}, body: Readable.from([JSON.stringify(body)]) });
const getRun = (handle, id) => handle(null, { method: "GET", path: `/runs/${id}`, headers: {}, body: Readable.from([]) });
/** A folder whose run.json claims a pass on link-on with no evidence, as a client with looser rules would leave it. */
const unsettledFolder = () => {
  const { folder: dir } = folder().finish();
  const raw = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  raw.steps[1].evidence = [];
  writeFileSync(join(dir, "run.json"), JSON.stringify(raw));
  return { dir, raw, digests: readRunFolder(dir).digests };
};
const isErrorShape = (body) => {
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "hint", "message", "problems"]);
  assert.ok(Array.isArray(body.error.problems));
};

test("every error has the one shape", async () => {
  const unauthorized = await fetch(`${server.url}/runs/x`);
  assert.equal(unauthorized.status, 401);
  isErrorShape(await unauthorized.json());
  assert.equal((await (await fetch(`${server.url}/runs/x`, { headers: auth })).json()).error.code, "not_found");
  const nowhere = await fetch(`${server.url}/elsewhere`, { headers: auth });
  assert.equal(nowhere.status, 404);
  isErrorShape(await nowhere.json());
  const finalize = await fetch(`${server.url}/runs/never-opened/finalize`, { method: "POST", headers: auth });
  assert.equal(finalize.status, 404);
  isErrorShape(await finalize.json());
});

/** A raw GET, so the path and Host header reach the dev server exactly as written. */
function rawGet(url, path, headers = {}) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    request({ host: hostname, port, path, headers: { ...auth, ...headers } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on("error", reject).end();
  });
}

test("a file path that is not valid percent-encoding gets the protocol's bad_input, and the server keeps running", async () => {
  for (const path of ["/runs/%E0%A4/files/x", "/runs/x/files/%E0%A4", "/runs/%E0%A4"]) {
    const bad = await rawGet(server.url, path);
    assert.equal(bad.status, 422, path);
    isErrorShape(bad.body);
    assert.equal(bad.body.error.message, "The path is not valid percent-encoding.");
  }
  assert.equal((await rawGet(server.url, "/runs/x")).status, 404);
});

test("the dev server bound to this machine refuses a request for another host name (DNS rebinding)", async () => {
  const port = new URL(server.url).port;
  const rebound = await rawGet(server.url, "/runs/x", { host: `attacker.example.test:${port}` });
  assert.equal(rebound.status, 403);
  isErrorShape(rebound.body);
  assert.equal(rebound.body.error.code, "forbidden");
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) assert.equal((await rawGet(server.url, "/runs/x", { host })).status, 404, host);
  const open = await startDevServer({ host: "0.0.0.0" });
  try {
    assert.equal((await rawGet(`http://127.0.0.1:${new URL(open.url).port}`, "/runs/x", { host: "dev.example.test" })).status, 404);
  } finally {
    await open.close();
  }
});

test("every problem with an open comes back in one 422", async () => {
  const { run, digest, files } = opening(folder().finish().folder);
  const response = await open("another-id", { run, digest: "0".repeat(64), files: { ...files, "extra.png": "zz" } });
  assert.equal(response.status, 422);
  const body = await response.json();
  isErrorShape(body);
  assert.equal(body.error.code, "bad_input");
  const all = body.error.problems.join("\n");
  assert.match(all, /run.id is "[^"]+", but the path says "another-id"/);
  assert.match(all, /the sha256 of extra.png must be 64 lowercase hex/);
  assert.match(all, /files lists/);
  assert.ok(digest);
});

test("a run that carries a secret value is refused, and nothing is kept", async () => {
  const recorded = folder();
  recorded.value("phone", "+1 555 0142", { secret: true });
  const { folder: dir, run } = recorded.finish();
  assert.doesNotMatch(readFileSync(join(dir, "run.json"), "utf8"), /555 0142/);
  // An old client that wrote the value anyway:
  const leaked = { ...run, values: { phone: { value: "+1 555 0142", secret: true } } };
  const { digests } = readRunFolder(dir);
  const response = await open(run.id, { run: leaked, digest: runDigest(leaked, digests), files: digests });
  assert.equal(response.status, 422);
  const { error } = await response.json();
  assert.match(error.message, /values\.phone is secret, so it must not carry its value/);
  assert.match(error.hint, /current journeysfirst/);
  assert.equal(server.runs.has(run.id), false);
});

test("the reply gives the server's run id, and GET answers by that id or by the run's own id", async () => {
  const failing = folder();
  failing.check("viewer-blocked", { by: "viewer", verdict: "failed", proof: "Opened the link again.", evidence: [VIEWER_SAW], reason: "The link still works." });
  const { folder: dir, run } = failing.finish();
  const published = await publishRun(dir, { to: server.url, token: "secret" });
  assert.match(published.runId, /^[0-9a-f-]{36}$/);
  assert.equal(published.url, `${server.url}/runs/${published.runId}`);

  const byId = await (await fetch(`${server.url}/runs/${published.runId}`, { headers: auth })).json();
  const byKey = await (await fetch(`${server.url}/runs/${run.id}`, { headers: auth })).json();
  assert.deepEqual(byId, byKey);
  assert.equal(Object.keys(byId)[0], "result");
  assert.equal(byId.result, "failed");
  assert.equal(byId.state, "sealed");
  assert.equal(Object.keys(byId).at(-1), "url");
  assert.equal(byId.run_id, published.runId);
  assert.deepEqual(byId.failed.map((f) => [f.step, f.id, f.verdict, f.reason]), [[7, "viewer-blocked", "failed", "The link still works."]]);
  assert.deepEqual(byId.failed[0].evidence, [VIEWER_SAW]);
  assert.equal(byId.passed_count, 2);
  assert.equal(byId.checks_count, 3);

  // The file links in the answer work.
  const shot = (await fetch(`${server.url}/runs/${run.id}`, { headers: auth }).then((r) => r.json())).videos[0].file_url;
  assert.equal(await (await fetch(shot, { headers: auth })).text(), "video");
});

test("a claimed pass with no evidence is answered as not_checked, claimed passed", async () => {
  const { folder: dir } = folder().finish();
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  run.steps[1].evidence = [];
  writeFileSync(join(dir, "run.json"), JSON.stringify(run));
  await publishRun(dir, { to: server.url, token: "secret" });
  const answer = await (await fetch(`${server.url}/runs/${run.id}`, { headers: auth })).json();
  assert.equal(answer.result, "not_fully_checked");
  assert.deepEqual(answer.not_checked.map((c) => [c.id, c.verdict, c.claimed]), [["link-on", "not_checked", "passed"]]);
});

test("a run the service settles but the client did not is published, stored as sent, and the service's verdict stands", async () => {
  const store = memoryStore();
  const { handle } = handlerOn(store);
  const { raw, digests } = unsettledFolder();
  // The client's rules accepted the claimed pass, so it digested run.json as it is.
  const reply = await put(handle, raw.id, { run: raw, digest: runDigest(raw, digests), files: digests });
  assert.equal(reply.status, 201);
  const stored = store.runs.get(raw.id);
  assert.equal(JSON.stringify(stored.sent), JSON.stringify(raw));
  assert.equal(stored.digest, runDigest(raw, digests));
  assert.equal(stored.run.steps[1].verdict, "not_checked");
  const answer = (await getRun(handle, raw.id)).body;
  assert.equal(answer.result, "not_fully_checked");
  assert.deepEqual(answer.not_checked.map((c) => [c.id, c.verdict, c.claimed]), [["link-on", "not_checked", "passed"]]);
  // The same folder again is the same run, not a conflict.
  const again = await put(handle, raw.id, { run: raw, digest: runDigest(raw, digests), files: digests });
  assert.equal(again.status, 200);
  assert.equal(again.body.run_id, stored.id);
});

test("an older client that sends the settled run and its digest is still accepted", async () => {
  const store = memoryStore();
  const heard = [];
  const createRun = store.createRun;
  store.createRun = async (scope, key, record) => {
    heard.push(record.settled);
    return createRun(scope, key, record);
  };
  const { handle } = handlerOn(store);
  const { raw, digests } = unsettledFolder();
  const { run: settled } = checkRun(raw);
  assert.equal(settled.steps[1].claimed, "passed");
  const reply = await put(handle, raw.id, { run: settled, digest: runDigest(settled, digests), files: digests });
  assert.equal(reply.status, 201);
  assert.deepEqual(heard, [["link-on"]]);
  assert.deepEqual(store.runs.get(raw.id).sent, settled);
});

test("a run whose bytes changed after it was digested is refused with the digest message", async () => {
  const { handle } = handlerOn(memoryStore());
  const { raw, digests } = unsettledFolder();
  const digest = runDigest(raw, digests);
  const changed = await put(handle, raw.id, { run: { ...raw, summary: "Edited after digesting." }, digest, files: digests });
  assert.equal(changed.status, 422);
  assert.deepEqual(changed.body.error.problems, ["digest doesn't match the run and its files. It is runDigest(run, files) from journeysfirst."]);
  const file = await put(handle, raw.id, { run: raw, digest, files: { ...digests, "step-1.png": "f".repeat(64) } });
  assert.equal(file.status, 422);
  assert.match(file.body.error.message, /digest doesn't match/);
});

test("a stored run reads by its stored verdict, never by the current rules", async () => {
  const store = memoryStore();
  const { handle } = handlerOn(store);
  const { raw } = unsettledFolder();
  // A run stored when the rules still accepted this claimed pass.
  await store.createRun(null, raw.id, { digest: "0".repeat(64), sent: raw, run: raw, manifest: {}, journey: null, settled: [], unverified: true });
  const answer = (await getRun(handle, raw.id)).body;
  assert.equal(answer.result, "passed");
  assert.deepEqual(answer.not_checked, []);
});

test("a failed action is listed in failed, so a failed run never has an empty list", async () => {
  const recorded = folder();
  recorded.step("Turn off link sharing.", { by: "you", status: "failed", cause: "product", reason: "The toggle did nothing." });
  const { folder: dir, run } = recorded.finish();
  await publishRun(dir, { to: server.url, token: "secret" });
  const answer = await (await fetch(`${server.url}/runs/${run.id}`, { headers: auth })).json();
  assert.equal(answer.result, "failed");
  assert.deepEqual(answer.failed.map((f) => [f.step, f.says, f.status, f.cause]), [[5, "Turn off link sharing.", "failed", "product"]]);
});

test("a run named like a uuid is found by its own id when no server id matches", async () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const { folder: dir } = folder({ id }).finish();
  await publishRun(dir, { to: server.url, token: "secret" });
  const answer = await (await fetch(`${server.url}/runs/${id}`, { headers: auth })).json();
  assert.equal(answer.state, "sealed");
  assert.notEqual(answer.run_id, id);
});

test("finalize with a file missing is a conflict that lists the file and where to send it", async () => {
  const { run, digest, files } = opening(folder().finish().folder);
  assert.equal((await open(run.id, { run, digest, files })).status, 201);
  const response = await fetch(`${server.url}/runs/${run.id}/finalize`, { method: "POST", headers: auth });
  assert.equal(response.status, 409);
  const body = await response.json();
  isErrorShape(body);
  assert.deepEqual(body.missing.map((m) => m.name), ["step-1.png", "step-3.png", "you.webm"]);
  assert.equal(body.missing[0].upload.url, `${server.url}/runs/${run.id}/files/step-1.png`);
});

test("a file that is not in the run, or doesn't match its sha256, is refused", async () => {
  const dir = folder().finish().folder;
  const { run, digest, files } = opening(dir);
  await open(run.id, { run, digest, files });
  const put = (name, body, headers = {}) => fetch(`${server.url}/runs/${run.id}/files/${name}`, { method: "PUT", headers: { ...auth, ...headers }, body });
  const stranger = await put("other.png", "x");
  assert.equal(stranger.status, 422);
  assert.match((await stranger.json()).error.message, /other.png is not part of run/);
  const wrong = await put("step-1.png", "not the screenshot");
  assert.equal(wrong.status, 422);
  assert.match((await wrong.json()).error.message, /step-1.png doesn't match its sha256/);
  const header = await put("step-1.png", readFileSync(join(dir, "step-1.png")), { "x-content-sha256": "f".repeat(64) });
  assert.equal(header.status, 422);
});

test("an open run that never sealed is replaced at once by the same run id with other content", async () => {
  const store = memoryStore();
  const { handle } = handlerOn(store);
  const { folder: dir, run } = folder().finish();
  assert.equal((await put(handle, run.id, opening(dir))).status, 201);
  const first = store.runs.get(run.id).id;
  writeFileSync(join(dir, "step-1.png"), "changed");
  const changed = opening(dir);
  const replaced = await put(handle, run.id, changed);
  assert.equal(replaced.status, 201);
  assert.equal(store.runs.get(run.id).digest, changed.digest);
  assert.notEqual(replaced.body.run_id, first);
});

test("a sealed run never changes: different content is always a conflict", async () => {
  const { folder: dir } = folder().finish();
  await publishRun(dir, { to: server.url, token: "secret" });
  writeFileSync(join(dir, "step-1.png"), "changed");
  await assert.rejects(publishRun(dir, { to: server.url, token: "secret" }), /Conflict.*already published with different content[\s\S]*Rename the run folder/);
});

test("uploads are hashed as they stream, and stop at the size cap", async () => {
  const store = memoryStore();
  const { handle } = publishHandler(store, { apiUrl: (p) => p, runLink: (id) => id, fileUrl: (id, n) => `${id}/${n}`, maxFileBytes: 10 });
  const big = Buffer.alloc(32, 1);
  const run = folder();
  run.attach({ name: "big.webm", body: big, kind: "video" });
  const { folder: dir } = run.finish();
  const opened = await handle(null, { method: "PUT", path: `/runs/${run.id}`, headers: {}, body: Readable.from([JSON.stringify(opening(dir))]) });
  assert.equal(opened.status, 201);
  // A body with no length is cut off as it streams, in small chunks.
  const chunks = Array.from({ length: 8 }, () => Buffer.alloc(4, 1));
  const reply = await handle(null, { method: "PUT", path: `/runs/${run.id}/files/big.webm`, headers: {}, body: Readable.from(chunks) });
  assert.equal(reply.status, 413);
  assert.equal(reply.body.error.code, "too_large");
  // The rest of the body is never read, so the connection must not carry another request.
  assert.equal(reply.headers?.connection, "close");
  assert.deepEqual(store.runs.get(run.id).stored, []);
  // A body that says its length is refused before it is read.
  const told = await handle(null, { method: "PUT", path: `/runs/${run.id}/files/big.webm`, headers: { "content-length": "32" }, body: Readable.from([big]) });
  assert.equal(told.status, 413);
  // Small enough and matching: stored.
  const small = await handle(null, { method: "PUT", path: `/runs/${run.id}/files/step-1.png`, headers: {}, body: Readable.from([readFileSync(join(dir, "step-1.png"))]) });
  assert.equal(small.status, 200);
  assert.equal(sha256(store.files.get(store.runs.get(run.id).id).get("step-1.png")), opening(dir).files["step-1.png"]);
});

test("verify gives the same answer each time it is asked", async () => {
  const store = memoryStore();
  const answers = [];
  const putFile = store.putFile;
  store.putFile = async (scope, stored, upload) => {
    await putFile(scope, stored, upload);
    answers.push(await upload.verify(), await upload.verify());
  };
  const { handle } = publishHandler(store, { apiUrl: (p) => p, runLink: (id) => id, fileUrl: (id, n) => `${id}/${n}` });
  const { folder: dir, run } = folder().finish();
  await handle(null, { method: "PUT", path: `/runs/${run.id}`, headers: {}, body: Readable.from([JSON.stringify(opening(dir))]) });
  const reply = await handle(null, { method: "PUT", path: `/runs/${run.id}/files/step-1.png`, headers: {}, body: Readable.from([readFileSync(join(dir, "step-1.png"))]) });
  assert.equal(reply.status, 200);
  assert.deepEqual(answers, [{ bytes: 8 }, { bytes: 8 }]);
});

test("the journey sent with a run is checked too", async () => {
  const { run, digest, files } = opening(folder().finish().folder);
  const journey = parseJourney(JOURNEY);
  const response = await open(run.id, { run, digest, files, journey: { ...journey, steps: [] } });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error.problems.join("\n"), /^journey: /m);
});

test("with upload targets, bytes go straight to storage without the token, and finalize checks each one before seal", async () => {
  const service = await directService();
  try {
    const { folder: dir, run } = folder().finish();
    const published = await publishRun(dir, { to: service.api, token: "secret" });
    assert.equal(published.state, "sealed");
    assert.deepEqual(service.seen.storage.map((s) => s.authorization), [null, null, null]);
    // The type each object was stored as comes from the service, not from the client.
    assert.deepEqual([...service.objects.values()].map((o) => o.type).sort(), ["image/png", "image/png", "video/webm"]);
    assert.deepEqual(store(service, run.id).stored.sort(), ["step-1.png", "step-3.png", "you.webm"]);
  } finally {
    await service.close();
  }
});
const store = (service, runKey) => service.store.runs.get(runKey);

test("a file type the service does not take is refused before the run exists, with every problem at once", async () => {
  const service = await directService();
  try {
    const recorded = folder();
    recorded.attach({ name: "agent-fetch.html", body: "<p>hi</p>", kind: "capture" });
    const { folder: dir, run } = recorded.finish();
    const { digest, digests } = readRunFolder(dir);
    const sizes = Object.fromEntries(Object.keys(digests).map((name) => [name, name === "you.webm" ? 60 * 1024 * 1024 : 1]));
    const response = await fetch(`${service.api}/runs/${run.id}`, { method: "PUT", body: JSON.stringify({ run: JSON.parse(readFileSync(join(dir, "run.json"), "utf8")), digest, files: digests, sizes }) });
    assert.equal(response.status, 422);
    const { error } = await response.json();
    assert.deepEqual(error.problems, ["agent-fetch.html can't be uploaded.", "you.webm is over 50 MB."]);
    assert.equal(service.seen.created, 0);
  } finally {
    await service.close();
  }
});

test("a file that did not arrive as sent is removed and comes back with a fresh target; the run with the file fixed then publishes", async () => {
  const service = await directService();
  try {
    const { folder: dir, run } = folder().finish();
    // A client that sends the wrong bytes for one file and the wrong type for another.
    const tamper = async (url, init) => {
      if (url.includes("/storage/") && url.endsWith("step-1.png")) init = { ...init, body: "not the screenshot" };
      if (url.includes("/storage/") && url.endsWith("you.webm")) init = { ...init, headers: { ...init.headers, "content-type": "text/plain" } };
      return fetch(url, init);
    };
    await assert.rejects(publishRun(dir, { to: service.api, token: "secret", fetch: tamper }), (error) => {
      assert.match(error.message, /failed with 422/);
      assert.match(error.message, /^- step-1.png doesn't match its sha256\.$/m);
      assert.match(error.message, /^- you.webm was sent as text\/plain, not video\/webm\. Send it with the headers its upload target gives\.$/m);
      return true;
    });
    // publish sent each one once more to its fresh target, and it was refused again.
    assert.deepEqual(service.seen.removed.sort(), ["step-1.png", "step-1.png", "you.webm", "you.webm"]);
    assert.equal(store(service, run.id).state, "open");
    // The same folder again: the good file is not sent again, the two bad ones go to fresh targets.
    const before = service.seen.storage.length;
    const again = await publishRun(dir, { to: service.api, token: "secret" });
    assert.equal(again.state, "sealed");
    assert.deepEqual(again.uploaded.sort(), ["step-1.png", "you.webm"]);
    assert.equal(service.seen.storage.length - before, 2);
  } finally {
    await service.close();
  }
});

test("a rerun after the files went up but before finalize sends nothing again", async () => {
  const service = await directService();
  try {
    const { folder: dir, run } = folder().finish();
    const noFinalize = async (url, init) => (url.endsWith("/finalize") ? new Response("{}", { status: 500 }) : fetch(url, init));
    await assert.rejects(publishRun(dir, { to: service.api, token: "secret", fetch: noFinalize }));
    const again = await publishRun(dir, { to: service.api, token: "secret" });
    assert.equal(again.state, "sealed");
    assert.deepEqual(again.uploaded, []);
    assert.equal(store(service, run.id).state, "sealed");
  } finally {
    await service.close();
  }
});
