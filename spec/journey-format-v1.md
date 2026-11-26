# Journey format v1

A journey is a YAML file of plain sentences: what a product promises a user, and what must be true at each point. People review it. Any agent can run it. It lives at `journeys/<name>.journey.yaml`.

- **Schema:** [journey-v1.schema.json](journey-v1.schema.json). Every field, its rules and what it is for.
- **Examples:** [journey-v1.example.yaml](journey-v1.example.yaml) (steps) and [journey-v1.cases.example.yaml](journey-v1.cases.example.yaml) (cases).
- **Check a file:** `npx journeysfirst validate journeys/<name>.journey.yaml`. It also checks what the schema cannot: ids are unique, and 2 cases share a check id only for the same check.

To get checks and hover help in your editor, put this line at the top of a journey:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/santorilabs/journeysfirst/main/spec/journey-v1.schema.json
```

What happened when a journey ran is a different file: [run results](run-results-v1.md).

## Writing steps

- **Who acts:** whoever the sentence starts with. "The viewer opens the link" is the viewer. A sentence that names no one first is you.
- **Whose view a check is about:** whoever it starts with. It is checked in that user's own login.
- **An agent CLI plays one seat.** If you run the whole journey through `journeysfirst run`, omit `users` to play `you`, or write `users: [agent]` to play `agent`. The format still includes the implicit `you` role, but the launcher does not play it in an `agent` run.
- **Launcher checks** test the runner, not the product. Set `launcher_probe: login-reuse` or `launcher_probe: protected-files` on a check to require that specific launcher probe instead of evidence from a product login.
- **What the user does and sees,** not clicks or page elements. "Invite the teammate as an editor," not "click the Invite button."
- **Quotes mean exact.** `"Q3 plan"` is matched word for word. Unquoted words can vary.
- **Say counts.** "1 invite email is sent to ${teammate_email}," not "an email is sent."
- **`${name}` is a value that changes each run.** Setup fills in the ones it makes, like `${phone}`. A value the app makes, like `${code}`, is captured on the first line that mentions it.
- **Users who exist at the start** are created before the run. **Users who join during the journey** start with only a fresh email, like `${teammate_email}`, and the journey's steps create their account.
- **The `promise` stays in the person's words.** Agents add checks and cases on top, each marked `added: true`.
- **Ids never change,** so history survives when a sentence is reworded.

## Not in a journey

- URLs, clicks, page elements and logins. These go in the script an agent writes to run it.
- Verdicts, proof, screenshots and video. These go in the run results.
