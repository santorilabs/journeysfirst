export type DoctorLine = {
    ok: boolean;
    name: string;
    says: string;
};
export type PlaywrightStatus = {
    installed: boolean;
    browser: boolean;
    executablePath?: string;
    error?: string;
};
export type FetchReply = {
    status?: number;
};
/**
 * @typedef {{ok: boolean, name: string, says: string}} DoctorLine
 * @typedef {{installed: boolean, browser: boolean, executablePath?: string, error?: string}} PlaywrightStatus
 * @typedef {{status?: number}} FetchReply
 */
/**
 * @param {{root?: string, node?: string, playwright?: () => Promise<PlaywrightStatus>, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{ok: boolean, lines: DoctorLine[]}>}
 */
export declare function doctor({ root, node, playwright, fetchImpl }?: {
    root?: string;
    node?: string;
    playwright?: () => Promise<PlaywrightStatus>;
    fetchImpl?: typeof fetch;
}): Promise<{
    ok: boolean;
    lines: DoctorLine[];
}>;
