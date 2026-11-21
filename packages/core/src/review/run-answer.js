// What a service answers when an agent asks about one run: the verdict first,
// then what failed and what wasn't checked, with what it needs to fix it, then
// the link. GET /runs/{id} on the dev server answers this, and so can any
// service built on the publish protocol. No Node imports.
import { isCheck, screenshotFile, screenshotPage } from "../shared/display.js";

/**
 * @param {import("../format/runfile.js").Run} run the run as the service settled it when it was published (StoredRun.run). Never settled again here.
 * @param {{runId: string, state: string, url: string, fileUrl: (name: string) => string, missing?: string[]}} where
 *   fileUrl: where to fetch one of the run's files, with the same credentials as this answer.
 *   missing: files not uploaded yet, for an open run.
 */
export function runAnswer(run, { runId, state, url, fileUrl, missing }) {
  const steps = Array.isArray(run.steps) ? run.steps.filter((s) => s && typeof s === "object") : [];
  const checks = steps.filter(isCheck);
  /** @param {Partial<import("../format/runfile.js").ActionStep & import("../format/runfile.js").CheckStep>} step @param {number} n */
  const item = (step, n) =>
    compact({
      step: n,
      id: step.id,
      check: step.check,
      says: step.says,
      by: step.by,
      verdict: step.verdict,
      status: step.status,
      claimed: step.claimed,
      cause: step.cause,
      reason: step.reason,
      proof: step.proof,
      evidence: step.evidence?.length ? step.evidence : undefined,
      at: step.at,
      took: step.took,
      screenshots: (step.screenshots ?? []).map((s) => compact({ file_url: fileUrl(screenshotFile(s) ?? ""), page_url: screenshotPage(s) })),
    });
  const numbered = steps.map((step, i) => ({ step, n: i + 1 }));
  const media = Array.isArray(run.media) ? /** @type {import("../shared/display.js").MediaItem[]} */ (run.media) : [];
  return compact({
    result: run.result,
    state,
    summary: run.summary,
    journey: { name: run.journey?.name, version: run.journey?.version, case: run.journey?.case ?? null },
    failed: numbered.filter(({ step }) => (isCheck(step) ? step.verdict === "failed" : step.status === "failed")).map(({ step, n }) => item(step, n)),
    not_checked: numbered
      .filter(({ step }) => (isCheck(step) ? ["not_checked", "blocked"].includes(step.verdict) : step.status === "blocked"))
      .map(({ step, n }) => item(step, n)),
    passed_count: checks.filter((s) => s.verdict === "passed").length,
    checks_count: checks.length,
    videos: media.filter((m) => m?.kind === "video").map((m) => compact({ user: m.tags?.user, starts_at: m.starts_at, file_url: fileUrl(m.file) })),
    missing: state === "open" ? (missing ?? []) : undefined,
    run_id: runId,
    url,
  });
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} object
 * @returns {T}
 */
function compact(object) {
  return /** @type {T} */ (Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null)));
}
