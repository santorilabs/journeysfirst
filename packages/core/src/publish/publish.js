// Publish a run folder to a journeys service over HTTP.
//
//   PUT  <to>/runs/<run id>                {digest, run, files: {name: sha256}, sizes: {name: bytes}, journey?}
//        With the journey, the service checks the run's steps match its lines.
//        Without it, the service keeps the run marked unverified.
//        201 new, or 200 when the same run id already has the same digest.
//        409 when the same run id was sealed with different content.
//        The reply lists the files the service still needs: {run_id, state, missing, url, unverified}.
//        Each missing item is {name, upload: {method, url, headers}}: send the
//        file's bytes there, as given. A storage url never gets the token.
//        A bare name means the route below.
//   PUT  <to>/runs/<run id>/files/<name>   the file's bytes (x-content-sha256 header), for older services
//   POST <to>/runs/<run id>/finalize       {digest}: checks what was sent, then seals the run once every file is there.
//        A file that did not arrive is listed with a fresh target (422 or 409). publish
//        sends those once more, then finalizes again.
//   GET  <to>/runs/<run id>                the run, as runAnswer (run-answer.js)
//
// Errors are {error: {code, message, hint, problems}}. A 503 means the service
// is busy: publish waits for Retry-After and tries again, up to three times.
// A 502, a 504 or a dropped connection is tried again after 1, 2 and 4 seconds.
// The protocol itself is publish-handler.js.
//
// publish sends run.json exactly as it is on disk, and the digest covers that
// run (canonical JSON), not the run as the rules settle it. The client refuses an invalid run
// before it sends it. The service settles the run with its own rules (see
// run-check.js), so a claimed pass with no evidence reads as not_checked with
// claimed: "passed". A client and a service on different versions still agree
// on the digest.
// Uploading only what is missing makes publish safe to rerun after an
// interruption: it picks up where it stopped.
// A Playwright trace (media kind "trace") is never sent. The copy in the run
// folder is redacted, and publish still leaves it on the machine that ran the
// journey. publish sends the run without those media items, and the digest
// covers what it sends.
import { isLoopback } from "../shared/local-host.js";
import { readRunFolder } from "../format/run-folder.js";
import { runDigest } from "../format/runfile.js";

/** A reply that was not 2xx, after any retries. */
class Refused extends Error {
  /** @param {string} message @param {number} status @param {any} body */
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Publish a run folder. Pass the journey so the service can check the steps
 * match it; without it the run is published as unverified.
 * @param {string} folder
 * @param {{to: string, token?: string, fetch?: typeof globalThis.fetch, journey?: import("../format/format.js").Journey|null, sleep?: (ms: number) => Promise<void>}} options
 * @returns {Promise<{id: string, runId: string|null, digest: string, state: string, url: string|null, unverified: boolean, uploaded: string[], skipped: string[]}>}
 */
export async function publishRun(folder, { to, token = process.env.JOURNEYSFIRST_TOKEN, fetch = globalThis.fetch, journey = null, sleep = wait }) {
  if (!to) throw new Error("Say where to publish: --to <url>, or set JOURNEYSFIRST_URL.");
  checkAddress(to);
  const { run, files, digests, digest } = withoutTraces(readRunFolder(folder, { journey }));
  const base = `${to.replace(/\/+$/, "")}/runs/${encodeURIComponent(run.id)}`;
  const service = new URL(base).origin;
  /** @type {Record<string, string>} */
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  /** @param {string} url @param {RequestInit} init */
  const send = (url, init) => call(fetch, sleep, url, init, service);
  const sizes = Object.fromEntries([...files].map(([name, bytes]) => [name, bytes.length]));

  const opened = await send(base, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ digest, run, files: digests, sizes, ...(journey ? { journey } : {}) }),
  });
  const unverified = Boolean(opened.unverified);
  const runId = opened.run_id ?? null;
  if (opened.state === "sealed") {
    return { id: run.id, runId, digest, state: "sealed", url: opened.url ?? null, unverified, uploaded: [], skipped: [...files.keys()] };
  }

  /** Files whose upload address refused them: the reason to give if they are still missing at the end. @type {Set<string>} */
  const refused = new Set();
  /** @type {Set<string>} */
  const uploaded = new Set();
  /** Send each listed file where the reply says. A storage address that refuses it is noted, and finalize decides. @param {any[]} missing */
  async function uploadAll(missing) {
    for (const item of missing) {
      const name = typeof item === "string" ? item : item.name;
      const target = typeof item === "string" ? null : (item.upload ?? null);
      const bytes = files.get(name);
      if (!bytes) continue;
      const url = target?.url ? new URL(target.url, `${base}/`).href : `${base}/files/${encodeURIComponent(name)}`;
      const own = new URL(url).origin === service;
      try {
        await send(url, {
          method: target?.method ?? "PUT",
          // The token goes only to the service itself, never to a storage url it hands out.
          headers: { ...(own ? auth : {}), "content-type": "application/octet-stream", ...(target?.headers ?? { "x-content-sha256": digests[name] }) },
          body: bytes,
        });
        refused.delete(name);
        uploaded.add(name);
      } catch (error) {
        if (own || !(error instanceof Refused) || error.status >= 500) throw error;
        refused.add(name);
      }
    }
  }

  const missing = opened.missing ?? [...files.keys()];
  await uploadAll(missing);
  const finalize = () => send(`${base}/finalize`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ digest }) });
  let sealed;
  try {
    sealed = await finalize();
  } catch (error) {
    // Files that did not arrive come back with fresh targets: send them once more. A file with no
    // target is already in storage, sent by another publish of this run: finalizing again checks it.
    if (!(error instanceof Refused) || ![409, 422].includes(error.status) || !Array.isArray(error.body?.missing)) throw error;
    await uploadAll(error.body.missing);
    try {
      sealed = await finalize();
    } catch (again) {
      const first = again instanceof Refused && again.body?.missing?.map((/** @type {any} */ m) => m.name).find((/** @type {string} */ n) => refused.has(n));
      if (first) throw new Error(`The upload address for ${first} was refused or has expired. Publish again.`);
      throw again;
    }
  }
  const names = new Set(missing.map((/** @type {any} */ m) => (typeof m === "string" ? m : m.name)));
  return { id: run.id, runId: sealed.run_id ?? runId, digest, state: sealed.state, url: sealed.url ?? opened.url ?? null, unverified, uploaded: [...uploaded], skipped: [...files.keys()].filter((n) => !names.has(n)) };
}

/**
 * The run and files to send: the folder's, minus each trace.
 * @param {ReturnType<typeof readRunFolder>} folder
 */
function withoutTraces({ raw, files, digests, digest }) {
  /** @type {import("../shared/display.js").MediaItem[]} */
  const items = raw.media ?? [];
  const traces = new Set(items.filter((m) => m.kind === "trace").map((m) => m.file));
  if (!traces.size) return { run: raw, files, digests, digest };
  const media = items.filter((m) => !traces.has(m.file));
  const { media: _, ...rest } = raw;
  const run = media.length ? { ...rest, media } : rest;
  const kept = Object.fromEntries(Object.entries(digests).filter(([name]) => !traces.has(name)));
  return { run, files: new Map([...files].filter(([name]) => !traces.has(name))), digests: kept, digest: runDigest(run, kept) };
}

/**
 * One request. A 503 is tried again after its Retry-After, up to three times.
 * A 502, a 504 or a dropped connection is tried again after 1, 2 and 4 seconds.
 * @param {typeof globalThis.fetch} fetch
 * @param {(ms: number) => Promise<void>} sleep
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} service the service's origin
 */
async function call(fetch, sleep, url, init, service) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw error;
    }
    const text = await response.text();
    const body = parseJson(text);
    if (response.ok) return body;
    if (response.status === 503 && attempt < 3) {
      await sleep(retryAfter(response.headers.get("retry-after")) * 1000);
      continue;
    }
    if ((response.status === 502 || response.status === 504) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const own = new URL(url).origin === service;
    // A firewall in front of the service answers with its own HTML page. Its text says nothing useful.
    if (own && response.status === 403 && /^\s*</.test(text)) throw new Refused(`${init.method} ${url} was blocked before the service (HTTP 403 from something in front of it, not from the service).`, 403, body);
    // The service says why (a revoked key, a wrong one) and what to do. An older service sends no body.
    if (own && response.status === 401) throw new Refused(`The service refused the token: ${errorText(body, "it is missing or wrong.")}\nThe token is read from JOURNEYSFIRST_TOKEN.`, 401, body);
    if (own && response.status === 409 && !body?.missing) throw new Refused(`Conflict at ${url}: ${errorText(body, "this run id was already published with different content.")}`, 409, body);
    throw new Refused(`${init.method} ${url} failed with ${response.status}: ${errorText(body, own ? text : "")}`, response.status, body);
  }
}

/**
 * The service's error as lines a person can read: the message, each problem,
 * then the hint. An older service sends the error as a plain string.
 * @param {any} body
 * @param {string} fallback
 * @returns {string}
 */
export function errorText(body, fallback) {
  const error = body?.error;
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;
  const problems = Array.isArray(error.problems) ? error.problems : [];
  const lines = [error.message ?? fallback];
  // A message that is the only problem is not printed twice.
  if (!(problems.length === 1 && problems[0] === error.message)) for (const p of problems) lines.push(`- ${p}`);
  if (error.hint) lines.push(error.hint);
  return lines.join("\n");
}

/**
 * Refuse an address the token and run would travel to in the clear. Plain
 * http is fine only to this machine, like the dev server.
 * @param {string} to
 */
function checkAddress(to) {
  let url;
  try {
    url = new URL(to);
  } catch {
    throw new Error(`"${to}" is not a full address. Pass one like https://journeys.example.test/v1.`);
  }
  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new Error(`${to} sends the token and the run over plain http, so anyone on the network can read them. Use an https:// address. Plain http works only to this machine (localhost, 127.0.0.1).`);
  }
}

/**
 * Seconds to wait before trying again: the Retry-After seconds, at most 30.
 * A date or anything else unreadable waits the default 5.
 * @param {string | null} header
 */
function retryAfter(header) {
  const seconds = Number(header);
  return header !== null && header.trim() !== "" && Number.isFinite(seconds) && seconds >= 0 ? Math.min(30, seconds) : 5;
}

/** @param {number} ms */
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * A storage url may answer with an empty body or XML, not JSON.
 * @param {string} text
 */
function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
