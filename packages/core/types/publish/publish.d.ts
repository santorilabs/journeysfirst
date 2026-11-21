/**
 * Publish a run folder. Pass the journey so the service can check the steps
 * match it; without it the run is published as unverified.
 * @param {string} folder
 * @param {{to: string, token?: string, fetch?: typeof globalThis.fetch, journey?: import("../format/format.js").Journey|null, sleep?: (ms: number) => Promise<void>}} options
 * @returns {Promise<{id: string, runId: string|null, digest: string, state: string, url: string|null, unverified: boolean, uploaded: string[], skipped: string[]}>}
 */
export declare function publishRun(folder: string, { to, token, fetch, journey, sleep }: {
    to: string;
    token?: string;
    fetch?: typeof globalThis.fetch;
    journey?: import("../format/format.js").Journey | null;
    sleep?: (ms: number) => Promise<void>;
}): Promise<{
    id: string;
    runId: string | null;
    digest: string;
    state: string;
    url: string | null;
    unverified: boolean;
    uploaded: string[];
    skipped: string[];
}>;
/**
 * The service's error as lines a person can read: the message, each problem,
 * then the hint. An older service sends the error as a plain string.
 * @param {any} body
 * @param {string} fallback
 * @returns {string}
 */
export declare function errorText(body: any, fallback: string): string;
