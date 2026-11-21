// The publish protocol (see publish.js), once, over a store. The dev server
// runs it on a memory store; a service runs it on its own database and file
// storage. Both answer the same status codes and bodies, because this is the
// only place they are decided.
//
//   GET  /runs/<run id or server id>       the run, as runAnswer
//   PUT  /runs/<run id>                    open: {digest, run, files: {name: sha256}, sizes?: {name: bytes}, journey?}
//   PUT  /runs/<run id>/files/<name>       the file's bytes, streamed and hashed as they arrive
//   POST /runs/<run id>/finalize           {digest?}: check what was uploaded, then seal once every file is there
//
// A store with upload targets (uploadTarget) takes the bytes straight into its
// storage, so the service never carries them. Before seal, the handler reads
// each object back, hashes it and checks its type. The files route is then
// only for clients that ignore upload targets.
//
// Every error is {error: {code, message, hint, problems}}. problems lists every
// validation problem at once; it is empty for other errors.
//
// The digest covers the run as sent, never as settled, so a client on another
// version of the rules still matches. Then the service validates and settles
// the run with its own rules. The store keeps both: the run as sent, and the
// settled run as the service's verdict. Reads answer from the stored verdict
// and never run the rules again, so a later rule change can't alter a stored run.
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { validateJourney } from "../format/format.js";
import { runAnswer } from "../review/run-answer.js";
import { checkRun } from "../format/run-check.js";
import { FILE_NAME, isCheck, runDigest, runFiles } from "../format/runfile.js";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_JSON_BYTES = 10 * 1024 * 1024;
// The most files one run can have, so finalize, which reads each one back, takes a bounded time.
// A run with several users and a video each stays well under it.
export const MAX_FILES = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * @typedef {{status: number, body: unknown, headers?: Record<string, string>}} Reply
 * @typedef {{method?: string, path: string, headers: Record<string, string | string[] | undefined>, body: NodeJS.ReadableStream}} Request
 * @typedef {{
 *   id: string, run_key: string, digest: string, state: "open"|"sealed", unverified: boolean, created_at: number,
 *   manifest: Record<string, string>, stored: string[], sent: import("../format/runfile.js").Run, run: import("../format/runfile.js").Run,
 * }} StoredRun
 *   sent and run as in NewRun. Answers read run; sent is kept as the record of what was published.
 * @typedef {{digest: string, sent: import("../format/runfile.js").Run, run: import("../format/runfile.js").Run, manifest: Record<string, string>, journey: import("../format/format.js").Journey|null, settled: string[], unverified: boolean}} NewRun
 *   sent: the run exactly as the client sent it. digest covers it, with manifest.
 *   run: the run as this service's rules settle it: its verdict. Store it as given; never settle it again.
 *   settled: the ids of checks that claimed a pass the rules did not accept (now not_checked).
 * @typedef {{name: string, sha256: string, stream: NodeJS.ReadableStream, verify: () => Promise<{bytes: number}>}} Upload
 *   Read stream to the end, then await verify() before the bytes count as stored.
 *   verify throws a PublishError when the bytes do not match sha256.
 * @typedef {{method: string, url: string, headers: Record<string, string>}} Target
 * @typedef {{
 *   createRun: (scope: any, runKey: string, run: NewRun) => Promise<{stored: StoredRun, created: boolean}>,
 *   findRun: (scope: any, ref: {id: string} | {run_key: string}) => Promise<StoredRun | null>,
 *   putFile: (scope: any, stored: StoredRun, upload: Upload) => Promise<void>,
 *   seal: (scope: any, stored: StoredRun) => Promise<StoredRun>,
 *   discard: (scope: any, stored: StoredRun) => Promise<void>,
 *   uploadTarget?: (scope: any, stored: StoredRun, name: string, type: string, size: number | null) => Promise<Target | null>,
 *   readUpload?: (scope: any, stored: StoredRun, name: string) => Promise<{stream: NodeJS.ReadableStream, type: string} | null>,
 *   keepUpload?: (scope: any, stored: StoredRun, upload: Upload) => Promise<void>,
 * }} Store
 *   createRun keeps both sent and run unchanged. It returns the existing run, with created false, when the run id is already taken in this scope.
 *   seal seals only when every file is stored, in one step, and returns the run as it then stands.
 *   discard removes an open run and its files.
 *   A store that takes bytes straight into its storage has all three of the rest.
 *   uploadTarget: where a client sends one file, to be stored as type. size is the length the client declared
 *   when the request carries it (open), else null. It never overwrites an object. It returns null when an
 *   object is already there (another publish of the run sent it): that file is left out of missing, and finalize checks it.
 *   readUpload: the object a client sent there and its content type, or null when nothing was sent.
 *   keepUpload: read upload.stream to the end, await upload.verify(), then mark the file stored.
 *   When it throws, it has removed the object first, so a fresh target can take the file again.
 * @typedef {{
 *   apiUrl: (path: string) => string, runLink: (id: string) => string, fileUrl: (id: string, name: string) => string,
 *   fileType?: (name: string) => string | null, maxFileBytes?: number, onError?: (error: unknown) => void,
 * }} Options
 *   apiUrl: the full address of a protocol path, for upload targets.
 *   runLink: the link a person opens for a run. fileUrl: where an answer's files are fetched.
 *   fileType: the content type the service stores a file as, from its name. It throws a PublishError for a file
 *   the service does not take. Null takes any file. Every file of a run is checked before the run is created.
 *   onError: told of each unexpected error before the 500 reply, to log it. It gets the error only, never the request.
 */

/** An error the protocol answers with its status and the one error shape. */
export class PublishError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {{hint?: string, problems?: string[], extra?: Record<string, unknown>, headers?: Record<string, string>}} [more]
   */
  constructor(status, code, message, { hint, problems = [], extra = {}, headers } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint ?? null;
    this.problems = problems;
    this.extra = extra;
    this.headers = headers;
  }

  /** @returns {Reply} */
  reply() {
    return { status: this.status, body: { error: { code: this.code, message: this.message, hint: this.hint, problems: this.problems }, ...this.extra }, ...(this.headers ? { headers: this.headers } : {}) };
  }
}

/**
 * The one error shape, as a reply.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {{hint?: string, problems?: string[]}} [more]
 */
export const errorReply = (status, code, message, more) => new PublishError(status, code, message, more).reply();

/** The reply to a path that is not valid percent-encoding. */
export const badPath = () => errorReply(422, "bad_input", "The path is not valid percent-encoding.");

/**
 * @param {Store} store
 * @param {Options} options
 */
export function publishHandler(store, { apiUrl, runLink, fileUrl, fileType = () => null, maxFileBytes = MAX_FILE_BYTES, onError = () => {} }) {
  /** @param {StoredRun} stored */
  const missingNames = (stored) => Object.keys(stored.manifest).filter((name) => !stored.stored.includes(name)).sort();
  /** @param {any} scope @param {StoredRun} stored @param {Record<string, number>} [sizes] @returns {Promise<{name: string, upload: Target}[]>} */
  const targets = async (scope, stored, sizes = {}) => {
    const all = await Promise.all(
      missingNames(stored).map(async (name) => ({
        name,
        upload: store.uploadTarget
          ? await store.uploadTarget(scope, stored, name, fileType(name) ?? "application/octet-stream", sizes[name] ?? null)
          : { method: "PUT", url: apiUrl(`/runs/${encodeURIComponent(stored.run_key)}/files/${encodeURIComponent(name)}`), headers: { "x-content-sha256": stored.manifest[name] } },
      })),
    );
    // A file with no target is already in storage, sent by another publish of this run.
    return /** @type {{name: string, upload: Target}[]} */ (all.filter((t) => t.upload));
  };
  /** @param {any} scope @param {StoredRun} stored @param {Record<string, number>} sizes */
  const opened = async (scope, stored, sizes) => ({ run_id: stored.id, state: stored.state, missing: await targets(scope, stored, sizes), url: runLink(stored.id), unverified: stored.unverified });

  /**
   * Check each file a client sent straight to storage. A good one is marked
   * stored. A bad one is removed, and its problem returned, so it can be sent again.
   * @param {any} scope @param {StoredRun} stored
   * @returns {Promise<{stored: StoredRun, problems: string[]}>}
   */
  async function checkUploads(scope, stored) {
    const { readUpload, keepUpload } = store;
    if (!readUpload || !keepUpload) return { stored, problems: [] };
    const problems = [];
    for (const name of missingNames(stored)) {
      const sent = await readUpload(scope, stored, name);
      if (!sent) continue;
      const type = fileType(name);
      const wrongType = type && sent.type !== type ? new PublishError(422, "bad_input", `${name} was sent as ${sent.type}, not ${type}. Send it with the headers its upload target gives.`) : null;
      try {
        await keepUpload(scope, stored, hashed(sent.stream, name, stored.manifest[name], maxFileBytes, wrongType));
      } catch (error) {
        if (!(error instanceof PublishError)) throw error;
        problems.push(error.message);
      }
    }
    return { stored: (await store.findRun(scope, { id: stored.id })) ?? stored, problems };
  }

  /** @param {any} scope @param {string} runKey */
  async function existing(scope, runKey) {
    const stored = await store.findRun(scope, { run_key: runKey });
    if (!stored) throw new PublishError(404, "not_found", `No publication of run ${runKey} has started.`, { hint: `Start it with PUT /runs/${runKey}.` });
    return stored;
  }

  /** @param {any} scope @param {string} runKey @param {any} body */
  async function open(scope, runKey, body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new PublishError(422, "bad_input", "The body must be {digest, run, files, journey?}.");
    const { digest, run: sent, files, sizes = {}, journey } = body;
    const problems = [];
    if (sent?.id !== runKey) problems.push(`run.id is ${JSON.stringify(sent?.id)}, but the path says "${runKey}". They must be the same.`);
    const journeyProblems = journey ? validateJourney(journey).map((p) => `journey: ${p}`) : [];
    problems.push(...journeyProblems);
    const { run, problems: runProblems } = checkRun(sent, journey && !journeyProblems.length ? journey : undefined);
    problems.push(...runProblems);
    const manifest = readFiles(runKey, files, sizes, problems);
    if (manifest && !runProblems.length) {
      const names = runFiles(run);
      const listed = Object.keys(manifest).sort();
      if (names.join("\n") !== listed.join("\n")) problems.push(`files lists ${JSON.stringify(listed)}, but the run refers to ${JSON.stringify(names)}.`);
      else if (runDigest(sent, manifest) !== digest) problems.push("digest doesn't match the run and its files. It is runDigest(run, files) from journeysfirst.");
    }
    if (problems.length) {
      const secret = problems.some((p) => /^values\.\S+ is secret/.test(p));
      throw new PublishError(422, "bad_input", problems.length === 1 ? problems[0] : `Run ${runKey} has ${problems.length} problems: ${problems[0]}`, {
        problems,
        hint: secret ? "Publish with a current journeysfirst. Its recorder never writes secret values." : "Fix every problem, then publish again.",
      });
    }

    // Every check whose claimed pass did not stand, whether this service or the client settled it.
    const settled = run.steps.filter((s) => isCheck(s) && s.claimed === "passed").map((s) => /** @type {import("../format/runfile.js").CheckStep} */ (s).id);
    // No manifest is one of the problems above, so here there is one.
    const record = { digest, sent, run, manifest: /** @type {Record<string, string>} */ (manifest), journey: journey ?? null, settled, unverified: !journey };
    let { stored, created } = await store.createRun(scope, runKey, record);
    if (!created && stored.digest !== digest) {
      if (stored.state === "sealed") {
        throw new PublishError(409, "conflict", `Run ${runKey} was already published with different content.`, { hint: "Rename the run folder (and its run.json id) to publish this as a new run." });
      }
      // That publication never sealed, so nothing points at it yet. This one
      // replaces it, so a run with a fixed file can be published at once.
      await store.discard(scope, stored);
      ({ stored, created } = await store.createRun(scope, runKey, record));
      if (!created) throw new PublishError(409, "conflict", `Run ${runKey} is being published by someone else right now.`, { hint: "Publish again in a minute." });
    }
    // A rerun after an interruption: files already sent count, so they are not sent again.
    if (!created && stored.state === "open") ({ stored } = await checkUploads(scope, stored));
    return { status: created ? 201 : 200, body: await opened(scope, stored, sizes) };
  }

  /**
   * The files an open lists, {name: sha256}, or null when it is not that.
   * sizes, {name: bytes}, is optional: older clients send none. Each problem goes into problems.
   * @param {string} runKey @param {unknown} files @param {unknown} sizes @param {string[]} problems
   * @returns {Record<string, string> | null}
   */
  function readFiles(runKey, files, sizes, problems) {
    if (!files || typeof files !== "object" || Array.isArray(files)) {
      problems.push("files must map each file the run refers to, to its sha256.");
      return null;
    }
    const manifest = /** @type {Record<string, string>} */ (files);
    const declared = sizes && typeof sizes === "object" && !Array.isArray(sizes) ? /** @type {Record<string, unknown>} */ (sizes) : {};
    const count = Object.keys(manifest).length;
    if (count > MAX_FILES) problems.push(`Run ${runKey} has ${count} files. A run can have at most ${MAX_FILES}.`);
    for (const [name, sha] of Object.entries(manifest)) {
      if (!FILE_NAME.test(name)) {
        problems.push(`files: "${name}" is not a plain file name.`);
        continue;
      }
      if (typeof sha !== "string" || !SHA256.test(sha)) problems.push(`files: the sha256 of ${name} must be 64 lowercase hex characters.`);
      const size = declared[name];
      if (size !== undefined && !(Number.isInteger(size) && Number(size) >= 0)) problems.push(`files: the size of ${name} must be its length in bytes.`);
      else if (Number(size) > maxFileBytes) problems.push(tooLarge(name, maxFileBytes).message);
      try {
        fileType(name);
      } catch (error) {
        if (!(error instanceof PublishError)) throw error;
        problems.push(error.message);
      }
    }
    return manifest;
  }

  /** @param {any} scope @param {string} runKey @param {string} name @param {Request} req */
  async function file(scope, runKey, name, req) {
    const stored = await existing(scope, runKey);
    if (!(name in stored.manifest)) {
      drain(req.body);
      throw new PublishError(422, "bad_input", `${name} is not part of run ${runKey}.`, { hint: `The run's files are: ${Object.keys(stored.manifest).sort().join(", ") || "none"}.` });
    }
    const expected = stored.manifest[name];
    const header = req.headers["x-content-sha256"];
    if (header !== undefined && header !== expected) {
      drain(req.body);
      throw new PublishError(422, "bad_input", `x-content-sha256 for ${name} differs from its sha256 in the run's files.`);
    }
    if (stored.stored.includes(name)) {
      drain(req.body);
      return { status: 200, body: { stored: name } };
    }
    const length = Number(req.headers["content-length"]);
    if (length > maxFileBytes) {
      drain(req.body);
      throw tooLarge(name, maxFileBytes);
    }
    await store.putFile(scope, stored, hashed(req.body, name, expected, maxFileBytes));
    return { status: 200, body: { stored: name } };
  }

  /** @param {any} scope @param {string} runKey @param {any} body {digest?}: the digest this client opened with */
  async function finalize(scope, runKey, body) {
    let stored = await existing(scope, runKey);
    // Another publish of this run id with other content replaced the one this client opened.
    if (typeof body?.digest === "string" && body.digest !== stored.digest) {
      throw new PublishError(409, "conflict", `Run ${runKey} was replaced by another publish before it finished. Publish again.`);
    }
    /** @type {string[]} */
    let problems = [];
    if (stored.state !== "sealed") {
      ({ stored, problems } = await checkUploads(scope, stored));
      stored = await store.seal(scope, stored);
    }
    if (stored.state === "sealed") return { status: 200, body: { run_id: stored.id, state: "sealed", url: runLink(stored.id) } };
    const hint = "Upload each missing file to its target, then finalize again.";
    const extra = { missing: await targets(scope, stored) };
    if (problems.length) {
      throw new PublishError(422, "bad_input", problems.length === 1 ? problems[0] : `Run ${runKey} has ${problems.length} problems: ${problems[0]}`, { problems, hint, extra });
    }
    throw new PublishError(409, "conflict", `Run ${runKey} is still missing ${missingNames(stored).join(", ")}.`, { hint, extra });
  }

  /** @param {any} scope @param {string} ref */
  async function get(scope, ref) {
    const stored = (UUID.test(ref) ? await store.findRun(scope, { id: ref.toLowerCase() }) : null) ?? (await store.findRun(scope, { run_key: ref }));
    if (!stored) throw new PublishError(404, "not_found", `No run ${ref} in this project.`, { hint: "Pass the run id from the publish reply, the run's own id, or its link." });
    return { status: 200, body: answer(stored) };
  }

  /** @param {StoredRun} stored */
  const answer = (stored) =>
    runAnswer(stored.run, { runId: stored.id, state: stored.state, url: runLink(stored.id), fileUrl: (name) => fileUrl(stored.id, name), missing: missingNames(stored) });

  /**
   * Answer one protocol request. path is relative to where the protocol is
   * mounted, like /runs/<run id>. Never throws.
   * @param {any} scope whatever the store needs to keep projects apart (null on the dev server)
   * @param {Request} req
   * @returns {Promise<Reply>}
   */
  async function handle(scope, req) {
    try {
      const match = req.path.match(/^\/runs\/([^/]+)(?:\/(files)\/([^/]+)|\/(finalize))?\/?$/);
      if (!match) throw new PublishError(404, "not_found", "No such route.", { hint: "The routes are /runs/<run id>, /runs/<run id>/files/<name> and /runs/<run id>/finalize." });
      const [, rawKey, files, rawName, fin] = match;
      const key = decodeURIComponent(rawKey);
      const method = req.method ?? "GET";
      if (!files && !fin && method === "GET") return await get(scope, key);
      if (!files && !fin && method === "PUT") return await open(scope, key, await readJson(req.body));
      if (files && method === "PUT") return await file(scope, key, decodeURIComponent(rawName), req);
      if (fin && method === "POST") return await finalize(scope, key, await readJson(req.body));
      drain(req.body);
      throw new PublishError(405, "method_not_allowed", `${method} is not allowed here.`, { headers: { allow: files ? "PUT" : fin ? "POST" : "GET, PUT" } });
    } catch (error) {
      if (error instanceof PublishError) return error.reply();
      if (error instanceof URIError) return badPath();
      onError(error);
      return errorReply(500, "internal", "Something went wrong on the service. Publish again; it resumes where it stopped.");
    }
  }

  return { handle, answer };
}

/**
 * The upload's bytes as they arrive, hashed and counted, never held in memory.
 * @param {NodeJS.ReadableStream} body
 * @param {string} name
 * @param {string} expected sha256
 * @param {number} max bytes
 * @param {PublishError | null} [refused] what verify throws once the bytes are read, whatever they are
 * @returns {Upload}
 */
function hashed(body, name, expected, max, refused = null) {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > max) return done(tooLarge(name, max));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const ended = new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  ended.catch(() => {}); // the store sees the error on the stream; verify rethrows it
  body.on("error", (error) => stream.destroy(error));
  body.pipe(stream);
  // The same answer however often it is asked, so a store can ask again after a failure.
  /** @type {Promise<{bytes: number}> | null} */
  let verdict = null;
  return {
    name,
    sha256: expected,
    stream,
    verify() {
      verdict ??= ended.then(() => {
        if (refused) throw refused;
        if (hash.digest("hex") !== expected) throw new PublishError(422, "bad_input", `${name} doesn't match its sha256.`, { hint: "Publish again from the run folder; the file may have changed or been cut short." });
        return { bytes };
      });
      return verdict;
    },
  };
}

/** @param {string} name @param {number} max */
// The rest of a body this large is not read, so the connection cannot carry another request.
const tooLarge = (name, max) =>
  new PublishError(413, "too_large", `${name} is over ${Math.round(max / 1024 / 1024)} MB.`, { hint: "Record a shorter video, or a smaller screenshot.", headers: { connection: "close" } });

/** @param {NodeJS.ReadableStream} body */
async function readJson(body) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new PublishError(413, "too_large", `The run is over ${MAX_JSON_BYTES / 1024 / 1024} MB of JSON.`);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new PublishError(422, "bad_input", "The body is not JSON.");
  }
}

/** Read and drop a request body we won't use, so the connection stays usable. @param {NodeJS.ReadableStream} body */
function drain(body) {
  body.on("error", () => {});
  body.resume();
}
