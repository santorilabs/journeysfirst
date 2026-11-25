# Journeys First skills

Instructions that teach any agent to write, run, review and fix user journeys with its own tools. Plain Markdown with YAML front matter, so any agent with skills can read them.

| Skill | Use it to |
|---|---|
| [journey-onboard](../skills/journey-onboard/SKILL.md) | The first skill in a new product repo: read the product and its plans, find its foundation (who the users are, what good means to them, its UX rules, brand and design system), ask the person what code cannot tell, agree on its critical user journeys in `journeys/README.md`, draft the top journeys, and list what running them safely needs. It stops before running anything |
| [journey-build](../skills/journey-build/SKILL.md) | Build a new product from a request, journeys first: who it is for and what good means, then the journeys, before any code. Build to them, and use the product as each user before saying done |
| [journey-write](../skills/journey-write/SKILL.md) | Write or edit a journey from a spec, a ticket, a conversation, or by exploring a product. Also before a feature exists |
| [journey-run](../skills/journey-run/SKILL.md) | Run a journey safely, prove each check strictly, save a Playwright script and write the run folder |
| [journey-review](../skills/journey-review/SKILL.md) | Review a journey file or a walked run against 16 fixed criteria: is it intuitive, is it simple, does it stand on the product's own foundation. Half are settled by what the runner measured. Writes findings with evidence into the run. Changes nothing else |
| [journey-fix](../skills/journey-fix/SKILL.md) | Pick the cause (product, test, environment) of a failure and fix the right thing. Also what to do with a finding from a review |

Each skill starts by telling an existing product from a new build. On an existing product it reads the Foundation in `journeys/README.md` first. `journey-onboard` writes it: it points to the files where the product already states a part, measures what no file states, and asks the person for the rest. It never writes a principle nobody stated. On a new build, `journey-build` writes the journeys from the request before any code. The spacing, type sizes, fonts and corner radii the running product uses are measured by the first run, and its review writes them in one line.

The same steps every time live in commands, not skills: `npx journeysfirst init`, `upgrade`, `validate`, `validate-run`, `merge-check`, `measured`, `add-findings`, `add-review`, `review` and `publish`.

A skill loads only when an ask matches it. During onboarding, show the proposed Journeys section and ask before adding it to the project's agent instructions. `init` prints the proposal. Once approved, run `npx journeysfirst init --agent-instructions` to write it to an existing instructions file, or to create `AGENTS.md` if none exists. `upgrade` leaves instructions alone.

Every app also needs its own app skill, written from the [app skill template](../packages/core/templates/app-skill.md) (`node_modules/journeysfirst/templates/app-skill.md` once installed): safety, environments, accounts, seeding, inbound, sends, saved state. The generic skills say what to do. The app skill says where and how for that app.

The skills use journey format v1 (`journeysfirst/v1`) and run results v1. Draft 0 journeys still validate.

## Install

Any agent:

```bash
npx skills add santorilabs/journeysfirst --skill '*' --agent claude-code codex -y
```

It puts the skills in `.agents/skills` and links them for Claude Code. `--agent` names the agents to install for. Use your own list, like `--agent claude-code cursor`. `npx skills add --help` lists the names. Without `--skill`, `--agent` and `-y`, the command asks several questions and starts with no agent picked.

Then install the package and run `npx journeysfirst upgrade` (not plain `init`, since the skills are already there). That adds the Playwright config and the upgrade workflow:

```bash
npm install --save-dev journeysfirst @playwright/test
npx journeysfirst upgrade
npx playwright install --only-shell chromium
```

Or `npx journeysfirst init`, which copies the skills into `.agents/skills` and `.claude/skills`. Pass `--skills <folder>` to copy to one folder. The Journeys section names `.claude/skills` when that folder was written, and the folder you named otherwise. The app skill keeps its own name (`<app>-journeys`), so `init` and `upgrade` never touch it.

**Cursor.** Rules live in `.cursor/rules/`. Run `init --skills .agents/skills`, then add a rule that points at the files:

```markdown
---
description: Write, run, check or fix a user journey (.journey.yaml)
globs: ["journeys/**", "**/*.journey.yaml", "**/*.journey.spec.*"]
---
Follow .agents/skills/journey-run/SKILL.md.
```
