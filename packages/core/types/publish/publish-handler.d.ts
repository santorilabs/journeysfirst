export declare const MAX_FILE_BYTES: number;
export declare const MAX_JSON_BYTES: number;
export declare const MAX_FILES = 64;
export type Reply = {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
};
export type Request = {
    method?: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: NodeJS.ReadableStream;
};
export type StoredRun = {
    id: string;
    run_key: string;
    digest: string;
    state: "open" | "sealed";
    unverified: boolean;
    created_at: number;
    manifest: Record<string, string>;
    stored: string[];
    sent: import("../format/runfile.js").Run;
    run: import("../format/runfile.js").Run;
};
export type NewRun = {
    digest: string;
    sent: import("../format/runfile.js").Run;
    run: import("../format/runfile.js").Run;
    manifest: Record<string, string>;
    journey: import("../format/format.js").Journey | null;
    settled: string[];
    unverified: boolean;
};
export type Upload = {
    name: string;
    sha256: string;
    stream: NodeJS.ReadableStream;
    verify: () => Promise<{
        bytes: number;
    }>;
};
export type Target = {
    method: string;
    url: string;
    headers: Record<string, string>;
};
export type Store = {
    createRun: (scope: any, runKey: string, run: NewRun) => Promise<{
        stored: StoredRun;
        created: boolean;
    }>;
    findRun: (scope: any, ref: {
        id: string;
    } | {
        run_key: string;
    }) => Promise<StoredRun | null>;
    putFile: (scope: any, stored: StoredRun, upload: Upload) => Promise<void>;
    seal: (scope: any, stored: StoredRun) => Promise<StoredRun>;
    discard: (scope: any, stored: StoredRun) => Promise<void>;
    uploadTarget?: (scope: any, stored: StoredRun, name: string, type: string, size: number | null) => Promise<Target | null>;
    readUpload?: (scope: any, stored: StoredRun, name: string) => Promise<{
        stream: NodeJS.ReadableStream;
        type: string;
    } | null>;
    keepUpload?: (scope: any, stored: StoredRun, upload: Upload) => Promise<void>;
};
export type Options = {
    apiUrl: (path: string) => string;
    runLink: (id: string) => string;
    fileUrl: (id: string, name: string) => string;
    fileType?: (name: string) => string | null;
    maxFileBytes?: number;
    onError?: (error: unknown) => void;
};
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
export declare class PublishError extends Error {
    status: number;
    code: string;
    hint: string | null;
    problems: string[];
    extra: Record<string, unknown>;
    headers: Record<string, string> | undefined;
    /**
     * @param {number} status
     * @param {string} code
     * @param {string} message
     * @param {{hint?: string, problems?: string[], extra?: Record<string, unknown>, headers?: Record<string, string>}} [more]
     */
    constructor(status: number, code: string, message: string, { hint, problems, extra, headers }?: {
        hint?: string;
        problems?: string[];
        extra?: Record<string, unknown>;
        headers?: Record<string, string>;
    });
    /** @returns {Reply} */
    reply(): Reply;
}
/**
 * The one error shape, as a reply.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {{hint?: string, problems?: string[]}} [more]
 */
export declare const errorReply: (status: number, code: string, message: string, more?: {
    hint?: string;
    problems?: string[];
}) => Reply;
/** The reply to a path that is not valid percent-encoding. */
export declare const badPath: () => Reply;
/**
 * @param {Store} store
 * @param {Options} options
 */
export declare function publishHandler(store: Store, { apiUrl, runLink, fileUrl, fileType, maxFileBytes, onError }: Options): {
    handle: (scope: any, req: Request) => Promise<Reply>;
    answer: (stored: StoredRun) => {
        result: string;
        state: string;
        summary: string | undefined;
        journey: {
            name: string;
            version: string;
            case: string | null;
        };
        failed: {
            step: number;
            id: string | undefined;
            check: string | undefined;
            says: string | undefined;
            by: string | undefined;
            verdict: string | undefined;
            status: string | undefined;
            claimed: string | undefined;
            cause: string | undefined;
            reason: string | undefined;
            proof: string | undefined;
            evidence: import("../format/runfile.js").Evidence[] | undefined;
            at: number | undefined;
            took: number | undefined;
            screenshots: {
                file_url: string;
                page_url: string | undefined;
            }[];
        }[];
        not_checked: {
            step: number;
            id: string | undefined;
            check: string | undefined;
            says: string | undefined;
            by: string | undefined;
            verdict: string | undefined;
            status: string | undefined;
            claimed: string | undefined;
            cause: string | undefined;
            reason: string | undefined;
            proof: string | undefined;
            evidence: import("../format/runfile.js").Evidence[] | undefined;
            at: number | undefined;
            took: number | undefined;
            screenshots: {
                file_url: string;
                page_url: string | undefined;
            }[];
        }[];
        passed_count: number;
        checks_count: number;
        videos: {
            user: unknown;
            starts_at: number | undefined;
            file_url: string;
        }[];
        missing: string[] | undefined;
        run_id: string;
        url: string;
    };
};
