// A TypeScript reader of the package, as a service would import it.
// package.test.js type-checks this file; it is never run.
import { caseIds, checkRun, journeyVersion, parseJourney, runDigest, runFiles, runResult, RUN_FORMAT, settle, stableJson, validateJourney, verifiedLists } from "journeysfirst";
import type { Journey, Run, Screenshot } from "journeysfirst";
import { publishRun } from "journeysfirst/publish";
import { expect, test } from "journeysfirst/playwright";
import type { JourneyRun } from "journeysfirst/playwright";
import { RunRecorder } from "journeysfirst/recorder";
import JourneyReporter from "journeysfirst/reporter";
import { startDevServer } from "journeysfirst/dev-server";
import { PublishError, errorReply } from "journeysfirst/publish-handler";
import { runAnswer } from "journeysfirst/run-answer";
import { isCheck, screenshotFile } from "journeysfirst/display";

const journey: Journey = parseJourney("format: journeysfirst/v1");
const problems: string[] = validateJourney(journey);
const version: string = journeyVersion(journey);
const cases: string[] = caseIds(journey);
declare const raw: Run;
const checked: { run: Run; settled: string[]; problems: string[] } = checkRun(raw, journey);
const settled: Run = settle(raw).run;
const result: "passed" | "failed" | "not_fully_checked" = runResult(raw.steps);
const lists: { verified: string[]; not_verified: string[] } = verifiedLists(raw.steps);
const files: string[] = runFiles(raw);
const digest: string = runDigest(raw, { "step-1.png": "aa" });
const text: string = stableJson({ b: 1, a: 2 });
const shots: Screenshot[] = ["step-1.png", { file: "step-2.png", url: "https://app.example.test/p/q3-plan" }];
const published: Promise<{ id: string; state: string }> = publishRun("journey-runs/x/1", { to: "https://journeys.example.test" });

// A product repo's journey spec, as test.journey is written in TypeScript.
test.journey("journeys/share-by-link.journey.yaml", async ({ journey, request }) => {
  const owner = await journey.page("you", { account: "qa+owner@example.test", login: (context, page) => page.goto("/signin/owner") });
  await journey.step(1, { by: "you" }, async () => {
    await owner.goto("/");
  });
  await journey.step(2, { by: "you" }, () => owner.reload());
  await journey.check("link-on", { by: "you" }, async () => {
    await expect(owner.getByText("Sharing on")).toBeVisible();
    return { passed: true, proof: "The toggle reads Sharing on.", evidence: [{ source: "page", login: "you", url: owner.url() }] };
  });
  await request.get("/health");
});
test.journey("journeys/share-by-link.journey.yaml", { case: "not-now", video: false }, async ({ journey }) => {
  journey.value("link", "https://app.example.test/p/q3-plan");
});
test("Playwright's own test still works", async ({ page }) => {
  await page.goto("/");
});
const run: JourneyRun | null = null;
const recorder: RunRecorder = RunRecorder.start({ journey: "journeys/share-by-link.journey.yaml" });
const reporter: JourneyReporter = new JourneyReporter({ outputDir: "journey-runs" });
const format: string = RUN_FORMAT;
const server: Promise<{ url: string }> = startDevServer({ port: 0, host: "127.0.0.1" });
const refused: PublishError = new PublishError(409, "conflict", "This run id was already published with different content.");
const reply: { status: number } = errorReply(404, "not_found", "There is no run with this id.");
const answer = runAnswer(raw, { runId: "r1", state: "sealed", url: "https://journeys.example.test/r/r1", fileUrl: (name) => `https://journeys.example.test/f/${name}` });
const checkIds: string[] = raw.steps.filter(isCheck).map((step) => step.id);
const firstShot: string | undefined = screenshotFile(shots[0]);

export { answer, checkIds, firstShot, format, recorder, refused, reply, reporter, run, server };
export { checked, digest, files, lists, problems, published, result, settled, shots, text, version, cases };
