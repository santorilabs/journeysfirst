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
```

`run.json` points to the other files by name. Publishing sends the whole folder except a trace, and anyone who can open the run sees every screenshot and the whole video. Keep anything secret off the screen while the run records: use test accounts and test values.

## Rules a reader applies

- **A pass needs proof.** A check that says `passed` needs evidence, and some of it from the login of the user in `by`. Without that, readers count it as `not_checked` and keep the claim as `claimed: "passed"`. Evidence read with an admin or service `key` never counts as the user's own.
- **Findings and reviews never change a verdict or the result.** A review page shows both. When they disagree, the review wins.
- **A batch passes only when every run in it passed.** "4 of 5" is a failed batch.
- **`null` means not captured. An empty list means captured, and nothing was found.**

## Secrets

- A secret value is written as `{secret: true}`, with no value.
- The recorder keeps a secret's value in memory. It refuses to write the run if the value shows up anywhere else in the file. It can't check screenshots, video or a trace.
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
