/**
 * Record steps and checks for one seat, using files selected by the runner.
 * @param {import("./recorder.js").RunRecorder} run
 * @param {string} by
 */
export declare function recording(run: import("./recorder.js").RunRecorder, by: string): {
    /**
     * Attach a private capture the runner has checked for secrets.
     * @param {string} name
     * @param {string} path
     * @param {{login: string, key?: never} | {key: string, login?: never} | "recorded"} [identity] the session the runner actually used
     */
    attach(name: string, path: string, identity?: {
        login: string;
        key?: never;
    } | {
        key: string;
        login?: never;
    } | "recorded"): string;
    /** @param {Parameters<typeof run.step>[0]} line @param {Omit<NonNullable<Parameters<typeof run.step>[1]>, "by">} [result] */
    step(line: Parameters<typeof run.step>[0], result?: Omit<NonNullable<Parameters<typeof run.step>[1]>, "by">): void;
    /**
     * Resolve refs against captures owned by this seat, not arbitrary paths.
     * @param {string} id
     * @param {Omit<NonNullable<Parameters<typeof run.check>[1]>, "by"|"evidence"> & {refs?: {file: string, line: number}[]}} [result]
     */
    check(id: string, { refs, ...result }?: Omit<NonNullable<Parameters<typeof run.check>[1]>, "by" | "evidence"> & {
        refs?: {
            file: string;
            line: number;
        }[];
    }): void;
};
