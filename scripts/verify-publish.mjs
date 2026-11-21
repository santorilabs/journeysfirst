// Checks the publish protocol's edge cases against a journeys service and
// prints one table: case, how it is checked, result.
//
//   npm run verify:publish                                   a local service with its own storage
//   JOURNEYSFIRST_TOKEN=... npm run verify:publish -- --to https://<service>/v1
//
// "service" cases send real requests to --to. Each uses a new run id that
// starts with "verify-". A run left open is removed by the service's sweep.
// A run that seals stays in the key's project: point it at a project kept for
// checks, never at a team's own project. "local" cases need replies no real
// service sends on demand (a firewall's page, a 502), another version of the
// client or service, or a browser. They run the test that covers them here.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJourney } from "../packages/core/src/format/format.js";
import { readRunFolder } from "../packages/core/src/format/run-folder.js";
import { runDigest } from "../packages/core/src/format/runfile.js";
import { RunRecorder } from "../packages/core/src/runner/recorder.js";
import { MAX_FILES } from "../packages/core/src/publish/publish-handler.js";
import { publishRun } from "../packages/core/src/publish/publish.js";
import { directService } from "../packages/core/test/direct-service.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = join(ROOT, "packages/core");
const OLD = "0.0.2";
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const token = process.env.JOURNEYSFIRST_TOKEN;

const JOURNEY = parseJourney(`format: journeysfirst/v1
title: Publish a run whose capture starts with a shell command
promise: An agent publishes a run whose evidence starts with a curl command, and it can be opened.
start: The app is running.
steps:
  - Fetch the app's status and keep the reply.
  - check: The reply is kept with the run.
    id: kept
`);
const CURL = 'curl -sS -X POST "$APP/status" -d x\n{"ok":true}\n';
const WEBM = () => Buffer.concat([Buffer.from("1a45dfa3", "hex"), randomBytes(2048)]);

/** A sealed-ready run folder with a .txt and a .md capture that start with a curl line, and a video. */
function runFolder({ extra = 0, attach = [] } = {}) {
  const id = `verify-${randomBytes(6).toString("hex")}`;
  const run = RunRecorder.start({ journey: JOURNEY, name: "verify-publish", id, ranBy: { agent: "verify-publish" }, outputDir: mkdtempSync(join(tmpdir(), "jf-verify-")) });
  run.attach({ name: "agent-fetch.txt", body: CURL, kind: "capture", tags: { user: "you" } });
  run.attach({ name: "helper-fetch.md", body: CURL, kind: "capture", tags: { user: "you" } });
  run.attach({ name: "you.webm", body: WEBM(), kind: "video", tags: { user: "you" } });
  for (const file of attach) run.attach(file);
  for (let i = 0; i < extra; i++) run.attach({ name: `extra-${i}.txt`, body: `capture ${i}\n`, kind: "capture" });
  run.step(1, { by: "you" });
  run.check("kept", { by: "you", verdict: "passed", proof: "Read the capture back from the run folder.", evidence: [{ source: "api", login: "you", url: "/status", file: "agent-fetch.txt", got: 200 }] });
  return run.finish();
}

/** The open body publish sends. */
function opening(dir) {
  const { raw, digest, digests, files } = readRunFolder(dir);
  return { run: raw, digest, files: digests, sizes: Object.fromEntries([...files].map(([n, b]) => [n, b.length])), bytes: files };
}

const noWait = async () => {};
const rows = [];
/** Run one case and keep its row. A thrown error is a failed case. */
async function check(name, where, how, body) {
  try {
    const note = await body();
    rows.push({ name, where, how, result: `pass${note ? ` (${note})` : ""}` });
  } catch (error) {
    rows.push({ name, where, how, result: `FAIL: ${String(error?.message ?? error).split("\n")[0]}` });
  }
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function serviceCases(to) {
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const api = (path, init = {}) =>
    fetch(`${to}${path}`, { ...init, headers: { ...auth, "content-type": "application/json", ...(init.headers ?? {}) } }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }));
  const publish = (dir, extra = {}) => publishRun(dir, { to, token, sleep: noWait, journey: JOURNEY, ...extra });
  const uploadTo = (target, bytes) => fetch(new URL(target.url, `${to}/`).href, { method: target.method, headers: { ...(new URL(target.url, `${to}/`).origin === new URL(to).origin ? auth : {}), ...target.headers }, body: bytes });

  await check("A capture that starts with a curl line (.txt and .md), and a video, publish and can be opened", "service", "publish; GET the run; fetch each file link: a capture reads back as text, the video answers a byte range with its type", async () => {
    const { folder } = runFolder();
    const published = await publish(folder);
    expect(published.state === "sealed", `state is ${published.state}`);
    const answer = (await api(`/runs/${published.runId}`)).body;
    const videoUrl = answer.videos?.[0]?.file_url;
    expect(videoUrl, "the answer has no video link");
    const video = await fetch(videoUrl, { headers: { ...auth, range: "bytes=0-3" } });
    const type = video.headers.get("content-type") ?? "";
    const capture = await fetch(videoUrl.replace(/you\.webm$/, "agent-fetch.txt"), { headers: auth });
    expect((await capture.text()) === CURL, `the capture read back as something else (${capture.status})`);
    // The dev server sends whole files as octet-stream; a hosted service must answer the range with the type.
    if (video.status === 200 && type === "application/octet-stream") return "this service serves files whole, untyped";
    expect(video.status === 206 && type.startsWith("video/webm"), `video range answered ${video.status} ${type}`);
    expect(/^text\/plain/.test(capture.headers.get("content-type") ?? ""), `capture type ${capture.headers.get("content-type")}`);
    return published.url;
  });

  await check("A file type the service does not take is refused before the run exists", "service", "open a run with a .html capture: 422 naming it, then GET the run id: 404", async () => {
    const { folder, run } = runFolder({ attach: [{ name: "page.html", body: "<p>hi</p>", kind: "capture" }] });
    const { bytes: _b, ...body } = opening(folder);
    const opened = await api(`/runs/${run.id}`, { method: "PUT", body: JSON.stringify(body) });
    if (opened.status === 201) return "this service takes .html files";
    expect(opened.status === 422 && /page\.html/.test(JSON.stringify(opened.body.error)), `open answered ${opened.status}`);
    expect((await api(`/runs/${run.id}`)).status === 404, "the run exists");
  });

  for (const [name, bad] of [["cut short", (b) => b.subarray(0, 6)], ["with the wrong sha256", (b) => Buffer.concat([b.subarray(0, 4), randomBytes(b.length - 4)])]]) {
    await check(`A video sent ${name} is refused and can be sent again`, "service", "open, send the bad bytes to the target, finalize: 422 with a fresh target; send the right bytes there, finalize: sealed", async () => {
      const { folder, run } = runFolder();
      const { bytes, ...body } = opening(folder);
      const opened = await api(`/runs/${run.id}`, { method: "PUT", body: JSON.stringify(body) });
      for (const m of opened.body.missing) {
        const sent = await uploadTo(m.upload, m.name === "you.webm" ? bad(bytes.get(m.name)) : bytes.get(m.name));
        if (m.name === "you.webm" && sent.status === 422) return "refused at upload, by the files route";
      }
      const first = await api(`/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: body.digest }) });
      expect(first.status === 422 && first.body.missing?.[0]?.name === "you.webm", `finalize answered ${first.status}`);
      expect((await uploadTo(first.body.missing[0].upload, bytes.get("you.webm"))).ok, "the fresh target refused the right bytes");
      const sealed = await api(`/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: body.digest }) });
      expect(sealed.body.state === "sealed", `then finalize answered ${sealed.status}: ${sealed.body.error?.message}`);
    });
  }

  await check(`A run of more than ${MAX_FILES} files is refused`, "service", `open a run of ${MAX_FILES + 1} files: 422 that names the cap`, async () => {
    const { folder, run } = runFolder({ extra: MAX_FILES - 2 });
    const { bytes: _b, ...body } = opening(folder);
    const opened = await api(`/runs/${run.id}`, { method: "PUT", body: JSON.stringify(body) });
    expect(opened.status === 422 && /at most/.test(JSON.stringify(opened.body.error)), `open answered ${opened.status}`);
  });

  await check("An upload address that is refused or has expired, then a rerun", "service", "publish with every storage upload sent to a broken copy of its address: the plain message; publish again: sealed", async () => {
    const { folder } = runFolder();
    // A storage address with its token spoiled, as an expired one reads to storage.
    const spoil = (url) => (url.includes("token=") ? url.replace(/token=[^&]+/, "token=expired") : `${url}-expired`);
    const broken = async (url, init) => fetch(new URL(url).origin === new URL(to).origin ? url : spoil(url), init);
    try {
      await publish(folder, { fetch: broken });
      return "the service ignores the address token";
    } catch (error) {
      expect(/The upload address for \S+ was refused or has expired\. Publish again\./.test(error.message) || /failed with 4\d\d/.test(error.message), error.message);
    }
    expect((await publish(folder)).state === "sealed", "the rerun did not seal");
  });

  await check("Two publishers of one run id with different content", "service", "open A, open B, finalize A with its digest: 409 replaced; B publishes and seals", async () => {
    const { folder, run } = runFolder();
    const { bytes, ...a } = opening(folder);
    const b = { ...a, run: { ...a.run, summary: "Another publish." } };
    b.digest = runDigest(b.run, b.files);
    await api(`/runs/${run.id}`, { method: "PUT", body: JSON.stringify(a) });
    const openedB = await api(`/runs/${run.id}`, { method: "PUT", body: JSON.stringify(b) });
    const late = await api(`/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: a.digest }) });
    expect(late.status === 409 && /was replaced by another publish before it finished/.test(late.body.error?.message), `finalize A answered ${late.status}: ${late.body.error?.message}`);
    for (const m of openedB.body.missing) await uploadTo(m.upload, bytes.get(m.name));
    expect((await api(`/runs/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ digest: b.digest }) })).body.state === "sealed", "B did not seal");
  });

  await check("Two publishers of the same run at once", "service", "two publishes of one folder in parallel: both sealed, one run id", async () => {
    const { folder } = runFolder();
    const [one, two] = await Promise.all([publish(folder), publish(folder)]);
    expect(one.state === "sealed" && two.state === "sealed" && one.runId === two.runId, `${one.state}/${two.state}, ${one.runId} vs ${two.runId}`);
  });

  await check("A rerun after an interruption sends nothing again", "service", "publish with finalize cut off, publish again: sealed, nothing uploaded", async () => {
    const { folder } = runFolder();
    const cut = async (url, init) => (url.endsWith("/finalize") ? new Response("{}", { status: 500 }) : fetch(url, init));
    await publish(folder, { fetch: cut }).then(() => expect(false, "the cut publish sealed"), () => {});
    const again = await publish(folder);
    expect(again.state === "sealed" && again.uploaded.length === 0, `uploaded ${again.uploaded.join(", ")}`);
  });

  await check("A file that arrives wrong once is sent again from the 422's fresh target", "service", "publish with the video cut short on its first send: sealed in one publish", async () => {
    const { folder } = runFolder();
    let first = true;
    const once = async (url, init) => (first && new URL(url).origin !== new URL(to).origin && init.headers?.["content-type"] === "video/webm" ? ((first = false), fetch(url, { ...init, body: Buffer.from("1a45dfa3", "hex") })) : fetch(url, init));
    const published = await publish(folder, { fetch: once });
    expect(published.state === "sealed", published.state);
    return first ? "the service took bytes itself" : "";
  });

  await check("A method a route does not take", "service", "DELETE /runs/<id>, GET /runs/<id>/files/<name>, GET /runs/<id>/finalize: 405 method_not_allowed with Allow", async () => {
    const id = `verify-${randomBytes(6).toString("hex")}`;
    for (const [path, method, allow] of [[`/runs/${id}`, "DELETE", "GET, PUT"], [`/runs/${id}/files/a.png`, "GET", "PUT"], [`/runs/${id}/finalize`, "GET", "POST"]]) {
      const reply = await api(path, { method });
      expect(reply.status === 405 && reply.body.error?.code === "method_not_allowed" && reply.headers.get("allow") === allow, `${method} ${path}: ${reply.status} ${reply.body.error?.code} allow=${reply.headers.get("allow")}`);
    }
  });

  await check(`A ${OLD} client publishes to this service`, "service", `the ${OLD} release's publishRun against --to`, async () => {
    const old = await oldCore();
    const { folder } = runFolder();
    const published = await old.publish.publishRun(folder, { to, token, journey: JOURNEY });
    expect(published.state === "sealed", published.state);
  });
}

/** An earlier release's package, from npm, kept in a cache folder. */
async function oldCore() {
  const dir = join(tmpdir(), `journeysfirst-${OLD}`);
  if (!existsSync(join(dir, "package/package.json"))) {
    mkdirSync(dir, { recursive: true });
    execFileSync("npm", ["pack", `journeysfirst@${OLD}`, "--silent"], { cwd: dir });
    execFileSync("tar", ["-xzf", join(dir, `journeysfirst-${OLD}.tgz`), "-C", dir]);
    execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--silent"], { cwd: join(dir, "package") });
  }
  const at = (p) => pathToFileURL(join(dir, "package/src", p)).href;
  return { publish: await import(at("publish/publish.js")), dev: await import(at("publish/dev-server.js")) };
}

/** Each local case is the test that covers it, run here. */
function localCases() {
  const run = (name, how, file, pattern) =>
    check(name, "local", how, async () => {
      const result = spawnSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, join(CORE, "test", file)], { cwd: CORE, encoding: "utf8" });
      const passed = Number(result.stdout.match(/^# pass (\d+)/m)?.[1] ?? 0);
      const failed = Number(result.stdout.match(/^# fail (\d+)/m)?.[1] ?? 1);
      expect(passed > 0 && failed === 0, `${failed} failed, ${passed} passed in ${file}`);
    });
  return [
    run("A file sent with another content type than its target says, or the wrong bytes", "test: removed at finalize and returned with a fresh target", "publish-handler.test.js", "did not arrive as sent is removed"),
    run("An S3-style XML 403 from a storage address", "test: refused every upload with an S3-style XML 403", "publish-edges.test.js", "S3-style XML 403"),
    run("An HTML 403 from the service's host", "test: an HTML 403 from in front of the service says blocked before the service", "publish.test.js", "blocked before the service"),
    run("An HTML 403 from a storage address", "test: not reported as blocked before the service", "publish-edges.test.js", "HTML 403 from a storage address"),
    run("An expired upload address replaced by finalize's fresh one", "test: expired address, then a rerun sends nothing", "publish-edges.test.js", "has expired is replaced"),
    run("A 502, a 504 and a dropped connection are retried", "test: retried after 1, 2 and 4 seconds", "publish-edges.test.js", "502, a 504"),
    run(`${MAX_FILES} files of 50 MB through finalize`, "test: finalize reads them back in one pass", "publish-edges.test.js", "files of 50 MB"),
    run("A sealed run is never discarded by the store", "test: the memory store never discards a sealed run", "publish-edges.test.js", "never discards a sealed run"),
    run("Captions under style-src 'self', nonce-only, after a navigation, and Trusted Types; screenshots clean", "tests: video frame pixel checks in a real browser", "captions-browser.test.js", "."),
  ];
}

async function interopCase() {
  await check(`This client publishes to a ${OLD} service`, "local", `the ${OLD} release's dev server, published to with this publishRun`, async () => {
    const old = await oldCore();
    const server = await old.dev.startDevServer({});
    try {
      const { folder } = runFolder();
      expect((await publishRun(folder, { to: server.url, sleep: noWait })).state === "sealed", "not sealed");
    } finally {
      await server.close();
    }
  });
}

async function main() {
  let to = flag("--to");
  let local = null;
  if (!to) {
    local = await directService({});
    to = local.api;
  }
  console.log(`verify-publish against ${local ? `a local service (${to})` : to}\n`);
  try {
    await serviceCases(to.replace(/\/+$/, ""));
  } finally {
    await local?.close();
  }
  await interopCase();
  await Promise.all(localCases());
  const width = (key) => Math.max(key.length, ...rows.map((r) => r[key].length));
  const cols = ["name", "where", "how", "result"];
  const line = (r) => `| ${cols.map((c) => r[c].padEnd(width(c))).join(" | ")} |`;
  console.log(line({ name: "case", where: "where", how: "how it is checked", result: "result" }));
  console.log(`|${cols.map((c) => "-".repeat(width(c) + 2)).join("|")}|`);
  for (const r of rows) console.log(line(r));
  const failed = rows.filter((r) => r.result.startsWith("FAIL")).length;
  console.log(`\n${rows.length - failed} of ${rows.length} cases pass.`);
  process.exitCode = failed ? 1 : 0;
}

await main();
