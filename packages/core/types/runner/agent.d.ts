/**
 * Run the caller's own agent command on a fresh copy of the project and save
 * what it submits as a run. Sign-in and sandboxing belong to that command.
 * @param {{journey: string, command: string, caseId?: string, project?: string, timeoutMs?: number}} options
 * @returns {Promise<{folder: string, run: import("../format/runfile.js").Run, problem?: string}>}
 */
export declare function runAgent({ journey, command, caseId, project, timeoutMs }: {
    journey: string;
    command: string;
    caseId?: string;
    project?: string;
    timeoutMs?: number;
}): Promise<{
    folder: string;
    run: import("../format/runfile.js").Run;
    problem?: string;
}>;
