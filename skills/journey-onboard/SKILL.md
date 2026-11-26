---
name: journey-onboard
description: Onboard an existing repo or product to Journeys First. Use when the repo has a product but no journeys/README.md yet.
---

# Onboard a product
Is there a product here yet? If there is only a request, follow `journey-build` instead.

If you already have a journey and a safe test setup, you can run it with `journey-run` before this skill.

The first thing you do is to research and understand the product. What does it do? What are the users? (humans? agents?) What does this product do for them?

You write down what good means for this product first, in `journeys/README.md`. Then you draft the top journeys and stop before running anything.

## What good looks like

Good is different for every product. Find out what it means for this one. Some questions that can help:

- Who are the users? People, agents, or both?
- What did each one come to do?
- What do they care about? What would they notice first if it got worse?
- When one user does something, what changes for the others?
- How should the product behave? What's its style? Its UX principles.
- How should it look and sound? Its brand and design system.

You write the answers under Foundation in `journeys/README.md`. Every other journey skill reads them before it starts.

## Write only what someone reads

This holds for every file and report a journey skill writes.

- Write a file or a section only if a later step or a person reads it.
- Leave a section or a row out when you have nothing for it.
- Say each fact once.
- Name the product, never "this app".
- It is about this product. If it would be just as true of another product, leave it out.
- Your own code is not a source for what good means. The request, the person, or code you did not write is.
- A report says what was built and what was not, in the product's words. Never restate the request as done.

## 1. Understand the product

Read before you ask anyone anything.

- **What does it do?** The README, `docs/`, `AGENTS.md` or `CLAUDE.md`, the routes or pages, the database schema.
- **Who uses it?** Sign-up and invite flows, roles and permissions. Then every way in: browser, email, text, API, MCP server, CLI, a pasted prompt. For each way in, ask twice: can a person come this way? Can an agent?
- **What does it do for them?** The landing page, the empty states, the onboarding screens. Read the source in the repo. Never sign in to anything.
- **Where is it going?** Roadmap, spec and task files. Open issues and recent PRs.

## 2. Find the foundation

The foundation is where the answers above live, in four parts: **Product principles** and **UX principles** (rules the team wrote, and calls a person made on a review), and, if it has a UI, **Brand** and **Design system**.

Every line you write can fail: "A reply shows without a reload", not "It feels fast". The rules in "Write only what someone reads" hold too.

Read files only. Do not start the app. For each part:

1. **Find it.** Look where teams keep these: agent files like `AGENTS.md`, docs on principles, design or brand, theme and token files, and the component folder.
2. **Reuse it.** Quote a rule of one or two lines, with its path. For anything longer, give the path only. Never write a second version.
3. **No file?** For Product and UX principles, confirm with the person (step 3). For Brand and Design system, leave the row out. The first run's review writes down what the product uses.
4. **Still missing?** Leave it out, and say so once in your report.

Product principles and UX principles are beliefs. They come from a file or from the person, never from you. A guess you offer in step 3 is marked "(guess)" until the person confirms it. No review finding rests on a guess.

## 3. Confirm with the person

Show the person what you found, short, each line with its source, and ask them to confirm it. Offer to do the rest of the setup in one go. Either way, stop before running anything (step 8).

Wait for the answers. Write each one down with the person's name, as a "What good means" line that can fail: "easy to pay" becomes "The client sees the invoice without signing in." Nobody to answer? Go on, and leave your guesses marked "(guess)".

## 4. Find what running safely needs

Do not assume it works. In a new product it usually does not. Read the code and config. Do not start the app or send anything. For each of these, say whether it exists, where, and what is missing:

- A local stack or a non-production environment, and how it starts.
- A test sign-in for each user in the journeys. An agent too, if one acts.
- A sink for each outside send (mail, SMS, chat, payments), or a way to prove sends are refused.
- Seed or reset for the state each journey starts from. A test-only route stays off unless a test setting turns it on.
- What the machine needs: the Node version, a container runtime.

Write what you find in the app skill, `.claude/skills/<app>-journeys/SKILL.md` (or `.agents/skills/<app>-journeys/SKILL.md` for Codex, Devin or Cursor), from `node_modules/journeysfirst/templates/app-skill.md`. Mark what you did not check as **Unverified**.

## 5. Write journeys/README.md

It holds the foundation and the journey list. Every line says where it came from: a file, an issue, the person or "guess".

Link, do not copy. When a fact already lives in a file (a design system, a style guide, a rule in `AGENTS.md`), link to that file and say in a few words what to find there. A copy goes stale when the file changes.

- `## Foundation`: what good means for this product, under the parts you found (Product principles, UX principles and, with a UI, Brand and Design system). The "What good means" lines are the product principles. Design system links to the files that hold the tokens (spacing, type, radius), so a review can read them.
- `## Journeys` and `## Running safely`.

Under **Journeys**, list the journeys that matter most:

- One line each, a promise in the user's words: "I can share a doc and my teammate opens it." Not "Doc sharing works."
- The most important first. Group by user or by area, whichever fits.
- Include the ways a user says no or backs out: cancel, turn off, decline, delete, unsubscribe, leave. No task asks for these, so a change can break them and nobody sees. Each is its own promise: "I can cancel my plan, and I am not charged again."
- Include planned promises, marked **planned**.
- Give each a status: **proven** (a passing run exists), **drafted** (a file, not run yet), or **not yet**, with what blocks it.

Under **Running safely**, put the list from step 4.

## 6. Agree on the list

Agree with the person on which journeys to draft first. Then update the file.

## 7. Draft the top journeys

- Run `npx journeysfirst init` to install the skills if needed. Use `npx journeysfirst upgrade` if the skills are already there and need updating. Pass `--skills <folder>` to use one folder. If init adds `demo/` and an example journey, they are not this product. Delete them before you draft the real journeys.
- Show the person the proposed Journeys section and where it will go. Use the project's existing agent instructions, such as `AGENTS.md` or `CLAUDE.md`. If there are none, propose creating `AGENTS.md`. Ask before writing anything to that file.
- The section should tell agents to write or update the matching journey when a change affects users, and to run it with `npx journeysfirst run journeys/<name>.journey.yaml` before saying it is done. After approval, apply the proposed section with `npx journeysfirst init --agent-instructions` (keep the same `--skills` option), or add it to the custom instructions file the person chose.
- For each top journey, follow `journey-write`, but write from what you read: skip its "Exploring a product that exists" section, since onboarding starts nothing and signs in to nothing. Each "What good means" line that applies becomes a check. Check each file with `npx journeysfirst validate`.
- A planned promise gets a journey too. It fails until the feature exists.
- Set each status to **drafted** in `journeys/README.md`.

## 8. Stop and ask

Tell the person, short: the journeys you drafted, where to open them, what you would set up first so they can run, and one question: go ahead? Do not run anything until they say so. Then follow `journey-run`. For terminal or MCP journeys, the run command is `npx journeysfirst run journeys/<name>.journey.yaml` in the test project.
