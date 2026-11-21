# Write an app skill

The journey says what must be true. The app skill says how to reach this app safely: where to run it, who to sign in as, how to set up data, how to send things in and how to read what it sent. It is knowledge, not code. The agent still chooses its own path.

Put it in the app's repo as a skill (for example `.claude/skills/<app>-journeys/SKILL.md`). Keep it under about 200 lines.

## How to write it

- Every fact comes from code you read or a command you ran. Mark anything else **Unverified**, with what you would run to verify it.
- Give the exact command, endpoint or query. "Seed a user" is useless. `POST /test/seed {"email": ...}` is useful.
- Name env vars, never their values. Never paste secrets, tokens or login links.
- Say what code enforces and what the agent must still never do. Both lists matter.
- Prove the block on sends before any journey that sends: make one test send to an address that can never deliver (an `@example.test` email address, a 555 number like `+1 202 555 0143`) and find it in the sink. Then a broken block still reaches no one. Write down what you sent and where it landed. If it is not in the sink, or it reached a real provider, stop and report it. For journeys that send nothing, prove outbound calls are refused instead: one probe call with the test config, and the error it got.
- When a run teaches you something (a fixed value was taken, a reply had to go to a different line), add it the same day.

## What to find out

Answer each one by reading the repo and running commands.

- **What the machine needs.** A container runtime if the stack runs in containers (`supabase start` does). The Node version from CI, `.nvmrc` or `engines`. Check each (`docker info`, `node -v`). If one is missing or wrong, report it. Do not install system software.
- **How the app starts locally.** The command, the port and the env file it reads. For a Vite app, the `package.json` scripts and `vite.config.*`. For Supabase, `supabase/config.toml`.
- **How a test user signs in without a real account.** A test sign-in route, a one-time link from the auth provider's admin API on a local or staging stack, or a saved `storageState`. Never script a real Google sign-in. If there is no test sign-in path, propose one and wait for the person's OK, because it changes the product. An app with no accounts: each fresh browser context is a fresh test user (`account: "fresh browser context"`).
- **Which values the server commands need.** Your shell may export a value from another product, like `SUPABASE_URL` or `DATABASE_URL`, and it wins over the app's env file. Pass every value explicitly (in `webServer.env`). Take local keys from the local stack (`supabase status`), never from an env file: env files can hold production keys.
- **How to check the local schema is current.** The command that lists applied migrations and the one that applies the missing ones on the local stack (for Supabase, `supabase migration list --local` and `supabase migration up --local`). A local database behind the repo's migrations makes routes fail.
- **How to reset or seed state.** A seed script, a SQL file, an admin API, a reset endpoint.
- **What the app sends outside, and where it lands in test.** Search the code and dependencies for mail, SMS, chat and payment providers, and server functions that call them (for Supabase, `supabase/functions/`). For each one: what stops a real send, and how you read what was sent.

Name the app skill `<app>-journeys`. Never give it the name of a Journeys First skill: `npx journeysfirst upgrade` rewrites those folders.

## Template

```markdown
---
name: <app>-journeys
description: Run user journeys against <app> safely. Use before any journey run, seed or test sign-in on <app>.
---

# <App> app skill

## 1. Safety
- Accounts: only <pattern, e.g. qa+<name>@example.test>. Check with <function or regex> before sign-in, seed, wipe or send.
- Environment: never production. Production looks like <host, env marker>. If you see it, stop.
- Enforced by code: <guards that refuse prod, refuse real accounts, sink outside sends>.

## 2. Environments
| Name | When | How to start | URLs |
- Needs on this machine: <container runtime, Node version from CI / .nvmrc / engines>. Check: <docker info, node -v>. If missing, report it; do not install system software.
- Env file: <name>. Keys a journey uses: <names only>.
- Check your shell: <vars that override the file if exported>. Pass each value to server commands explicitly. Local keys come from <the local stack, e.g. `supabase status`>, never from an env file that may hold production keys.

## 3. Test accounts and sign-in
- Browser: <one-time link, test login endpoint, saved storage state>. No accounts in the app: each fresh browser context is a fresh test user; record it as the account.
- API: <how to get a bearer token>.
- Each other user: <how to get their account and their own session>. For Playwright, the login hook: <a one-time sign-in link, a cookie, a saved storageState>.
- First sign-in shows: <welcome screens to skip>.

## 4. Seeding and reset
- Reset an account: <command>. What it deletes.
- Common starts: <named setups with commands>.
- Shared database: <values that collide; how to make fresh ones>.

## 5. Sending things in from outside
| Channel | Endpoint or script | How it is signed | Which line or address |

## 6. Reading what the app sent
- Capture: <fake provider, sink table, mail catcher>. Turn it on <before acting?>.
- Proven: <the one test send you made, and the sink row or message that shows it landed there>. If the app sends nothing in these journeys: <the probe call you made and the refusal it got>.
- Query: <table, filters, sink status>. Example count query.
- Ids that link two sources: <column joins>.

## 7. Where saved state lives
| Promise | Table or endpoint | Column |

## 8. Evidence
- Sources this app supports: page (url), api (url), database (query), log (query), message (message_id).
- Logs: <command>.
- Repos under test: <repo names; how to find the commit a preview runs>.
```

## Examples

Safety lines:

- Weak: "Be careful not to email real users."
- Strong: "Only accounts matching `qa+*@example.test`. `isTestAccount(email)` in `src/test/accounts.ts` checks it. The mailer sends to a sink table when `MAIL_MODE=sink`; staging sets it, production does not."

Sending in from outside:

- Weak: "Simulate an incoming email."
- Strong: "Inbound email: `POST {api}/webhooks/inbound-mail` with the mail provider's JSON shape (see `test/fixtures/inbound.json`), signed `x-signature: hmac-sha256(MAIL_WEBHOOK_SECRET, body)`. Send it to the address the app wrote from (`reply+<thread id>@...`), not the account's main address."

Reading sends:

- Weak: "Check the emails table."
- Strong: "`select id, to_address, kind, created_at from outbound_emails where to_address = $1 and created_at >= $2` (ms). Sink rows have `status = 'sink'`. `outbound_emails.id` equals the capture's `message_id`."

Shared data:

- Weak: (nothing said, so the agent uses the spec's phone number)
- Strong: "Staging is shared. Phone numbers are unique per account, and `+1 555 0100` to `0199` are often taken. Get a fresh one with `npm run test:fresh-phone -- <email>`, and record it in the run's `values`."

## What a first run usually teaches

Add these to the skill when you hit them:

- An env var your shell exported pointed somewhere else.
- A fixed value in the journey was already used by another account.
- The app replied from a different line, address or provider than you expected, so the inbound reply had to go there.
- A webhook signature was checked against a different URL than the one you posted to (scheme or host rewritten by a proxy).
- Capture had to be on before the step, or the send was lost.
- A count needed a start-time filter because other runs share the table.
