/**
 * @param {import("../format/runfile.js").Run} run the run as the service settled it when it was published (StoredRun.run). Never settled again here.
 * @param {{runId: string, state: string, url: string, fileUrl: (name: string) => string, missing?: string[]}} where
 *   fileUrl: where to fetch one of the run's files, with the same credentials as this answer.
 *   missing: files not uploaded yet, for an open run.
 */
export declare function runAnswer(run: import("../format/runfile.js").Run, { runId, state, url, fileUrl, missing }: {
    runId: string;
    state: string;
    url: string;
    fileUrl: (name: string) => string;
    missing?: string[];
}): {
    result: string;
    state: string;
    summary: string | undefined;
    journey: {
        name: string;
        version: string;
        case: string | null;
    };
    failed: {
        step: number;
        id: string | undefined;
        check: string | undefined;
        says: string | undefined;
        by: string | undefined;
        verdict: string | undefined;
        status: string | undefined;
        claimed: string | undefined;
        cause: string | undefined;
        reason: string | undefined;
        proof: string | undefined;
        evidence: import("../format/runfile.js").Evidence[] | undefined;
        at: number | undefined;
        took: number | undefined;
        screenshots: {
            file_url: string;
            page_url: string | undefined;
        }[];
    }[];
    not_checked: {
        step: number;
        id: string | undefined;
        check: string | undefined;
        says: string | undefined;
        by: string | undefined;
        verdict: string | undefined;
        status: string | undefined;
        claimed: string | undefined;
        cause: string | undefined;
        reason: string | undefined;
        proof: string | undefined;
        evidence: import("../format/runfile.js").Evidence[] | undefined;
        at: number | undefined;
        took: number | undefined;
        screenshots: {
            file_url: string;
            page_url: string | undefined;
        }[];
    }[];
    passed_count: number;
    checks_count: number;
    videos: {
        user: unknown;
        starts_at: number | undefined;
        file_url: string;
    }[];
    missing: string[] | undefined;
    run_id: string;
    url: string;
};
