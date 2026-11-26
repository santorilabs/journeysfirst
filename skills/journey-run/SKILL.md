---
name: journey-run
description: Run a journey against the app, prove each check, and write a run folder anyone can review. Use when asked to run, test or check a journey, or before you say a change a user can see is done.
---

# Run a journey

Read the Foundation in `journeys/README.md` if it exists. If you already have a journey and know the safe test setup, you can run it before onboarding. A new build: the README's "Running safely" lines are your app skill.

The first thing you do is find out who you are playing. Then you run the journey the way each user would, prove each check, and write one run folder anyone can review. You own every check in the journey. Do not leave checks to a supervising runner. If you cannot prove a check, record what stopped you. The run results spec is `node_modules/journeysfirst/spec/run-results-v1.md`. Code enforces the limits: a pass needs evidence from the right login, and the run file must match the journey line by line.

## 1. Read

- The journey: `journeys/<name>.journey.yaml`. Run `npx journeysfirst validate` on it first.
- The app skill: environments, test accounts, sign-in, seeding, sending things in, reading what the app sent. If there is none and running needs more than "Running safely" says, write one from `node_modules/journeysfirst/templates/app-skill.md` as you go.
- A saved script, if any (`e2e/<name>.spec.js`). Replay it first. Drive live only when it breaks (see `journey-fix`).
- If the journey has `cases`, one run is one case. Run each case you were asked for.

## 2. Get a safe environment

Nothing may leave the test environment.

- **Never production.** Use a local app, a preview or a staging environment the app skill names.
- **Test accounts only.** Check every account against the app skill's rule before you sign in, seed, wipe or send.
- **Real sends must be impossible:** email, SMS, chat messages, payments, any write to a third party. The environment enforces it (a sandbox key, a mail catcher, a fake provider, no provider key). Your own care is not a block.
- **Show the block before you run.** Show that a real send is refused or caught. If you cannot, the checks it touches are `blocked` with cause `environment`.

No safe environment, no test sign-in, or no sink for a send: the affected checks are `blocked` with cause `environment`, not failed.

## 3. Make `start` true

- Use the app's setup script or its own API, like sign-up. Use the browser only when it is the only way. Never add a route for tests that is on in the product. Never change how the product works, like where it keeps data, to make runs easier: get a clean start from the test side, like a fresh data folder or fresh accounts.
- Users who exist at the start get fresh accounts. Users who join during the journey start with only a fresh email.
- On a shared database, use fresh values for anything that could collide. Record each `${name}` and its value in `values`. Mark secrets `secret: true`. The recorder then refuses to write the run if that value shows up anywhere else in it, so keep it out of evidence and reasons.
- Open the app and confirm `start` is really true.

## 4. Do each line

For a terminal or MCP journey, run `npx journeysfirst run journeys/<name>.journey.yaml` from the trusted test project. This picks a signed-in agent CLI and records configured stdio MCP servers. Use `--mcp <file.json>` to select only the test servers in that file. Read the saved run to see what passed. Use `capture` or `mcp-proxy` by hand only when you drive the run yourself.

Leave `TMPDIR` unset or point it to a writable folder outside the test project. If another agent's sandbox stops the launcher from starting its own sandbox, run the same command from a regular host terminal or a compatible container. Do not turn off a safety check to get a passing run.

- Each line is done by the user it starts with, in their own login and their own browser context, the way they would do it.
- Do exactly what the sentence says. Type quoted input word for word.
- Take a screenshot after each line, from that user's page. Record a video per user. Both are published with the run, so nothing secret may be on screen at any point: no real passwords, keys, tokens or real people's data.
- A user with no browser gets no screenshot. Save what they got as a file and name it in the evidence (`journey.recorder.attach`).

## 5. Prove each check

A check passes only when the evidence proves the sentence. A screenshot shows what one user saw at one moment. It cannot show that data was saved, that another user sees it, or that a text went out.

Each check has a `verdict` (`passed`, `failed`, `blocked` or `not_checked`), `by` (whose view it is about: `you` or a name from `users`), `proof` (one plain sentence), and `evidence` someone else can repeat. Each evidence item has a `source` (`page`, `api`, `database`, `log` or `message`), the `login` that made the read, and what finds it again: `url`, `query` or `message_id`. Failed or blocked: add `cause` (`product`, `test` or `environment`) and `reason`.

A pass needs evidence from the login of the user in `by`. Without it, code turns the check into `not_checked`.

```js
{ source: "database", login: "you", query: "select status from invoices where id = $1", params: [invoiceId], got: [{ status: "paid" }] }
{ source: "page", login: "viewer", url: "https://staging.example.test/p/q3-plan", saw: "the presentation, not an error" }
```

**Read the sentence word by word.** "One", "still", "after a reload", "without signing in" and "the viewer" are each part of the promise. "The viewer sees..." is proven in the viewer's own login. What you see does not prove what they see.

**Filter every read** by the run's start time and the run's own accounts. Shared databases hold other runs' rows.

**Admin or service key reads.** Name the key in `key` instead of `login`: the env var name the product's own code reads, never its value. It adds to a check and never replaces the user's own evidence.

### Weak and strong proof

| The check says | Weak | Strong |
|---|---|---|
| Another user sees it | Your tab, or a new tab in the same context (your cookies). | A separate context signed in as that user, or signed out if that is the promise. |
| It was saved | The toggle looks on. The save returned 200. | Reload, then read the stored row or the GET endpoint. |
| It stays after a reload | Navigate away and back (state in memory). | Reload the user's page, wait for it, then check. |
| It stays after a restart | Reload the page. The server still holds it in memory. | Stop the server process and start it again from the test, sign in again, then check. Playwright's `webServer` starts it once and never restarts it. |

**A count of sends.** Count at the capture point the app skill names, filtered by recipient, kind and time since the run started. Expect the exact count and list each id: `{ source: "message", login: "you", message_id: "fc46a4", to: "${phone}", count: 1 }`. "No text is sent" is a count of zero. `null` means you did not capture it.

**Evidence disagrees.** The screen says one thing and the database another: the check fails. Name the source that disagreed in `reason`. Do not pick the one that passes.

**The check is unclear.** If you cannot tell what would prove the sentence, mark it `not_checked`, say what is missing, and suggest a clearer sentence. Do not invent a weaker check.

**Plain words.** People paste `proof`, `reason`, `summary` and captions into PRs. Say what you did and what you saw, one fact per sentence. Keep every name, value, count and id. No "verified that", "as expected" or hedges.

```text
Weak:   It appears the viewer may still potentially have access.
Strong: The viewer still sees "Q3 plan" after sharing was turned off.
```

## 6. Save the script

Save what worked as a Playwright script in `e2e/`, so the next run replays it.

```js
import { test } from "journeysfirst/playwright";

test.journey("journeys/share-by-link.journey.yaml", async ({ journey }) => {
  const you = await journey.page("you", { account: "owner@example.test", login: (context, page) => page.goto(signInLink) });
  await journey.step(1, { by: "you", caption: "You turn on link sharing and copy the link." }, async () => {
    // the clicks that worked
    journey.value("link", await you.evaluate(() => navigator.clipboard.readText()));
  });
  await journey.check("link-on", { by: "you", caption: "Checking that link sharing stays on after a reload." }, async () => {
    await you.reload();
    const saved = await (await you.request.get("/api/share")).json();
    const on = saved.linkSharing === true;
    return { passed: on, proof: "Reloaded and read the saved setting.", evidence: [{ source: "api", login: "you", url: "/api/share", got: saved }],
      reason: `The saved setting is linkSharing=${saved.linkSharing}.`, caption: on ? "link sharing is still on." : "link sharing turned off." };
  });
});
```

- `journey.page(user, { account, login, storageState })` gives each user their own context, with clipboard access and video. No `login` means signed out.
- `journey.step(sentence or line number, { by }, fn)` and `journey.check(id, { by }, fn)` follow the journey's lines.
- Return `passed: false` with a `reason` when the product is wrong (cause `product`). A check that throws or returns nothing is `blocked` with cause `test`. The test fails unless the run's result is `passed`.
- Give every step, check and check result a `caption`: one plain sentence, no ids. It shows in the video.
- The runner measures each user's screen after each line, for the review. You write no code for it.
- Select a journey with `npx playwright test --grep "<journey title>"`. The port, `measure`, `repos`, captions and `pause`: `docs/run-in-code.md` in santorilabs/journeysfirst.

## 7. Write the run folder

- With Playwright, the reporter writes `journey-runs/<name>/<run id>/`: `run.json`, `step-<n>.png`, `<user>.webm`.
- Without Playwright, use `RunRecorder` from `journeysfirst/recorder` (`start`, `user`, `step`, `check`, `blocked`, `finish`; example in `docs/run-in-code.md`). Pass `at` and `took` (seconds from the run's start) on each step and check, and `starts_at` on each video in `attach`, so a person can jump to a step in the video.

- Check it: `npx journeysfirst validate-run journey-runs/<name>/<run id>`. It prints `ok`, the result, how many checks passed, and `Steps match journeys/<name>.journey.yaml.` Fix any other message before you report.
- Look at it: `npx journeysfirst review journey-runs` serves the runs at `http://127.0.0.1:4400`, on this machine only (`--port`, `--host`).

## 8. Review the run

Follow `journey-review` on the run folder while the environment is still up. It reads the screenshots and the `measure` files, writes `findings` into the run, and shows them to the person. A finding never changes a verdict or the run's result. A run driven by hand, with no saved script, has no `measure` files, so the review says "not measured" for the criteria that need them.

A run is done when `validate-run` says ok, the steps match, and it prints a `Review:` line. If it says `Not reviewed.`, follow `journey-review`, then run `npx journeysfirst add-findings <run folder> <findings file>`. The review found nothing, or a person has seen what it found (`add-review`, in `journey-fix`). With nobody to ask, follow `journey-fix`: fix what your change caused, and report the rest.

A failed check is a good result when the product is wrong. Report it. Never change the check to make it pass.

## Publish, only when asked

Publish after the review, since a published run is sealed: `npx journeysfirst publish <run folder> --to https://<service>/v1`, with the person's key in `JOURNEYSFIRST_TOKEN`. Never print, commit or type the key. Give the person the link it prints.

## Report

Give the run's `result` and `summary`, then paste `verified` and `not_verified` as they are. Link the run folder, the review page or the published link.

For each blocked check, give its cause and what you need, one line each.

A passed run proves the checks, not that the walk was good. Under the verdicts, give the review's line and each finding. Keep failed, blocked and unchecked checks, and what the journey does not cover.

On a new build, the report is the one in `journey-build`. Write it by "Write only what someone reads".

```text
Weak:   All 3 checks passed, so sharing works well.
Strong: All 3 checks passed. Review: 1 finding. Nothing on the screen changes after "Copy link" (step 1).
```
