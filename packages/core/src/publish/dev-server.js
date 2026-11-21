// A local, in-memory journeys service that speaks the publish API (see
// publish.js and publish-handler.js). For tests and trying publish without a
// real service. Nothing is written to disk; stopping it forgets everything.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { hostAllowed, wrongHostMessage } from "../shared/local-host.js";
import { badPath, errorReply, publishHandler } from "./publish-handler.js";

/**
 * @typedef {import("./publish-handler.js").StoredRun} StoredRun
 * @typedef {import("./publish-handler.js").Store} Store
 */

/**
 * A store that keeps runs and their files in memory. The dev server uses it;
 * so can a test of anything built on publishHandler.
 * @returns {Store & {runs: Map<string, StoredRun>, files: Map<string, Map<string, Buffer>>, uploads: string[]}}
 *   runs: by run id, for runs published with no scope. uploads: every file stored, as "<run id>/<name>".
 */
export function memoryStore() {
  /** @type {Map<string, StoredRun>} */
  const byKey = new Map();
  /** @type {Map<string, {scope: unknown, stored: StoredRun}>} */
  const byId = new Map();
  /** @type {Map<string, Map<string, Buffer>>} */
  const files = new Map();
  /** @type {string[]} */
  const uploads = [];
  const slot = (/** @type {unknown} */ scope, /** @type {string} */ runKey) => (scope == null ? runKey : `${JSON.stringify(scope)}\n${runKey}`);
  /** The runs published with no scope, by run id: what the dev server's tests look at. */
  const runs = new Map();

  return {
    runs,
    files,
    uploads,
    async createRun(scope, runKey, { digest, sent, run, manifest, unverified }) {
      const found = byKey.get(slot(scope, runKey));
      if (found) return { stored: found, created: false };
      /** @type {StoredRun} */
      const stored = { id: randomUUID(), run_key: runKey, digest, state: "open", unverified, created_at: Date.now(), manifest, stored: [], sent, run };
      byKey.set(slot(scope, runKey), stored);
      byId.set(stored.id, { scope, stored });
      files.set(stored.id, new Map());
      if (scope == null) runs.set(runKey, stored);
      return { stored, created: true };
    },
    async findRun(scope, ref) {
      if ("id" in ref) {
        const found = byId.get(ref.id);
        return found && JSON.stringify(found.scope) === JSON.stringify(scope) ? found.stored : null;
      }
      return byKey.get(slot(scope, ref.run_key)) ?? null;
    },
    async putFile(_scope, stored, upload) {
      const chunks = [];
      for await (const chunk of upload.stream) chunks.push(Buffer.from(chunk));
      await upload.verify();
      files.get(stored.id)?.set(upload.name, Buffer.concat(chunks));
      if (!stored.stored.includes(upload.name)) stored.stored.push(upload.name);
      uploads.push(`${stored.run_key}/${upload.name}`);
    },
    async seal(_scope, stored) {
      if (Object.keys(stored.manifest).every((name) => stored.stored.includes(name))) stored.state = "sealed";
      return stored;
    },
    // Removes an open run only, as the Store contract says. A sealed run never goes.
    async discard(scope, stored) {
      if (stored.state === "sealed") return;
      byKey.delete(slot(scope, stored.run_key));
      byId.delete(stored.id);
      files.delete(stored.id);
      if (scope == null) runs.delete(stored.run_key);
    },
  };
}

/**
 * @param {{port?: number, host?: string, token?: string}} [options] with a token, every request must carry it.
 *   It listens on 127.0.0.1 unless you pass another host.
 * @returns {Promise<{url: string, runs: Map<string, StoredRun>, uploads: string[], close: () => Promise<void>}>}
 */
export function startDevServer({ port = 0, host = "127.0.0.1", token } = {}) {
  const store = memoryStore();
  let url = "";
  const { handle } = publishHandler(store, {
    apiUrl: (path) => `${url}${path}`,
    runLink: (id) => `${url}/runs/${id}`,
    fileUrl: (id, name) => `${url}/runs/${id}/files/${encodeURIComponent(name)}`,
  });

  const server = createServer(async (req, res) => {
    if (!hostAllowed(host, req.headers.host)) {
      req.resume();
      return send(res, errorReply(403, "forbidden", "Wrong host name.", { hint: wrongHostMessage(host, /** @type {import("node:net").AddressInfo} */ (server.address()).port) }));
    }
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      req.resume();
      return send(res, errorReply(401, "unauthorized", "Bad or missing token.", { hint: "Send Authorization: Bearer <token>." }));
    }
    const path = new URL(req.url ?? "/", "http://x").pathname;
    // The dev server also serves stored files, so the file urls in its answers work.
    const file = req.method === "GET" ? path.match(/^\/runs\/([^/]+)\/files\/([^/]+)$/) : null;
    if (file) {
      let id, name;
      try {
        [id, name] = [decodeURIComponent(file[1]), decodeURIComponent(file[2])];
      } catch {
        return send(res, badPath());
      }
      const bytes = store.files.get(id)?.get(name);
      if (!bytes) return send(res, errorReply(404, "not_found", "No such file."));
      return res.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
    }
    send(res, await handle(null, { method: req.method, path, headers: req.headers, body: req }));
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = /** @type {import("node:net").AddressInfo} */ (server.address());
      url = `http://${host}:${address.port}`;
      resolve({ url, runs: store.runs, uploads: store.uploads, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {import("./publish-handler.js").Reply} reply
 */
function send(res, { status, body, headers }) {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}
