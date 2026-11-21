import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startDevServer } from "../src/publish/dev-server.js";
import { parseJourney } from "../src/format/format.js";
import { errorText, publishRun } from "../src/publish/publish.js";
import { checkRun } from "../src/format/run-check.js";
import { addFindings, readRunFolder } from "../src/format/run-folder.js";
import { runDigest } from "../src/format/runfile.js";
import { JOURNEY, findings, recordAllPassed, recorder } from "./helpers.js";

let server;

before(async () => {
  server = await startDevServer({ token: "secret" });
});
after(() => server.close());

/** A run folder with two screenshots and one video. */
function runFolder() {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-pub-")) }));
  run.attach({ name: "you.webm", body: "video", kind: "video", tags: { user: "you" } });
  return run.finish().folder;
}

const publish = (folder, extra = {}) => publishRun(folder, { to: server.url, token: "secret", ...extra });

test("publish uploads every file and seals the run", async () => {
  const folder = runFolder();
  const result = await publish(folder);
  assert.equal(result.state, "sealed");
  assert.deepEqual(result.uploaded.sort(), ["step-1.png", "step-3.png", "you.webm"]);
  assert.equal(server.runs.get(result.id).state, "sealed");
});

test("publish leaves a Playwright trace out, from the files and from the run it sends", async () => {
  const run = recordAllPassed(recorder({ outputDir: mkdtempSync(join(tmpdir(), "jf-pub-")) }));
  run.attach({ name: "you.webm", body: "video", kind: "video", tags: { user: "you" } });
  run.attach({ name: "trace.zip", body: "trace", kind: "trace" });
  const folder = run.finish().folder;
  const result = await publish(folder);
  assert.equal(result.state, "sealed");
  assert.deepEqual(result.uploaded.sort(), ["step-1.png", "step-3.png", "you.webm"]);
  const stored = server.runs.get(result.id);
  assert.deepEqual(stored.sent.media, [{ file: "you.webm", kind: "video", tags: { user: "you" } }]);
  assert.equal((await publish(folder)).digest, result.digest, "publishing again sends the same run");
});

test("a run with findings publishes with them, and its digest covers them", async () => {
  const folder = runFolder();
  const plain = readRunFolder(folder).digest;
  addFindings(folder, { findings: findings() });
  const result = await publish(folder);
  assert.equal(result.state, "sealed");
  assert.notEqual(result.digest, plain);
  const stored = server.runs.get(result.id);
  assert.deepEqual(stored.sent.findings, findings());
  assert.equal(stored.run.result, "passed", "the service's verdict is the same with findings");
});

test("publishing the same run again returns the existing run and uploads nothing", async () => {
  const folder = runFolder();
  const first = await publish(folder);
  const before = server.uploads.length;
  const again = await publish(folder);
  assert.equal(again.state, "sealed");
  assert.equal(again.digest, first.digest);
  assert.deepEqual(again.uploaded, []);
  assert.equal(server.uploads.length, before);
});

test("the same run id with different content is a conflict", async () => {
  const folder = runFolder();
  await publish(folder);
  writeFileSync(join(folder, "step-3.png"), "changed");
  await assert.rejects(publish(folder), /Conflict/);
});

test("an interrupted publish resumes and uploads only what is missing", async () => {
  const folder = runFolder();
  let uploads = 0;
  const flaky = async (url, init) => {
    // The connection drops at the second file and stays down, past every retry.
    if (url.includes("/files/") && ++uploads >= 2) throw new Error("network dropped");
    return fetch(url, init);
  };
  await assert.rejects(publish(folder, { fetch: flaky, sleep: async () => {} }), /network dropped/);

  const resumed = await publish(folder);
  assert.equal(resumed.state, "sealed");
  assert.equal(resumed.uploaded.length, 2);
  assert.equal(resumed.skipped.length, 1);
});

test("a run folder with a missing file is refused before anything is sent", async () => {
  const folder = runFolder();
  rmSync(join(folder, "step-1.png"));
  await assert.rejects(publish(folder), /step-1\.png is missing/);
});

test("with the journey, the service checks the steps; without it the run is unverified", async () => {
  const journey = parseJourney(JOURNEY);
  const checked = await publish(runFolder(), { journey });
  assert.equal(checked.unverified, false);
  assert.equal(server.runs.get(checked.id).unverified, false);
  const unchecked = await publish(runFolder());
  assert.equal(unchecked.unverified, true);
  assert.equal(server.runs.get(unchecked.id).unverified, true);
});

test("a run that dropped or invented a check is refused when the journey is known", async () => {
  const folder = runFolder();
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
  run.steps[6] = { ...run.steps[6], check: "The viewer is happy.", id: "viewer-happy" };
  run.verified[2] = "The viewer is happy.";
  writeFileSync(join(folder, "run.json"), JSON.stringify(run));
  await assert.rejects(publish(folder, { journey: parseJourney(JOURNEY) }), /step 7 should be the check "The viewer can no longer see "Q3 plan"\." with id "viewer-blocked"/);

  // A client that skips its own check is refused by the service too.
  const { digest, digests } = readRunFolder(folder);
  const response = await fetch(`${server.url}/runs/${run.id}`, {
    method: "PUT",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify({ digest, run, files: digests, journey: parseJourney(JOURNEY) }),
  });
  assert.equal(response.status, 422);
  const { error } = await response.json();
  assert.equal(error.code, "bad_input");
  assert.match(error.problems.join("\n"), /should be the check/);
});

test("a claimed pass with no evidence is published as not_checked, not refused", async () => {
  const folder = runFolder();
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
  run.steps[1].evidence = [];
  writeFileSync(join(folder, "run.json"), JSON.stringify(run));
  const { settled, raw, digest } = readRunFolder(folder);
  assert.deepEqual(settled, ["link-on"]);
  assert.deepEqual(raw, run);
  const result = await publish(folder);
  assert.equal(result.digest, digest);
  const stored = server.runs.get(result.id);
  assert.deepEqual(stored.sent, run);
  assert.equal(stored.run.steps[1].verdict, "not_checked");
  assert.equal(stored.run.steps[1].claimed, "passed");
  assert.equal(stored.run.result, "not_fully_checked");
  const again = await publish(folder);
  assert.equal(again.digest, result.digest);
  assert.deepEqual(again.uploaded, []);
});

test("a recorder-written folder digests the same settled or not, so an older service accepts it", () => {
  const { raw, run, digest, digests } = readRunFolder(runFolder());
  assert.deepEqual(raw, run);
  // An older service settles the run, then digests what it settled.
  assert.equal(runDigest(checkRun(raw).run, digests), digest);
  assert.equal(runDigest(raw, digests), digest);
});

test("the open reply gives each missing file its upload target", async () => {
  const folder = runFolder();
  const { run, digest, digests } = readRunFolder(folder);
  const response = await fetch(`${server.url}/runs/${run.id}`, {
    method: "PUT",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify({ digest, run, files: digests }),
  });
  const { missing } = await response.json();
  assert.deepEqual(missing.map((m) => m.name), ["step-1.png", "step-3.png", "you.webm"]);
  assert.deepEqual(missing[0].upload, {
    method: "PUT",
    url: `${server.url}/runs/${run.id}/files/step-1.png`,
    headers: { "x-content-sha256": digests["step-1.png"] },
  });
});

/**
 * A fetch in front of the dev server that changes the open reply's missing
 * list, and passes uploads sent elsewhere on to the dev server's own route.
 */
function rewritingFetch(rewrite) {
  const sent = [];
  const wrapped = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers });
    const storage = url.match(/^https:\/\/storage\.example\.test\/([^/]+)\/([^?]+)/);
    if (storage) {
      return fetch(`${server.url}/runs/${storage[1]}/files/${storage[2]}`, { method: "PUT", headers: { authorization: "Bearer secret", "x-content-sha256": init.headers["x-content-sha256"] }, body: init.body });
    }
    const response = await fetch(url, init);
    if (init.method !== "PUT" || url.includes("/files/")) return response;
    const body = await response.json();
    return new Response(JSON.stringify({ ...body, missing: body.missing.map(rewrite) }), { status: response.status });
  };
  return { sent, fetch: wrapped };
}

test("publish sends each file where the service says, with its method and headers, and keeps the token to the service", async () => {
  const folder = runFolder();
  const { sent, fetch: wrapped } = rewritingFetch(({ name, upload }) => ({
    name,
    upload: { method: "PUT", url: `https://storage.example.test/${upload.url.split("/runs/")[1].split("/")[0]}/${name}?sig=abc`, headers: { ...upload.headers, "x-storage-sig": "abc" } },
  }));
  const result = await publish(folder, { fetch: wrapped });
  assert.equal(result.state, "sealed");
  const uploads = sent.filter((s) => s.url.startsWith("https://storage.example.test/"));
  assert.deepEqual(uploads.map((s) => s.url.split("?")[0].split("/").pop()).sort(), ["step-1.png", "step-3.png", "you.webm"]);
  for (const upload of uploads) {
    assert.equal(upload.method, "PUT");
    assert.equal(upload.headers["x-storage-sig"], "abc");
    assert.match(upload.headers["x-content-sha256"], /^[0-9a-f]{64}$/);
    assert.equal(upload.headers.authorization, undefined);
  }
});

test("a service that lists missing files by name gets them on its files route", async () => {
  const folder = runFolder();
  const { sent, fetch: wrapped } = rewritingFetch(({ name }) => name);
  const result = await publish(folder, { fetch: wrapped });
  assert.equal(result.state, "sealed");
  const uploads = sent.filter((s) => s.url.includes("/files/"));
  assert.equal(uploads.length, 3);
  for (const upload of uploads) {
    assert.ok(upload.url.startsWith(`${server.url}/runs/${result.id}/files/`));
    assert.equal(upload.headers.authorization, "Bearer secret");
  }
});

test("a busy service (503) is tried again after its Retry-After", async () => {
  const waits = [];
  let busy = 2;
  const flaky = async (url, init) => {
    if (url.includes("/files/") && busy-- > 0) return new Response(JSON.stringify({ error: { code: "unavailable", message: "Busy.", hint: null, problems: [] } }), { status: 503, headers: { "retry-after": "2" } });
    return fetch(url, init);
  };
  const result = await publish(runFolder(), { fetch: flaky, sleep: async (ms) => waits.push(ms) });
  assert.equal(result.state, "sealed");
  assert.deepEqual(waits, [2000, 2000]);
});

test("a refused token prints what the service said and what to do", async () => {
  const revoked = async () => new Response(JSON.stringify({ error: { code: "unauthorized", message: "This key was revoked.", hint: "Ask for a new key.", problems: [] } }), { status: 401 });
  await assert.rejects(publish(runFolder(), { fetch: revoked }), { message: "The service refused the token: This key was revoked.\nAsk for a new key.\nThe token is read from JOURNEYSFIRST_TOKEN." });
  const bare = async () => new Response("", { status: 401 });
  await assert.rejects(publish(runFolder(), { fetch: bare }), { message: "The service refused the token: it is missing or wrong.\nThe token is read from JOURNEYSFIRST_TOKEN." });
});

test("errors print the message, each problem and the hint; an old string error still prints", () => {
  assert.equal(errorText({ error: { code: "bad_input", message: "Run x has 2 problems: a", hint: "Fix every problem.", problems: ["a", "b"] } }, ""), "Run x has 2 problems: a\n- a\n- b\nFix every problem.");
  assert.equal(errorText({ error: { code: "bad_input", message: "a", hint: null, problems: ["a"] } }, ""), "a");
  assert.equal(errorText({ error: "Old style." }, ""), "Old style.");
  assert.equal(errorText({}, "fallback"), "fallback");
});

test("a refused run prints every problem", async () => {
  const folder = runFolder();
  const run = JSON.parse(readFileSync(join(folder, "run.json"), "utf8"));
  run.steps[6] = { ...run.steps[6], check: "The viewer is happy.", id: "viewer-happy" };
  run.verified[2] = "The viewer is happy.";
  writeFileSync(join(folder, "run.json"), JSON.stringify(run));
  // Sent straight to the service, as a client that skips its own check would.
  const { digest, digests } = readRunFolder(folder);
  const send = (body) => fetch(`${server.url}/runs/${run.id}`, { method: "PUT", headers: { authorization: "Bearer secret" }, body: JSON.stringify(body) });
  const one = errorText(await (await send({ digest, run, files: digests, journey: parseJourney(JOURNEY) })).json(), "");
  assert.equal(one, 'step 7 should be the check "The viewer can no longer see "Q3 plan"." with id "viewer-blocked".\nFix every problem, then publish again.');
  const two = errorText(await (await send({ digest, run, files: { ...digests, "x.png": "bad" }, journey: parseJourney(JOURNEY) })).json(), "");
  assert.match(two, /^Run \S+ has 2 problems: step 7 should be the check/);
  assert.match(two, /^- step 7 should be the check/m);
  assert.match(two, /^- files: the sha256 of x.png must be 64 lowercase hex/m);
});

test("a wrong token is refused", async () => {
  await assert.rejects(publish(runFolder(), { token: "wrong" }), /JOURNEYSFIRST_TOKEN/);
});

test("publish refuses a plain http address that is not this machine, before it sends anything", async () => {
  let sent = 0;
  const counting = async () => (sent++, new Response("{}"));
  for (const to of ["http://journeys.example.test/v1", "HTTP://10.0.0.5:4500"]) {
    await assert.rejects(publishRun(runFolder(), { to, token: "secret", fetch: counting }), /sends the token and the run over plain http.*Use an https:\/\/ address/s);
  }
  await assert.rejects(publishRun(runFolder(), { to: "journeys.example.test", fetch: counting }), /not a full address/);
  assert.equal(sent, 0);
  for (const to of ["http://localhost:4500", "http://127.0.0.1:4500", "http://[::1]:4500"]) {
    const reached = async (url) => {
      throw new Error(`sent to ${url}`);
    };
    await assert.rejects(publishRun(runFolder(), { to, token: "secret", fetch: reached }), new RegExp(`sent to ${to.replace(/[[\].]/g, "\\$&")}/runs/`), to);
  }
});

test("a Retry-After given as a date waits the default 5 seconds", async () => {
  const waits = [];
  let busy = 1;
  const flaky = async (url, init) => {
    if (url.includes("/files/") && busy-- > 0) return new Response("{}", { status: 503, headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" } });
    return fetch(url, init);
  };
  await publish(runFolder(), { fetch: flaky, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [5000]);
});

test("publish sends each file's sha256 in files and its length in sizes", async () => {
  const folder = runFolder();
  let opened;
  const watching = async (url, init) => {
    if (init.method === "PUT" && !url.includes("/files/")) opened = JSON.parse(init.body);
    return fetch(url, init);
  };
  await publish(folder, { fetch: watching });
  const { digests } = readRunFolder(folder);
  assert.deepEqual(opened.files, digests);
  assert.deepEqual(opened.sizes, Object.fromEntries(Object.keys(digests).map((name) => [name, readFileSync(join(folder, name)).length])));
});

test("an HTML 403 from in front of the service says it was blocked before the service, not the page", async () => {
  const page = "<!DOCTYPE html><html><head><title>Attention Required</title></head><body>Sorry, you have been blocked</body></html>";
  const firewall = async () => new Response(page, { status: 403, headers: { "content-type": "text/html" } });
  await assert.rejects(publishRun(runFolder(), { to: "https://journeys.example.test/v1", token: "secret", fetch: firewall }), (error) => {
    assert.match(error.message, /^PUT https:\/\/journeys\.example\.test\/v1\/runs\/\S+ was blocked before the service \(HTTP 403 from something in front of it, not from the service\)\.$/);
    assert.doesNotMatch(error.message, /Attention Required/);
    return true;
  });
});
