// Runs the steps of templates/journeysfirst-upgrade.yml in bash, as GitHub
// would, against a local git remote. gh, npm and npx are fakes that log their
// arguments, so nothing reaches GitHub or npm.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const WORKFLOW = parse(readFileSync(new URL("../templates/journeysfirst-upgrade.yml", import.meta.url), "utf8"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// FAKE_LATEST is the newest version on npm; FAKE_REQUIRED is the base branch's required checks.
const FAKE_GH = `#!/bin/bash
echo "gh $*" >> "$FAKE_LOG"
case "$1 $2" in
  "pr list") echo "$FAKE_PR" ;;
  "pr create") echo "https://github.example.test/pull/1" ;;
  "repo view") echo main ;;
  "api repos/acme/web/branches/main") [ -n "$FAKE_REQUIRED" ] && echo "$FAKE_REQUIRED" ;;
esac
exit 0
`;
const FAKE_NPM = `#!/bin/bash
echo "npm $*" >> "$FAKE_LOG"
case "$1" in
  view) echo "$FAKE_LATEST" ;;
  install) node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); p.devDependencies.journeysfirst = "^" + process.argv[1].split("@")[1]; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\\n");' "$3" ;;
esac
`;
// pnpm and yarn add a dependency like npm install; corepack only logs.
const fakeAdd = (name) => `#!/bin/bash
echo "${name} $*" >> "$FAKE_LOG"
case "$1" in
  add) node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json")); p.devDependencies.journeysfirst = "^" + process.argv[1].split("@")[1]; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\\n");' "$3" ;;
  exec|journeysfirst) echo "new skill" > .claude/skills/journey-run/SKILL.md; echo "journeysfirst $FAKE_LATEST upgrade" ;;
esac
`;
const FAKE_COREPACK = `#!/bin/bash
echo "corepack $*" >> "$FAKE_LOG"
`;
const FAKE_NPX = `#!/bin/bash
echo "npx $*" >> "$FAKE_LOG"
echo "new skill" > .claude/skills/journey-run/SKILL.md
echo "journeysfirst $FAKE_LATEST upgrade"
echo "  updated .claude/skills/journey-run"
`;

/** A product repo on journeysfirst 0.0.1 from npm (or from a vendor tarball), pushed to a bare remote. */
function product({ tarball = false, lockfile = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jf-upgrade-"));
  const remote = join(dir, "remote.git");
  const work = join(dir, "work");
  const bin = join(dir, "bin");
  git(dir, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  mkdirSync(join(work, "vendor"), { recursive: true });
  mkdirSync(join(work, ".claude/skills/journey-run"), { recursive: true });
  const spec = tarball ? "file:vendor/journeysfirst-0.0.18.tgz" : "^0.0.1";
  writeFileSync(join(work, "package.json"), `${JSON.stringify({ devDependencies: { journeysfirst: spec } }, null, 2)}\n`);
  if (tarball) writeFileSync(join(work, "vendor/journeysfirst-0.0.18.tgz"), "old");
  if (lockfile) writeFileSync(join(work, lockfile.name), lockfile.text);
  writeFileSync(join(work, "vendor/other.tgz"), "not ours");
  writeFileSync(join(work, ".claude/skills/journey-run/SKILL.md"), "old skill\n");
  git(dir, "init", "--quiet", "--initial-branch=main", work);
  git(work, "add", "--all");
  git(work, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "--quiet", "-m", "start");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "--quiet", "origin", "main");
  mkdirSync(bin);
  for (const [name, text] of Object.entries({ gh: FAKE_GH, npm: FAKE_NPM, npx: FAKE_NPX, pnpm: fakeAdd("pnpm"), yarn: fakeAdd("yarn"), corepack: FAKE_COREPACK })) {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  }
  return { dir, remote, bin };
}

/** Check out main afresh and run every step that has a `run`, in order, the way Actions does. */
function runWorkflow({ dir, remote, bin }, { latest, required = "journeys", event = "schedule", pr = "", token = "fake" }) {
  const work = mkdtempSync(join(dir, "checkout-"));
  git(dir, "clone", "--quiet", "--depth", "1", `file://${remote}`, work);
  const output = join(work, "..", `${work.split("/").pop()}.output`);
  const log = join(dir, "calls.log");
  writeFileSync(output, "");
  writeFileSync(log, "");
  const base = {
    ...process.env,
    ...WORKFLOW.env,
    JOURNEYS_CHECK: "journeys",
    PATH: `${bin}:${process.env.PATH}`,
    GH_TOKEN: token,
    GITHUB_OUTPUT: output,
    GITHUB_REPOSITORY: "acme/web",
    GITHUB_EVENT_NAME: event,
    RUNNER_TEMP: dir,
    FAKE_LOG: log,
    FAKE_LATEST: latest,
    FAKE_REQUIRED: required,
    FAKE_PR: pr,
  };
  let stdout = "";
  for (const step of WORKFLOW.jobs.upgrade.steps) {
    if (!step.run) continue;
    const outputs = Object.fromEntries(readFileSync(output, "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
    const expand = (/** @type {string} */ text) => text.replace(/\$\{\{ steps\.versions\.outputs\.(\w+) \}\}/g, (_, key) => outputs[key] ?? "");
    if (step.if === "steps.versions.outputs.upgrade == 'yes'" && outputs.upgrade !== "yes") continue;
    assert.ok(!step.if || step.if === "steps.versions.outputs.upgrade == 'yes'", `this test does not know the condition ${step.if}`);
    const env = { ...base, ...Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, expand(String(v))])) };
    const done = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], { cwd: work, env, encoding: "utf8" });
    stdout += done.stdout + done.stderr;
    assert.equal(done.status, 0, `${step.name} failed:\n${done.stdout}${done.stderr}`);
  }
  return { stdout, calls: readFileSync(log, "utf8"), work };
}

test("the upgrade workflow does nothing when the repo is on the newest version", () => {
  const repo = product();
  const { stdout, calls } = runWorkflow(repo, { latest: "0.0.1" });
  assert.match(stdout, /On journeysfirst 0\.0\.1, the newest version\. Nothing to do\./);
  assert.match(calls, /npm view journeysfirst version/);
  assert.doesNotMatch(calls, /npm install|pr create|pr merge/);
  assert.equal(git(repo.remote, "branch", "--list", "journeysfirst/upgrade"), "");
});

test("the upgrade workflow installs the new version from npm, opens one pull request and turns on auto-merge", () => {
  const repo = product();
  const { stdout, calls } = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(stdout, /Upgrading journeysfirst 0\.0\.1 to 0\.0\.2\./);
  assert.match(calls, /npm install --save-dev journeysfirst@0\.0\.2/);
  assert.match(calls, /npx journeysfirst upgrade/);
  assert.doesNotMatch(calls, /gh release/);
  assert.match(calls, /gh pr create --head journeysfirst\/upgrade --title Journeys First 0\.0\.2/);
  assert.match(calls, /gh pr merge journeysfirst\/upgrade --auto --squash/);
  assert.match(git(repo.remote, "show", "journeysfirst/upgrade:package.json"), /"journeysfirst": "\^0\.0\.2"/);
  assert.equal(git(repo.remote, "show", "journeysfirst/upgrade:.claude/skills/journey-run/SKILL.md"), "new skill");
  const body = readFileSync(join(repo.dir, "body.md"), "utf8");
  assert.match(body, /## Problem\n\nThis repo is on journeysfirst 0\.0\.1\. 0\.0\.2 is out\./);
  assert.match(body, /ran `npm install --save-dev journeysfirst@0\.0\.2` and `npx journeysfirst upgrade`/);
  assert.doesNotMatch(body, /tarball/);
  assert.match(body, /updated \.claude\/skills\/journey-run/);
  assert.match(body, /unless the same check was blocked in main's newest run/);
});

test("the upgrade workflow moves a repo on a vendor tarball to npm once, whatever the tarball's version", () => {
  const repo = product({ tarball: true });
  const { stdout, calls } = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(stdout, /journeysfirst comes from a tarball in vendor\/\. Moving it to npm, version 0\.0\.2\./);
  assert.match(calls, /npm install --save-dev journeysfirst@0\.0\.2/);
  const files = git(repo.remote, "ls-tree", "-r", "--name-only", "journeysfirst/upgrade");
  assert.doesNotMatch(files, /journeysfirst-0\.0\.18\.tgz/);
  assert.match(files, /vendor\/other\.tgz/, "only journeysfirst tarballs are removed");
  assert.match(git(repo.remote, "show", "journeysfirst/upgrade:package.json"), /"journeysfirst": "\^0\.0\.2"/);
  assert.match(readFileSync(join(repo.dir, "body.md"), "utf8"), /installs journeysfirst from a tarball in `vendor\/`\. Journeys First is on npm now/);
  const again = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(again.stdout, /journeysfirst\/upgrade already has journeysfirst 0\.0\.2/);
});

test("without the token, the upgrade workflow says a new version is out and passes", () => {
  const repo = product();
  const { stdout, calls } = runWorkflow(repo, { latest: "0.0.2", token: "" });
  assert.match(stdout, /::warning::journeysfirst 0\.0\.2 is out\. To get it as a pull request, set the JOURNEYSFIRST_TOKEN secret/);
  assert.match(stdout, /npm install --save-dev journeysfirst@0\.0\.2 && npx journeysfirst upgrade/);
  assert.doesNotMatch(calls, /npm install|gh /);
  assert.match(runWorkflow(product(), { latest: "0.0.1", token: "" }).stdout, /Nothing to do\./);
});

test("the upgrade workflow leaves auto-merge off unless the journeys check is required", () => {
  for (const required of ["", "contract", "contract\nPR description", "journeys-lint"]) {
    const { stdout, calls } = runWorkflow(product(), { latest: "0.0.2", required });
    assert.match(calls, /gh pr create/);
    assert.doesNotMatch(calls, /gh pr merge/, `required: ${JSON.stringify(required)}`);
    assert.match(stdout, /journeys is not a required check on main, so auto-merge is off/);
  }
  const { calls } = runWorkflow(product(), { latest: "0.0.2", required: "contract\njourneys" });
  assert.match(calls, /gh pr merge journeysfirst\/upgrade --auto --squash/);
});

test("the upgrade workflow updates the open pull request, and skips a version its branch already has", () => {
  const repo = product();
  runWorkflow(repo, { latest: "0.0.2" });
  const again = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(again.stdout, /journeysfirst\/upgrade already has journeysfirst 0\.0\.2/);
  assert.doesNotMatch(again.calls, /npm install|pr create/);
  const byHand = runWorkflow(repo, { latest: "0.0.2", event: "workflow_dispatch", pr: "7" });
  assert.match(byHand.calls, /npm install --save-dev journeysfirst@0\.0\.2/);
  const newer = runWorkflow(repo, { latest: "0.0.3", pr: "7" });
  assert.match(newer.calls, /gh api --method PATCH repos\/acme\/web\/pulls\/7 -f title=Journeys First 0\.0\.3/);
  assert.doesNotMatch(newer.calls, /gh pr create/);
  assert.match(git(repo.remote, "show", "journeysfirst/upgrade:package.json"), /"journeysfirst": "\^0\.0\.3"/);
});

test("the upgrade workflow installs with pnpm in a pnpm repo, on the pnpm version its lockfile was made with", () => {
  const repo = product({ lockfile: { name: "pnpm-lock.yaml", text: "lockfileVersion: '6.0'\n" } });
  const { calls } = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(calls, /corepack prepare pnpm@8 --activate/);
  assert.match(calls, /pnpm add --save-dev journeysfirst@0\.0\.2/);
  assert.match(calls, /pnpm exec journeysfirst upgrade/);
  assert.doesNotMatch(calls, /npm install|npx journeysfirst/);
  assert.match(readFileSync(join(repo.dir, "body.md"), "utf8"), /ran `pnpm add --save-dev journeysfirst@0\.0\.2`/);
});

test("the upgrade workflow installs with yarn in a yarn repo", () => {
  const repo = product({ lockfile: { name: "yarn.lock", text: "# yarn lockfile v1\n" } });
  const { calls } = runWorkflow(repo, { latest: "0.0.2" });
  assert.match(calls, /corepack enable/);
  assert.match(calls, /yarn add --dev journeysfirst@0\.0\.2/);
  assert.match(calls, /yarn journeysfirst upgrade/);
  assert.doesNotMatch(calls, /npm install|npx journeysfirst/);
});
