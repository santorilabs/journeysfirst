// Run each self journey against a broken build and check it fails for the right reason.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "node_modules/@playwright/test/cli.js");
const cases = [
  { file: "e2e/start-from-an-empty-project.spec.js", broken: "main", id: "first-run-passes", reason: "The first run did not pass.", folder: "start-from-an-empty-project" },
  { file: "e2e/let-an-agent-write-a-journey.spec.js", broken: "main", id: "result-on-every-line", reason: "The run did not show a result on every line.", folder: "let-an-agent-write-a-journey" },
  { file: "e2e/hand-a-project-to-a-new-agent.spec.js", broken: "main", id: "agent-sees-the-pass", reason: "The first run did not pass.", folder: "hand-a-project-to-a-new-agent" },
  { file: "e2e/run-the-journeys-a-change-covers.spec.js", broken: "selection", id: "other-journey-stays", reason: "The notes journey ran.", folder: "run-the-journeys-a-change-covers" },
];

mkdirSync("/tmp/jf-self", { recursive: true });
let bad = 0;
for (const item of cases) {
  const started = Date.now();
  const env = { ...process.env, CI: "1", JF_BROKEN: item.broken, JF_RUNS: "journey-runs-broken" };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  const result = spawnSync(process.execPath, [cli, "test", item.file, "-c", "playwright.config.js"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 240_000,
  });
  const ms = Date.now() - started;
  appendFileSync("/tmp/jf-self/times.log", `${item.folder} fail ${ms}\n`);
  console.log(`wall_ms ${item.folder} fail ${ms}`);
  const run = newest(join(root, "journey-runs-broken", item.folder));
  const check = run?.steps?.find((step) => step.id === item.id);
  const ok = result.status !== 0 && check?.verdict === "failed" && String(check.reason ?? "").includes(item.reason);
  if (!ok) {
    bad += 1;
    console.error(`\n${item.folder} did not fail for the right reason.`);
    console.error(`status ${result.status} check ${JSON.stringify(check)}`);
    console.error((result.stdout ?? "").slice(-2500));
    console.error((result.stderr ?? "").slice(-1500));
  } else {
    console.log(`failed as expected: ${item.folder} ${item.id}: ${check.reason}`);
  }
}
process.exit(bad === 0 ? 0 : 1);

/** @param {string} dir */
function newest(dir) {
  if (!existsSync(dir)) return null;
  const ids = readdirSync(dir).filter((id) => existsSync(join(dir, id, "run.json")));
  ids.sort((a, b) => statSync(join(dir, a, "run.json")).mtimeMs - statSync(join(dir, b, "run.json")).mtimeMs);
  if (!ids.length) return null;
  return JSON.parse(readFileSync(join(dir, ids.at(-1), "run.json"), "utf8"));
}
