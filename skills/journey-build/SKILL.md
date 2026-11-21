---
name: journey-build
description: Build a new product journeys first, from a request. Use when the repo has no product yet, only a request like "build a site where...".
---

# Build a new product

The request says what to build. It is the start, not the edge. A real person signs up, comes back tomorrow, changes their own things, and expects to be told when something worked. They never asked for any of that, because every product they use already does it.

The first thing you do is understand the people the product is for. Then you write their journeys, build to them, and use the product as each of them before you say it is done.

Install `journeysfirst` and `@playwright/test` as dev dependencies, then run `npx journeysfirst init`. Say your plan in one line first.

## 1. Who it is for, and what good means

Write `journeys/README.md` with `## Foundation` and `## Journeys`.

Work like a good PM. Who are the users? What are they trying to get done? What would make them say "that's what I needed"? What would they expect without asking, because any product like this does it? Write each answer under Foundation as a "What good means" line that can fail. The request's own words are in there too, and no line asks for less than they do.

```text
Weak:   "view their personal information": the profile page shows the user's name.
Strong: "view their personal information": a student sees their name, email and groups,
        and can change their name and email.
```

If it has a UI, work like a top designer too, with a high quality bar. Give one subagent a single job: find 2 or 3 real products these users already know, open each in a browser, screenshot the screen most like one you will build, and save them in `journeys/references/`. Wait for it. Under Brand, write one line per reference: the file, and the quality to take from it. Then set a small design system from those lines (a spacing scale, a type scale, a few components), write where it lives, and use only that.

Nobody to ask? Go on. Nobody needs to agree to these lines.

## 2. Write the journeys

Before any code, follow `journey-write`, "Before the feature exists": one journey for each thing a user comes to do. Each "What good means" line about what a user does is a check in one of them. A journey written after the build describes the build, so it cannot catch what the build left out.

## 3. Build to the journeys

Build a real product for those people, never what is easier to test. Use your design system. Then add `## Running safely` to the README: how the app starts and how a test user signs in, one line each.

## 4. Use it as each user

Walk each journey as each user, in a real browser (`journey-run`, `journey-review`). Look at every screenshot and watch the videos. Judge the quality and the experience the way that user would, and fix what falls short.

Then start a subagent that did not build it. Give it the request, the users and the references, never the journeys or the code. It uses the product as each user would, over more than one visit, and judges it as a top designer would. Fix what it finds, then ask a new one, until it finds nothing.

## Done

You are done when every journey passes and a fresh subagent finds nothing. Your report says what was built, in the product's words, beside the check that proves it. Anything not built comes first. Write it by "Write only what someone reads" in `journey-onboard`.
