import { RunRecorder, recording } from "./recorder.js";
/**
 * Run the caller's own agent command on a fresh copy of the project and save
 * what it submits as a run. Sign-in and sandboxing belong to that command.
 * @param {{journey: string, command: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, timeoutMs?: number}} options
 * @returns {Promise<{folder: string, run: import("../format/runfile.js").Run, problem?: string, exitCode: number}>}
 */
export declare function runAgent({ journey, command, caseId, project, mcp, timeoutMs }: {
    journey: string;
    command: string;
    caseId?: string;
    project?: string;
    mcp?: Record<string, string[]>;
    timeoutMs?: number;
}): Promise<{
    folder: string;
    run: import("../format/runfile.js").Run;
    problem?: string;
    exitCode: number;
}>;
/** @param {string | undefined} project @param {string} base @param {string} work @param {string} [loginFile] */
export declare function prepareProject(project: string | undefined, base: string, work: string, loginFile?: string): void;
/** @param {RunRecorder} run */
export declare function agentPrompt(run: RunRecorder): string;
/** @param {ReturnType<typeof recording>} seat @param {string} state */
export declare function importResults(seat: ReturnType<typeof recording>, state: string): string[];
/** @param {string} path */
export declare function readSmall(path: string): string;
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, stdin: string, timeout: number, signal?: AbortSignal, shell?: boolean}} options
 * @returns {Promise<{code: number | null, stdout: string, timedOut: boolean}>}
 */
export declare function processResult(command: string, args: string[], { cwd, env, stdin, timeout, signal, shell }: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdin: string;
    timeout: number;
    signal?: AbortSignal;
    shell?: boolean;
}): Promise<{
    code: number | null;
    stdout: string;
    timedOut: boolean;
}>;
/** @param {string | undefined} file @param {string} project */
export declare function readMcpServers(file: string | undefined, project: string): {
    [k: string]: string[];
};
