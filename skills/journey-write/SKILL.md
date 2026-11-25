---
name: journey-write
description: Write or edit a user journey file (.journey.yaml). Use when you build something new or edit an existing journey.
---

# Write a journey
An existing product: read Foundation in `journeys/README.md` first (none yet: follow `journey-onboard`). Nothing built yet: the request is the blurb, and its words are the least each journey does.

The first thing you do is find out who this journey is for. Who is the user? (a person? an agent?) What did they come to do? What would they notice first if it broke?

A journey is a short file of plain sentences. People review it. They give you a blurb, and you write the file. The format is `journeysfirst/v1`. The journey format spec is `node_modules/journeysfirst/spec/journey-format-v1.md`. Old `journeysfirst/v0` files still validate, but write new ones in v1.

## 1. Find the users

Start from the Foundation, or from the request. A user can be a person or an agent. For each user in this promise, write down their role ("the owner", "a viewer with the link", "your agent"), person or agent, how they reach the product (a browser, an email, a text, your API, your MCP server, your CLI, a pasted prompt), and what they do or see.

For each way in, ask from the code: can a person come this way, and can an agent? An agent may get stuck where a person would not, like a code sent to an email it can't read. Each yes that matters is a user or a case.

Every user who acts, or whose view a check is about, is in the journey. Look for the user who only sees the result, like the person who gets the email, and for an agent the blurb does not name.

## 2. Write the file

```yaml
format: journeysfirst/v1
title: Send an invoice and get paid
promise: I want to send Harbor Cafe an invoice and see when they've paid it.
users: [client]
start: You run a studio with a client called "Harbor Cafe". It has no invoices yet.
steps:
  - Create an invoice for "Harbor Cafe" for "Logo design" at 1200 and send it.
  - check: One email with a link to this invoice is sent to ${client_email}.
    id: sent-once
  - The client opens the invoice from the email.
  - check: The client sees the invoice for 1200 without signing in.
    id: client-sees-it
  - The client pays by card.
  - check: Your invoice list shows the invoice as paid after a reload.
    id: marked-paid
```

- `title`: a one-line name.
- `promise`: the person's own words. Keep their whole blurb. On a new build, it is the part of the request this journey covers, word for word. For a list or paragraph, start the value with `|`.
- `users`: role words for the other users, only when someone besides you acts: `[viewer]`. "You" is never listed.
- `start`: what is true before the first step. Concrete: names, counts, settings.
- `setup`: the name of the app's setup script, if there is one.
- `steps`: one list, top to bottom. Each item is an action (a plain sentence) or a `check:` with an `id`.
- `cases`: several ways the promise can happen, each with `name`, `id`, `start` and `steps`. Use instead of top-level `start` and `steps`.
- `notes`: anything a runner should know that isn't a step.

A journey is one promise: one goal, or a goal and its undo. It ends at what the user wanted, seen by the person it matters to, not at a click or a toast.

Save it as `journeys/<name>.journey.yaml`. The file name is the journey's name.

## 3. Write each line

- **Who acts is whoever the sentence starts with.** "The viewer opens the link" is the viewer. "Turn on link sharing" names no one first, so it's you.
- **A check is about whoever it starts with.** "The viewer sees..." must be proven in the viewer's own login.
- **Describe what the user does and sees,** not clicks. "Invite the teammate as an editor," not "click Invite."
- **Do the real thing.** A step never does less than the promise says. "Attach the contract" means the user picks the file from their computer, not pastes its text into a box.
- **Quotes mean exact.** `"Q3 plan"` is typed or matched word for word.
- **Say counts.** "One invite email is sent to ${teammate_email}," not "an email is sent."
- **Every check has an id.** Lowercase words with dashes. An id never changes, even when the sentence is reworded. Never reuse a removed id.
- **`${name}` is a value that changes each run.** Setup fills ones it makes (a phone, an email). The first line that mentions an app-made value (a code, a link) captures it.
- **No URLs, clicks, page elements or account emails.** Those go in the script that runs the journey.
- **Use the product's words.** If the Foundation says "workspace", the journey says "workspace", not "team".
- **Plain words, one fact per sentence.** Keep every name, value, count and id.

| Weak | Strong | Why |
|---|---|---|
| `check: The toast says "Saved!"` | `check: The note keeps the new date after a reload.` | The toast can show while the save fails. |
| `check: The client can see it.` | `check: The client sees the invoice for 1200 without signing in.` | Says what they see, and whose view it is. |
| `check: The agent joined.` | `check: You see the agent in the project's member list after a reload.` | Proven from your side, not only from what the agent says. |
| `The agent calls POST /api/join.` | `The agent asks to join the project.` | What the agent does, not the call. Paths, tool names and keys go in the script. |

**A line that quotes what a user says or types** is written the way that user talks.

```
Before: Ask the assistant "Make a PNG file named weekly_signups.png: a line chart of weekly signups, weeks 1 to 4, values 10, 14, 18, 25".
After:  Ask the assistant "Can you make me a quick line chart of weekly signups? Weeks 1-4: 10, 14, 18, 25. PNG is fine."
```

## 4. Add detail

The blurb is the minimum. Add what it implies, and mark each added check and case `added: true`.

- A check for what the user would notice first if this broke, and for each "What good means" line that applies to this promise.
- The cases a careful PM would worry about for this promise, each as a case (see `node_modules/journeysfirst/spec/journey-v1.cases.example.yaml`): where you start (signed out, new account, already set up); each channel and device; wrong or missing input; saying no or changing your mind; doing it again; someone not allowed; limits like quota or an expired link; things going wrong, where the product must say so; 2 tabs or 2 users at once. Leave one out only with a reason in `notes`.

The `promise` stays in the person's words. Added detail never changes it.

## Exploring a product that exists

Use it the way a new user would, on a safe environment with a test account (see `journey-run`). Do each task end to end, reload, and open it as a second user if it is shared. Draft one journey per promise, not one per button. With no blurb, write the `promise` the way the user would say it: "You can share a presentation by link, and turn the link off again." Put what you could not tell in `notes` as questions.

## Before the feature exists

Write what the user should be able to do, not how the screen will look. The request is the least it does. Every check must be something you could prove once the feature exists. Running it today fails. It passes when the feature is done.

## Editing

- Rewording a sentence: keep the id.
- A weaker promise (dropping a check, "one" to "at least one"): say so and get a person to agree. With nobody to ask, keep the stronger one. Never do it to make a run pass. See `journey-fix`.

## 5. Check it

1. Run `npx journeysfirst validate journeys/<name>.journey.yaml` until it prints `ok`. Each problem names its line and step.
2. Read the file once as a teammate who must run it by hand. Fix any line that left you guessing. The review does not check this one.
3. Review the file with `journey-review`. You are done when it finds nothing, or the person has seen what it found.
