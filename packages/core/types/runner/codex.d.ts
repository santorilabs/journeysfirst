import { RunRecorder } from "./recorder.js";
/**
 * Launch Codex with a fresh project and a separately protected provider login.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: string, container?: string, allowHostRead?: boolean, timeoutMs?: number, agentArgs: string[]}} options
 */
export declare function runCodex({ journey, caseId, project, mcp, container, allowHostRead, timeoutMs, agentArgs }: {
    journey: string;
    caseId?: string;
    project?: string;
    mcp?: string;
    container?: string;
    allowHostRead?: boolean;
    timeoutMs?: number;
    agentArgs: string[];
}): Promise<{
    folder: string;
    run: import("../format/runfile.js").Run;
    problem: string | undefined;
}>;
/**
 * Copy a trusted signed-out project, or start an empty one, and add the capture helper an agent runs.
 * @param {{project?: string, base: string, work: string}} folders
 */
export declare function prepareWork({ project, base, work }: {
    project?: string;
    base: string;
    work: string;
}): void;
/**
 * Record what the agent submitted for the "you" seat, and tag lines that could not be read.
 * @param {RunRecorder} run @param {string} state
 */
export declare function importResults(run: RunRecorder, state: string): void;
/**
 * Seal and save the run. A run that would pass after a problem is not saved.
 * @param {RunRecorder} run @param {string | undefined} problem
 */
export declare function saveRun(run: RunRecorder, problem: string | undefined): {
    folder: string;
    run: import("../format/runfile.js").Run;
    problem: string | undefined;
};
/**
 * The journey as the agent sees it, without notes or setup hints.
 * @param {RunRecorder} run
 */
export declare function agentPrompt(run: RunRecorder): string;
/**
 * The real folder of an executable on PATH, so a sandbox that hides the home directory can still run it.
 * @param {string} name
 */
export declare function installDirectory(name: string): string | undefined;
/**
 * Read a regular file up to the capture limit, without following links. Missing or unsafe files read as "".
 * @param {string} path
 */
export declare function readSmall(path: string): string;
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, stdin: string, timeout: number}} options
 * @param {string} [secretInput] written to file descriptor 3, so it never sits in the child's environment or arguments
 * @returns {Promise<{code: number | null, stdout: string, timedOut: boolean}>}
 */
export declare function processResult(command: string, args: string[], { cwd, env, stdin, timeout }: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdin: string;
    timeout: number;
}, secretInput?: string): Promise<{
    code: number | null;
    stdout: string;
    timedOut: boolean;
}>;
