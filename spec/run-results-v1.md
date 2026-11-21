# Run results, v1

## The problem

A journey says what must be true. A run result says what happened when one agent ran it once: what each user did, what was seen, and how each check was proven. We don't control the agents that run journeys, so this file is the contract they all write and the one thing a review page, a service and other agents read. The fields and rules matter; the file syntax doesn't.

## A run is one folder

```
journey-runs/share-by-link/2026-11-08-1802-7d2e91fa/
  run.json
  step-1.png
  step-7.png
  you.webm
  viewer.webm
  trace.zip      (only when the run did not pass)
```

- `run.json` plus the screenshots and video it points to, by relative path.
- The folder uploads as is. Uploading the same run twice is safe: same id and same content returns the existing run; same id and different content is refused once that run is sealed. A run whose publish never finished is replaced, so a folder with a fixed file can be published again at once.
- Publishing a run publishes everything in the folder except a Playwright trace (see "What a person sees"): `run.json`, every screenshot, and the whole video of each user's session, from start to end. Anyone who can open the run sees them. Nothing secret may be on screen at any point while the run records: no real passwords, keys, tokens or real people's data. Use test accounts and test values.

## Example

```json
{
  "format": "journeysfirst-run/v1",
  "id": "2026-11-08-1802-7d2e91fa",
  "journey": { "name": "share-by-link", "version": "249ba24c", "case": null },
  "result": "failed",
  "summary": "The viewer could still open the link after sharing was turned off.",
  "started_at": "2026-11-08T18:02:11Z",
  "finished_at": "2026-11-08T18:03:05Z",
  "ran_by": { "agent": "claude-code", "model": "opus" },
  "journeysfirst": "0.0.1",
  "tags": { "environment": "staging", "device": "Chrome 131, desktop" },
  "repos": [
      { "repo": "acme/web", "commit": "abc123", "branch": "share-fix" },
      { "repo": "acme/api", "commit": "def456", "branch": "main" }
  ],
  "users": {
    "you": "owner-7d2e@example.test",
    "viewer": "viewer-91fa@example.test"
  },
  "values": {
    "link": { "value": "https://app.example.test/view/q3-plan" },
    "phone": { "secret": true }
  },
  "media": [
    { "file": "you.webm", "kind": "video", "starts_at": 0, "tags": { "user": "you" } },
    { "file": "viewer.webm", "kind": "video", "starts_at": 12.4, "tags": { "user": "viewer" } }
  ],
  "verified": [
    "Link sharing is still on after a reload.",
    "The viewer sees \"Q3 plan\"."
  ],
  "not_verified": [
    "The viewer can no longer see \"Q3 plan\": the viewer still saw it."
  ],
  "steps": [
    {
      "says": "Turn on link sharing and send the link to the viewer.",
      "by": "you",
      "status": "done",
      "at": 3.2,
      "took": 4.1,
      "screenshots": [{ "file": "step-1.png", "url": "https://preview-12.example.test/p/q3-plan" }]
    },
    {
      "check": "The viewer can no longer see \"Q3 plan\".",
      "id": "viewer-blocked",
      "by": "viewer",
      "verdict": "failed",
      "at": 41.0,
      "took": 2.3,
      "proof": "Opened the link in the viewer's own login.",
      "evidence": [
        { "source": "page", "login": "viewer", "url": "https://preview-12.example.test/p/q3-plan", "saw": "the presentation, not an error" }
      ],
      "screenshots": [{ "file": "step-7.png", "url": "https://preview-12.example.test/p/q3-plan" }],
      "cause": "product",
      "reason": "The link still works after sharing was turned off."
    }
  ],
  "findings": [
    {
      "id": "intuitive-feedback-1",
      "criterion": "intuitive-feedback",
      "step": 1,
      "says": "Nothing on the screen changes after \"Copy link\".",
      "evidence": [
        { "source": "page", "login": "you", "url": "https://preview-12.example.test/p/q3-plan", "saw": "the dialog is the same before and after the click" }
      ]
    },
    {
      "id": "foundation-values-3",
      "criterion": "foundation-values",
      "step": 3,
      "says": "\"Download\" has a 4 px corner. The measured line has 10 and 16 px.",
      "ask": "Is a 4 px corner right for this button?",
      "evidence": [
        { "source": "page", "login": "viewer", "url": "https://preview-12.example.test/view/q3-plan", "file": "measure-3.txt", "measured": { "radius": "4 px", "on": "button \"Download\"" } }
      ]
    }
  ],
  "reviews": [
    { "by": "reviewer@example.test", "at": "2026-11-08T18:20:00Z", "on": "viewer-blocked", "says": "Confirmed bug." },
    { "by": "ana@example.test", "at": "2026-11-08T18:25:00Z", "on": "foundation-values-3", "says": "Yes, 4 px is right for a small button." }
  ]
}
```

The example shows two of the run's seven steps.

## Required

Only these. Everything else is optional, and tools keep any field they don't know.

| Field | What it is |
|---|---|
| `format` | Always `journeysfirst-run/v1`. |
| `id` | The run's id. Never changes. The recorder writes the start time in UTC, then 8 random hex: `2026-11-08-1802-7d2e91fa` started at 18:02 UTC, whatever the machine's time zone. |
| `journey` | The journey's `name`, the `version` of it that ran, and which `case` ran (its id, or `null` when the journey has no cases). One run is one case. |
| `result` | The overall result. See "Results". |
| `started_at` | When the run started. |
| `steps` | Every step of the journey, in order, each with its result. |

## Steps

Each item matches one line of the journey, in the same order.

An action has:

- `says`: the line from the journey.
- `by`: who did it: `you` or a name from the journey's `users`. The runner says this; tools only check it is someone in `users`. Leave it out on a step nobody did (`not_run`, or `blocked` before anyone acted).
- `status`: `done`, `failed`, `blocked` or `not_run`.

A check has:

- `check` and `id`: the line and its id from the journey.
- `by`: whose view it is about. It must be checked in that user's own login. Leave it out when nobody checked it (`not_checked` or `blocked`).
- `verdict`: see "Verdicts".
- `proof`: how it was proven, in one plain sentence.
- `evidence`: what was collected, for engineers. Each item says its `source` (`page`, `api`, `database`, `log`, `message`), which login it came from, and enough to look it up again (the url, the query, the message id). A read made with an admin or service key, not a user's own session, has `key` instead of `login`: the key's name, like `SUPABASE_SERVICE_ROLE_KEY`, never its value. It can support a check, but it never counts as evidence from the user in `by`. Write each `url` in full, like `https://preview-12.example.test/api/share`, so a reader can tell which build it came from. A relative url is still valid, but a service can't use it to confirm the build.

Both can have:

- `at` and `took`: when it started and how long it took, in seconds from the start of the run.
- `screenshots`: the screenshots taken at that step. Each item is a file name in the run folder, or `{file, url}`, where `url` is the full address of the page the screenshot shows. With the url, a service can check the run was on the build it names. The Playwright plugin always writes the url. A plain file name is still valid, so older runs keep working.
- The Playwright plugin writes a page's address without its query string or fragment (`https://app.example.test/auth/callback`, not `...?code=...#access_token=...`). Those parts can hold a one-time sign-in link, an OAuth code or an access token. This applies to screenshot urls and to evidence urls the plugin fills in from a page. A url the runner writes in full is kept exactly as written, so leave secrets out of it.
- `cause` and `reason`, on anything that failed or was blocked.
- `added: true`, copied from the journey, when the agent added the check.

## What a person sees

- Every step done in a browser has a video or screenshots. Clicking a step opens what was seen at that moment: that step's `screenshots`, or the video tagged with the user in `by`, at `at`. A user with no browser, a person or an agent (an agent fetching a URL, a person using a CLI), has neither. Their capture is a text file in `media`, named by the check's evidence.
- `media` lists the run's files (videos, recordings, attachments), each with a `kind` and its own `tags`. A run with two users usually has two videos, one per login, each tagged `user` with the user's name. `at` is seconds from the start of the run; a video that starts later says so with `starts_at`.
- A `media` item with `kind: "trace"` is a Playwright trace: a zip of every action, network call, console message and page snapshot. Open it with `npx playwright show-trace <file>`. The Playwright plugin keeps one only in a run that did not pass, with Playwright's `trace: "retain-on-failure"`; one trace covers every user's browser. A run written another way can attach its own with `attach({name: "trace.zip", path, kind: "trace"})`. A trace holds anything the page or the network saw, including tokens, cookies and personal data, and the recorder can't check it for secrets. It is for debugging on the machine that ran the journey: `publish` leaves every `trace` item out of the run it sends.
- A step starts `at - starts_at` seconds into a video, and ends `took` seconds later. The Playwright plugin measures `starts_at` when the user's page opens, and its videos show each line as a caption. Captions are in the video only, not in `run.json`.
- `summary`, `verified`, `not_verified`, `proof` and `reason` are plain sentences. An agent can paste them into a chat or a PR as they are.

## Verdicts

| Verdict | Meaning |
|---|---|
| `passed` | It was true, and the evidence is attached. |
| `failed` | It was not true. The product did the wrong thing. |
| `blocked` | It couldn't be checked because setup or the environment broke (an account couldn't be created, the app didn't start). |
| `not_checked` | No evidence was attached. A check that claims `passed` without evidence is changed to `not_checked`, and the claim is kept as `claimed: "passed"`. |

`cause` on a failed or blocked item is one of `product`, `test` (the journey or the script is wrong) or `environment`, with a `reason`.

## Results

`result` for the whole run:

- `passed` when every check passed.
- `failed` when any check failed.
- `not_fully_checked` otherwise: nothing failed, but at least one check is `blocked` or `not_checked`.

## Tags, repos and version

- `tags` is an optional free map for facts about this run that a team wants to filter on: `environment`, `device`, `browser`, `region`. Any key, any value. Files in `media` can carry their own `tags` too.
- Suggested names, so teams match: `environment`, `device`, `browser`, `os`. Use these when they fit; any other key is fine.
- Run tags describe this run only. If the journey has its own tags or other fields, don't copy them into the run. `journey.name` and `journey.version` point to them.
- `repos` lists the code that was tested, one `{repo, commit, branch}` per repo. A product often runs on several repos at once (a web client and a server).
- `journeysfirst` is the version of Journeys First that wrote the run, like `"0.0.1"`. The recorder fills it in. Use it to tell whether a difference between two runs came from an upgrade.

## Users and values

- `users` maps each user to the account used in this run.
- `repeat` marks one of several runs of the same journey, run back to back: `{batch, n, of}`, like `{batch: "a1b2c3d4", n: 2, of: 5}`. The reporter writes it under `--repeat-each`. A batch passes only when every one of its runs passed, so "4 of 5" is a failed batch. One run of something an agent does proves little; run it several times.
- `played_by` says who played a user, as the runner launched it: `"a script"`, or the agent, its version and model, like `"Claude Code 2.4.1, opus"`. Optional, and only for users the runner says. It matters most for an agent user: a script passing proves the product's interface works; a real agent passing proves an agent can actually do it. It is never detected from the product's side, which can't tell one agent from another.
- `values` holds each `${name}` from the journey and the value it had, as `{value}`. A secret is written as `{secret: true}` with no `value`, so it never reaches the run folder, a zip or a service. A run file with a secret that carries a `value` is invalid.
- The recorder keeps each secret's value in memory only. When it finishes, it refuses to write the run if the value appears anywhere else in the run (in evidence, a url, a proof or a reason). The error names each field and the value's name, never the value. It can't check screenshots, video or a trace: keep secrets off the screen, and keep a trace on your machine.
- `null` means a thing wasn't captured. An empty list means it was captured and nothing was found. For "no text was sent," the difference matters.

## Reviews

People's calls go in `reviews`, with who, when, which check or finding and what they said. `on` names a check or a finding by its id. A review never changes a check's `verdict`. The UI shows both, and a review wins when they disagree.

## Findings

A passed run proves the checks. It does not say whether the walk was good. A review against fixed criteria says that, and what it found goes in `findings`, a list beside the verdicts. A finding never changes a verdict or the result.

| Field | Required | What it is |
|---|---|---|
| `id` | yes | A plain id, unique in the run and never a check's id. By habit the criterion and the step, like `intuitive-feedback-1`. A review's `on` points at it. |
| `criterion` | yes | The id of the criterion it is about, like `intuitive-feedback`. A page groups findings by its first word. |
| `says` | yes | What was found, in one plain sentence a person can paste into a PR. |
| `evidence` | yes, at least one | The same items a check's evidence has: `source`, `login` or `key`, and the field that lets someone look it up again. Extra fields like `saw`, `measured` and `file` (a measure file in the run folder) are kept. A finding about a file, like the journey file, uses `source: "log"` with the command that shows it in `query`, and the `login` of whoever ran it. |
| `step` | no | The number of the step it is about, from 1. Leave it out when it is about the whole journey. |
| `ask` | no | The one question for a person. With it, the item is a question, not a finding. |

- No `findings` field means the run was not reviewed. An empty list means it was reviewed and nothing was found.
- The format checks the shape of a finding. It does not hold the list of criteria: the `journey-review` skill does.
- A person's call on a finding is a `reviews` item with `on` set to the finding's id, as it is for a check. `npx journeysfirst add-review <run folder> --on <id> --by <person> --says "<their words>"` writes one and fills in `at`. A finding with such a review can't be dropped from the run.
- A run file whose review is `on` a finding id is not valid for a `journeysfirst` older than the one that added findings: it knows only check ids. A run with findings and no review on them is valid everywhere.
- `npx journeysfirst add-findings <run folder> <file>` writes them. The file is `{"findings": [...]}`. The command changes nothing else in `run.json`, and refuses a file that holds any other field. Add findings before publishing: a published run is sealed, and its digest covers `findings`.
- The Playwright plugin saves `measure-<step>.txt` after each step, listed in `media` with `kind: "capture"`: what it read from that user's screen (the spacing, type sizes, fonts and corner radii in use, each control's box, at the run's width and at 375 px) and each click with the ms until the page first changed. The page address in it has no query or fragment, and a secret value is written as its `${name}`. `npx journeysfirst measured <run folder>` prints what these files show, compared with the earlier reviewed run. They are published with the run.
- `validate-run` prints one line about the review: `Review: 1 finding, 1 question, 1 seen by a person.`, `Review: nothing found.` or `Not reviewed.` It never changes whether the run is ok.

## Which project

The file doesn't name a project. A run belongs to whichever project it's published to: the service decides that from the publish token. This keeps a run folder portable between a repo, a local folder and any service.

## Publishing

Publish sends `run.json` exactly as it is in the folder. Its digest is sha256 over that canonical `run.json` plus each file's sha256. The rules that settle a run (a claimed pass with no evidence becomes `not_checked`) never touch what is digested, so a client and a service on different versions of journeysfirst still agree on it.

The client refuses an invalid run before it sends it. The service checks the digest, then validates and settles the run with its own rules. It keeps the run as sent, and the settled run as its verdict. A stored run is always read from that verdict, so a later rule change never alters how it reads.

## Search

The fields people filter on sit at the top level: `journey.name`, `result`, `started_at`, any tag, the commits and branches in `repos`, and `ran_by.agent`. Check ids never change, so "every run where `viewer-blocked` failed" works across runs and journey edits.

## Not in v1

- Retries and a flaky flag. Each attempt is its own run for now.
- Logs and network traces beyond what a check uses as evidence.
- Findings that change the result. Today a run with findings has the same `result` as the same run without them.
