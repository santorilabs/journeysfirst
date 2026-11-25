import { RunRecorder, recording } from "./recorder.js";
export type RunOptions = {
    journey: string;
    caseId?: string;
    project?: string;
    mcp?: Record<string, string[]>;
    timeoutMs?: number;
};
export type AdapterOptions = RunOptions & {
    container?: string;
    allowHostRead?: boolean;
    agentArgs: string[];
};
export type AgentResult = {
    folder: string;
    run: import("../format/runfile.js").Run;
    problem?: string;
    exitCode: number;
};
export type SandboxOptions = {
    work: string;
    home: string;
    auth: string;
    container?: string;
    hostHome?: string;
    loginFile?: string;
    runtime?: string;
    node: string;
};
export type AgentAdapter = {
    name: string;
    setup: string;
    detect(container?: string): boolean;
    authProbe(): boolean;
    sandboxArgs(options: SandboxOptions): string[];
    mcpConfig(config: Record<string, string[]>, sandbox: string[], state: string, work: string, runtime: string, node: string): {
        args: string[];
        names: string[];
    };
    start(options: AdapterOptions): Promise<AgentResult>;
};
export type RunContext = {
    base: string;
    work: string;
    state: string;
    run: RunRecorder;
    signal: AbortSignal;
    prompt: string;
};
/** @typedef {{journey: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, timeoutMs?: number}} RunOptions */
/** @typedef {RunOptions & {container?: string, allowHostRead?: boolean, agentArgs: string[]}} AdapterOptions */
/** @typedef {{folder: string, run: import("../format/runfile.js").Run, problem?: string, exitCode: number}} AgentResult */
/** @typedef {{work: string, home: string, auth: string, container?: string, hostHome?: string, loginFile?: string, runtime?: string, node: string}} SandboxOptions */
/** @typedef {{name: string, setup: string, detect(container?: string): boolean, authProbe(): boolean, sandboxArgs(options: SandboxOptions): string[], mcpConfig(config: Record<string,string[]>, sandbox: string[], state: string, work: string, runtime: string, node: string): {args: string[], names: string[]}, start(options: AdapterOptions): Promise<AgentResult>}} AgentAdapter */
/** @typedef {{base: string, work: string, state: string, run: RunRecorder, signal: AbortSignal, prompt: string}} RunContext */
/** @param {RunOptions & {command: string}} options */
export declare function runAgent({ command, mcp, timeoutMs, ...options }: RunOptions & {
    command: string;
}): Promise<AgentResult>;
/**
 * @param {RunOptions & {agent: string, label: string, loginFile?: string, unverified?: boolean}} options
 * @param {(context: RunContext) => Promise<{problem?: string, handoff?: string}>} execute
 * @returns {Promise<AgentResult>}
 */
export declare function withAgentRun({ journey, caseId, project, agent, label, loginFile, unverified }: RunOptions & {
    agent: string;
    label: string;
    loginFile?: string;
    unverified?: boolean;
}, execute: (context: RunContext) => Promise<{
    problem?: string;
    handoff?: string;
}>): Promise<AgentResult>;
/** @param {string | undefined} project @param {string} base @param {string} work @param {string} [loginFile] */
export declare function prepareProject(project: string | undefined, base: string, work: string, loginFile?: string): void;
/** @param {RunRecorder} run */
export declare function agentPrompt(run: RunRecorder): string;
/** @param {ReturnType<typeof recording>} seat @param {string} base */
export declare function importResults(seat: ReturnType<typeof recording>, base: string): string[];
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
