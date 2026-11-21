export type StoredRun = import("./publish-handler.js").StoredRun;
export type Store = import("./publish-handler.js").Store;
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
export declare function memoryStore(): Store & {
    runs: Map<string, StoredRun>;
    files: Map<string, Map<string, Buffer>>;
    uploads: string[];
};
/**
 * @param {{port?: number, host?: string, token?: string}} [options] with a token, every request must carry it.
 *   It listens on 127.0.0.1 unless you pass another host.
 * @returns {Promise<{url: string, runs: Map<string, StoredRun>, uploads: string[], close: () => Promise<void>}>}
 */
export declare function startDevServer({ port, host, token }?: {
    port?: number;
    host?: string;
    token?: string;
}): Promise<{
    url: string;
    runs: Map<string, StoredRun>;
    uploads: string[];
    close: () => Promise<void>;
}>;
