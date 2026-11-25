/**
 * Launch Claude Code with a fresh project, a clean home and a subscription login that its commands cannot read.
 * @param {{journey: string, caseId?: string, project?: string, mcp?: string, allowHostRead?: boolean, allowDomains?: string[], timeoutMs?: number, agentArgs: string[]}} options
 */
export declare function runClaude({ journey, caseId, project, mcp, allowHostRead, allowDomains, timeoutMs, agentArgs }: {
    journey: string;
    caseId?: string;
    project?: string;
    mcp?: string;
    allowHostRead?: boolean;
    allowDomains?: string[];
    timeoutMs?: number;
    agentArgs: string[];
}): Promise<{
    folder: string;
    run: import("../index.js").Run;
    problem: string | undefined;
}>;
