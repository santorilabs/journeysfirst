/**
 * Launch Codex with a fresh project and a separately protected provider login.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: Record<string, string[]>, container?: string, allowHostRead?: boolean, timeoutMs?: number, agentArgs: string[]}} options
 */
export declare function runCodex({ journey, caseId, project, mcp, container, allowHostRead, timeoutMs, agentArgs }: {
    journey: string;
    caseId?: string;
    project?: string;
    mcp?: Record<string, string[]>;
    container?: string;
    allowHostRead?: boolean;
    timeoutMs?: number;
    agentArgs: string[];
}): Promise<{
    folder: string;
    run: import("./recorder.js").Run;
    problem: string | undefined;
    exitCode: number;
}>;
export declare const codex: {
    name: string;
    setup: string;
    /** @param {string} [container] */
    detect: (container?: string) => boolean;
    authProbe: () => boolean;
    sandboxArgs: typeof sandboxArgs;
    mcpConfig: typeof mcpConfig;
    start: typeof runCodex;
};
/** @param {{work: string, home: string, auth: string, container?: string, hostHome?: string, loginFile?: string, runtime?: string, node: string}} path */
declare function sandboxArgs({ work, home, auth, container, hostHome, loginFile, runtime, node }: {
    work: string;
    home: string;
    auth: string;
    container?: string;
    hostHome?: string;
    loginFile?: string;
    runtime?: string;
    node: string;
}): string[];
/** @param {Record<string,string[]>} config @param {string[]} sandbox @param {string} state @param {string} work @param {string} runtime @param {string} node */
declare function mcpConfig(config: Record<string, string[]>, sandbox: string[], state: string, work: string, runtime: string, node: string): {
    args: string[];
    names: string[];
};
export {};
