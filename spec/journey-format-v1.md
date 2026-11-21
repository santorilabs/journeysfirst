# Journey definition, v1

Journeys First is an open format and toolkit for checking that a product does what it promises, the way a user would use it. This doc defines a journey. What happens when a journey runs (verdicts, proof, screenshots) is defined separately, in the run results.

## The problem

An agent that tests an app tends to take a screenshot and say "passed." A screenshot can't show that data was saved, that another user sees it, or that a text went out. A journey says what must be true in plain words, so a person can review it and any agent can run it. Each run then has to show how it proved every check.

A passed run proves the checks. Whether the walk was good is a review's findings, in the run results.

## Who reads it

- People read `title`, `promise` and the checks. They don't write the file. They give a blurb or a voice note, and an agent writes it.
- Agents read everything else, set up the start state, and run it.

## Example

```yaml
format: journeysfirst/v1
title: Share a presentation by link
promise: You can share a presentation by link, and turn the link off again.
users: [viewer]
start: You have a presentation called "Q3 plan". Link sharing is off.
steps:
  - Turn on link sharing and send the link to the viewer.
  - check: Link sharing is still on after a reload.
    id: link-on
  - The viewer opens the link.
  - check: The viewer sees "Q3 plan".
    id: viewer-sees-it
  - Turn off link sharing.
  - The viewer opens the link again.
  - check: The viewer can no longer see "Q3 plan".
    id: viewer-blocked
```

## Fields

| Field | Required | What it is |
|---|---|---|
| `format` | yes | Always `journeysfirst/v1`. v1 only gets additions, so v1 files keep working. |
| `title` | yes | A one-line name. |
| `promise` | yes | What the person asked for, in their own words. Keep their whole blurb; don't shorten it. Usually one sentence. For a list or paragraph, start the value with `|` and put the text on the lines below. |
| `users` | only when someone besides you acts | Role words for the other users: `[viewer]`, `[editor, admin]`. "You" is the main user and is not listed. A user can be a person or an agent. Either one can use any way in: a browser, an API, an MCP server, a CLI or a pasted prompt. |
| `start` | yes, unless `cases` | What is true before the first step. |
| `setup` | no | The name of the app's setup script that creates the start state. |
| `steps` | yes, unless `cases` | One list, read top to bottom. |
| `cases` | no | Several ways the promise can happen, each with its own `start` and `steps`. See "Cases". |
| `notes` | no | Anything an agent should know that isn't a step. |

The file is `journeys/<name>.journey.yaml`.

There are no tags in the spec. Say the platform in the words ("On an Android phone, you have..."), and let agents choose journeys by reading them. A team that needs a fixed selection for CI can add its own `tags:`, since tools keep fields they don't know.

## Cases

A promise often has several ways to happen: different starting points, channels, edge cases. Put them all in one file as `cases`, one per way:

```yaml
format: journeysfirst/v1
title: Turn on two-step sign-in
promise: You can turn on two-step sign-in with your phone number, and it stays on.
cases:
  - name: Enter the number in the form
    id: number-in-card
    start: You're signed in. Two-step sign-in is off.
    steps:
      - In Security, choose "Turn on two-step sign-in".
      - Enter ${phone} in the form.
      - check: One text with a code is sent to ${phone}.
        id: code-sent
  - name: Tap "Not now"
    id: not-now
    start: You're signed in. Two-step sign-in is off.
    steps:
      - In Security, choose "Turn on two-step sign-in".
      - Tap "Not now".
      - check: No text is sent.
        id: nothing-sent
```

- Each case has a `name`, an `id`, its own `start` and `steps`, and optional `users` and `setup`.
- A journey with one way to happen skips `cases` and puts `start` and `steps` at the top, as in the first example.
- A case `id` is written once, like a check id, and never changes.
- Two cases can use the same check id only when the check says the same thing.

## Steps

Each item in `steps` is one of two things:

- **An action:** a plain sentence. "Turn on link sharing."
- **A check:** `check: <sentence>`, with an `id`. Something that must be true at that point. "Link sharing is still on after a reload."

Rules:

- **Who acts.** An action is done by whoever the sentence starts with. "The viewer opens the link" is the viewer. "Turn on link sharing and send the link to the viewer" names no one first, so it's you.
- **Whose view a check is about.** A check is about whoever it starts with: "The viewer sees..." is the viewer, "Your member list shows..." is you. It must be checked in that user's own login.
- **Users who exist at the start** are created before the run. **Users who join during the journey** (sign up, accept an invite) start with only a fresh email, `${teammate_email}`, and the journey's own steps create their account.
- **Describe what the user does and sees,** not clicks or page elements. "Invite the teammate as an editor," not "click the Invite button."
- **Quotes mean exact.** `"Q3 plan"` is entered or matched word for word. Unquoted words can vary.
- **Say counts.** "One invite email is sent to ${teammate_email}," not "an email is sent."
- **Checks describe what happened, not exact wording,** unless the wording is quoted. "The assistant offers to send a test text" holds however it's phrased.
- **Ids** are written once and never change, so history and links survive when a sentence is reworded.

## Agents add detail

The person's blurb is the minimum. Agents are encouraged to add detail on top of it:

- More steps and checks than the person named, such as the edge cases their words imply. Mark each added check with `added: true` so a reviewer can tell it apart from what they asked for.
- `notes` for anything a runner should know.
- Any extra field. Tools keep fields they don't know.

The `promise` stays in the person's words. Added detail never changes it.

### Think through every case

People name the happy path. Agents are expected to work out the other ways the promise can happen or break, and add a case for each one that matters:

- **Where you start:** signed out, a brand-new account, already set up, set up a different way.
- **Where it happens:** each channel and device the product supports (web, phone width, text, email, chat apps).
- **Wrong or missing input:** an invalid number, an empty field, a name that matches two people or nobody.
- **Saying no or changing your mind:** cancel, "not now", undo, "actually, do this instead".
- **Doing it again:** repeat the same action, do it twice quickly, come back after a reload.
- **Who is allowed:** someone without access, someone who doesn't own it, someone not on the product yet.
- **Limits:** out of invites, quota or credits; an expired or used link.
- **Things going wrong:** the connection drops, the save fails, a message fails to send. The product should say so and not claim it worked.
- **Two at once:** two tabs, two users changing the same thing.

Mark cases the agent added with `added: true`, the same as added checks. Leave out a case only with a reason in `notes`.

## Values that change each run

`${name}` is a value that is different every run.

- If setup makes it (a phone number, an email), setup fills it in. "Enter ${phone}."
- If the app makes it (a code, a link), the first line that mentions it captures it, and later lines mean the same value. "A text with a code ${code} arrives." then "Enter ${code}."

## Not in a journey

- URLs, clicks, page elements, login files and account emails. These go in the script an agent writes to run the journey.
- How each check was proven, verdicts, screenshots and video. These go in the run results.

## Open

- How the setup script is written, and how it creates fresh accounts on any app.
