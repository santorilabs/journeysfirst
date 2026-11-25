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
