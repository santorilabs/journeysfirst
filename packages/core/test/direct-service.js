// A journeys service whose store takes bytes straight into a fake storage on
// another origin, for the publish tests. refuse(name) may answer a storage
// upload with {status, type?, body?} instead of storing it.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { memoryStore } from "../src/publish/dev-server.js";
import { PublishError, publishHandler } from "../src/publish/publish-handler.js";

/**
 * A service whose store takes bytes straight into a fake storage, on another
 * origin: the API on 127.0.0.1, storage on localhost. Storage never overwrites.
 */
export async function directService({ refuse = () => false } = {}) {
  const store = memoryStore();
  /** @type {Map<string, {bytes: Buffer, type: string}>} */
  const objects = new Map();
  const seen = { storage: [], removed: [], created: 0, sizes: [] };
  let api = "";
  let storage = "";
  const key = (stored, name) => `${stored.id}/${name}`;
  const createRun = store.createRun;
  Object.assign(store, {
    createRun: (...args) => (seen.created++, createRun(...args)),
    uploadTarget: async (_scope, stored, name, type, size) => (seen.sizes.push([name, size]), { method: "PUT", url: `${storage}/storage/${key(stored, name)}`, headers: { "content-type": type } }),
    readUpload: async (_scope, stored, name) => {
      const object = objects.get(key(stored, name));
      return object ? { stream: Readable.from([object.bytes]), type: object.type } : null;
    },
    keepUpload: async (scope, stored, upload) => {
      try {
        await store.putFile(scope, stored, upload);
      } catch (error) {
        objects.delete(key(stored, upload.name));
        seen.removed.push(upload.name);
        throw error;
      }
    },
  });
  // The types a hosted service takes: images, videos, JSON and text.
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", json: "application/json", txt: "text/plain", md: "text/plain" };
  const fileType = (name) => {
    const type = types[name.split(".").pop()];
    if (!type) throw new PublishError(422, "bad_input", `${name} can't be uploaded.`);
    return type;
  };
  const { handle } = publishHandler(store, { apiUrl: (p) => `${api}${p}`, runLink: (id) => `${api}/runs/${id}`, fileUrl: (id, n) => `${storage}/stored/${id}/${n}`, fileType });
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    // A stored file, with its type and byte ranges, as a hosted service serves one.
    const served = req.method === "GET" ? path.match(/^\/stored\/([^/]+)\/([^/]+)$/) : null;
    if (served) {
      const bytes = store.files.get(served[1])?.get(served[2]);
      if (!bytes) return res.writeHead(404).end();
      const range = String(req.headers.range ?? "").match(/^bytes=(\d+)-(\d+)$/);
      const headers = { "content-type": fileType(served[2]), "accept-ranges": "bytes" };
      if (!range) return res.writeHead(200, headers).end(bytes);
      const [start, end] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
      return res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}` }).end(bytes.subarray(start, end + 1));
    }
    if (path.startsWith("/storage/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const name = path.slice("/storage/".length);
      seen.storage.push({ name, authorization: req.headers.authorization ?? null });
      const refusal = refuse(name);
      if (refusal) return res.writeHead(refusal.status, { "content-type": refusal.type ?? "application/xml" }).end(refusal.body ?? "<Error><Code>AccessDenied</Code></Error>");
      if (objects.has(name)) return res.writeHead(409).end('{"error":"Duplicate"}');
      objects.set(name, { bytes: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
      return res.writeHead(200).end("{}");
    }
    const reply = await handle(null, { method: req.method, path, headers: req.headers, body: req });
    res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) }).end(JSON.stringify(reply.body));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  api = `http://127.0.0.1:${port}`;
  storage = `http://localhost:${port}`;
  return { api, store, objects, seen, close: () => new Promise((done) => server.close(done)) };
}

