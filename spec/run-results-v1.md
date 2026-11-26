# Run results v1

A run result says what happened when 1 agent ran a journey once: what each user did, what was seen, and how each check was proven. Every agent that runs a journey writes this file. A review page, a service and other agents read it.

- **Schema:** [run-results-v1.schema.json](run-results-v1.schema.json). Every field, its rules and what it is for.
- **Example:** [run-results-v1.example.json](run-results-v1.example.json), a full run of the [example journey](journey-v1.example.yaml).
- **Check a run:** `npx journeysfirst validate-run <run folder>`. It also checks what the schema cannot: the steps match the journey line by line, `result` and `verified` match the steps, every `by` and `login` is in `users`, and ids are unique.

## A run is 1 folder

```
journey-runs/share-by-link/2026-11-08-1802-7d2e91fa/
  run.json
  step-1.png
  you.webm
  viewer.webm
  trace.zip      (only when the run did not pass)
  failure.md     (only when the run did not pass: what the app reported to each user at the first failed line)
  failure.json   (the same report, for the review page)
```

`run.json` points to the other files by name. Publishing sends the whole folder except a trace, and anyone who can open the run sees every screenshot and the whole video. Keep anything secret off the screen while the run records: use test accounts and test values.

## Rules a reader applies

- **A pass needs proof.** A check that says `passed` needs evidence, and some of it from the login of the user in `by`. Without that, readers count it as `not_checked` and keep the claim as `claimed: "passed"`. Evidence read with an admin or service `key` never counts as the user's own.
- **A launcher check** copies `launcher` from the journey and requires a matching probe. Its evidence uses `source: "launcher"`, a `probe` of `login-reuse` or `protected-files`, and a `query` pointing to the captured line. It has no `login` or `key`. Other checks cannot cite launcher evidence.
- **An aborted attempt cannot pass.** Set `attempt: {status: "aborted", reason: "The runner timed out."}` when execution ends early or uncleanly. Keep each step, verdict, and its evidence as recorded. A failed check or an action that failed because of the product still gives `failed`. Otherwise an aborted attempt gives `not_fully_checked`. Readers apply the usual result rules when `attempt` is omitted or its status is `complete`.
- **The newest attempt counts.** If the newest run for a journey and case was aborted, `merge-check` stops the merge. It does not fall back to an older pass or make an exception for checks that were also blocked on main.
- **Findings and reviews never change a verdict or the result.** A review page shows both. When they disagree, the review wins.
- **A batch passes only when every run in it passed.** "4 of 5" is a failed batch.
- **`null` means not captured. An empty list means captured, and nothing was found.**

## Secrets

- A secret value is written as `{secret: true}`, with no value.
- The recorder keeps a secret's value in memory. It refuses to write the run if that value shows up anywhere else in the file. It is not rewritten in place.
- A screenshot covers a password field, a field whose name looks like a secret, and text that contains a secret value. The page is restored after the shot only when something was covered. The field is marked `data-jf-mask="1"`. The real value stays in memory for that shot and is not written into the page. Video is not changed. A password field the browser draws as dots stays dots.
- A trace is rewritten after the run. A value seen on a password or secret field, a declared secret, and obvious patterns such as a bearer token or `password=...` are replaced everywhere in the text of the zip, including action names and the copied script. The original trace file is rewritten too, so the raw zip does not remain. Image entries are left as they are.
- Obvious patterns in the run file are replaced the same way. A value shorter than 4 characters is not searched for.
- The Playwright plugin writes page addresses without the query string or fragment, since those can hold a sign-in code or token. An address you write yourself is kept as written.
- A trace holds everything the page and network saw. It stays on the machine that ran the journey. Open it with `npx playwright show-trace <file>`.

## Findings and reviews

- `npx journeysfirst add-findings <run folder> <file>` adds findings. The file is `{"findings": [...]}`. Add them before publishing.
- `npx journeysfirst add-review <run folder> --on <id> --by <person> --says "<their words>"` adds a person's call on a check or a finding.
- The list of review criteria is in the `journey-review` skill, not the format.

## Publishing

- The digest is sha256 over `run.json` as it is in the folder, plus each file's sha256. A published run is sealed.
- Publishing the same run twice is safe. Same id and same content returns the existing run. Same id and different content is refused once the run is sealed.
- The run names no project. The service picks the project from the publish token.
- The service checks the digest, then applies the rules above with its own version. It keeps the run as sent, and reads it from its own result from then on.

## Not in v1

- Retries and a flaky flag. Each attempt is its own run.
- Findings that change the result.
