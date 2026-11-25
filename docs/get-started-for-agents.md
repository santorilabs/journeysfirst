# Get started: for agents

This page is for agents. The person you work for asked you to set up Journeys First in their repo. You install it, agree with them on what good means for their product, pick the top things a user must be able to do, and draft a test for each. You stop before running anything. They stay in this chat the whole time.

Journeys First is on npm as `journeysfirst`.

## 1. Check the repo

Find which version the repo has. Read `package.json`, not `node_modules`, which a fresh checkout does not have yet:

```bash
node -p "const fs = require('fs'); if (!fs.existsSync('./package.json')) 'no package.json'; else { const p = JSON.parse(fs.readFileSync('./package.json', 'utf8')); p.devDependencies?.journeysfirst ?? p.dependencies?.journeysfirst ?? 'not installed'; }"
npm view journeysfirst version
```

- `not installed`: you install it in step 3.
- `no package.json`: in a monorepo, check the web app folder. In a non-Node repo, step 3 creates a small `package.json` at the root and adds `node_modules/` to `.gitignore`.
- A version range, like `^0.0.1`: compare it with the newest version. Older: see **Upgrade**. The same: run `npm install` if `node_modules` is missing, and you are current.

If the repo has no `journeys/README.md`, it is not onboarded yet, even if Journeys First was set up before that file existed.

Then read the product for a few minutes: what it does, who uses it (people, agents or both), and what each one comes to do. You need this for step 2.

## 2. Tell them what Journeys First is, then ask

Write them one short message with these three parts, in your own words:

1. **What it is.** Journeys First keeps a short list, in their repo, of what each user of their product must be able to do, in plain sentences. Users can be people or agents. Agents build to that list and check every change against it as each user, and keep proof: screenshots and a video.
2. **What it could do for them.** One example from their product, from what you read. For example: "When the owner turns link sharing off, I check that the viewer loses access too, and keep a video of what the viewer sees." Pick a change where one user's action affects another user.
3. **What happens if they say yes.** You install the `journeysfirst` and `@playwright/test` dev dependencies plus Playwright's Chromium browser, then ask them a few questions about their product, one at a time. Together you pick the top things their users must be able to do, and you draft a journey for each. You don't run anything, and you don't commit anything until they say so.

Then the one question: "Go ahead?"

Keep it under 12 lines and plain-spoken. Name their product (avoid "this app" or "here", which can read as Journeys First). Keep setup details brief instead of pasting full shell commands or a full file list. Then wait for their answer.

## 3. Install

If it is already installed and current, skip to step 4.

```bash
npm install --save-dev journeysfirst @playwright/test
npx playwright install --only-shell chromium
```

- If the repo has a `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock`, install `journeysfirst` and `@playwright/test` as dev dependencies with that package manager instead of `npm`.
- `npm install` may reformat `package.json`. Read `git diff package.json`, keep the new dev dependencies and restore the rest. If the repo had no `package.json` before, add `node_modules/` to `.gitignore` if it is not ignored yet.
- If the skills are already in the repo (from `npx skills add santorilabs/journeysfirst`), that is fine. In step 4 (`journey-onboard`), run `npx journeysfirst upgrade` instead of `init` (pass `--skills .agents/skills` if the skills live in `.agents/skills`).

Then tell them in one line what changed: two dev dependencies in `package.json`, and a test browser on this computer, outside the repo.

## 4. Onboard

Read the `journey-onboard` skill (in your skills folder, or `node_modules/journeysfirst/skills/journey-onboard/SKILL.md`) and follow it. You already read the product, so don't ask what you already know. Ask the person one thing at a time, and wait for their answer.

When they approve the list, onboarding adds: a `journeys/` folder, the skills in `.agents/skills` and `.claude/skills` (or one folder, with `--skills <folder>`), a Journeys section in `AGENTS.md`, `playwright.config.js` if there is none, `journey-runs/` and `test-results/` in `.gitignore`, and `.github/workflows/journeysfirst-upgrade.yml`, which optionally opens a pull request for each new release once you add a `JOURNEYSFIRST_TOKEN` secret (see [auto-upgrade.md](https://raw.githubusercontent.com/santorilabs/journeysfirst/main/docs/auto-upgrade.md) for what access it needs). On a repo with no dev or start script, `init` also adds an example page and a journey that passes. Delete `demo/`, `journeys/see-the-example.journey.yaml` and `e2e/see-the-example.spec.js` when you write this product's journeys. Tell them this list before you add it.

You are done when the person has confirmed what good means and the top tests are drafted. Nothing is committed until they say so.

## Upgrade

A repo set up with [auto-upgrade.md](https://raw.githubusercontent.com/santorilabs/journeysfirst/main/docs/auto-upgrade.md) gets each release as a pull request from `.github/workflows/journeysfirst-upgrade.yml`. Review that pull request instead of upgrading by hand. When its journeys stopped the merge, use `journey-fix` on the runs it uploaded.

1. Run `npm install` if `node_modules` is missing. Read the new safety rules before you install: `npm pack journeysfirst@<new> --pack-destination /tmp`, then `tar -xOzf /tmp/journeysfirst-<new>.tgz package/skills/journey-run/SKILL.md`, section "2. Get a safe environment".
2. Get a "before" result for each journey. `journey-runs/` is not committed, so if there are no run folders, run the journeys once now on the old version. Set up the safe environment the new version asks for first, even though the old version is installed.
3. Install the new version, plus `@playwright/test` and the browser if they are missing: `npm install --save-dev journeysfirst@<new> @playwright/test && npx playwright install --only-shell chromium`.
4. `npx journeysfirst upgrade` (add `--skills <folder>` if the skills are not in `.agents/skills` and `.claude/skills`). It refreshes the skills in both of those folders, deletes retired ones and rewrites the Journeys section in `AGENTS.md` (and in a `CLAUDE.md` that does not import `@AGENTS.md`). It never touches the app skill. It lists each skill as added, updated, unchanged or removed. Read it, and `git diff` any skill it updated.
5. Check each saved script in `e2e/` against the evidence rules in `journey-run`. A read made with a service or admin key must say `key`, with the env var name the product's own code reads for that key (like `SUPABASE_SERVICE_ROLE_KEY`), not `login`. Fix any that do not.
6. If `journeys/README.md` has no Foundation section, add it: follow "Find the foundation" in `journey-onboard`. Each run now ends with `journey-review`, which reads it. `upgrade` prints this step when the section is missing.
7. Run the journeys again with `journey-run` and compare each result with step 2. Report the old and new version, the release notes ([CHANGELOG.md](https://github.com/santorilabs/journeysfirst/blob/main/CHANGELOG.md)), what `upgrade` printed, and each journey before and after.

## When something gets in the way

Do the safe thing and tell the person what you did. Ask only when there is no safe choice.

The skills are listed in [skills.md](https://raw.githubusercontent.com/santorilabs/journeysfirst/main/docs/skills.md).
