# Journeys

**What it is:** A demo app with one presentation, "Q3 plan". Its owner can share it by link and turn the link off again. (`app/server.mjs`)
**Stage:** An example for Journeys First, not a product. (the example's authors)

## Foundation

What good means for this app. Every journey skill reads this first.

### Product principles

| User | Person or agent | Comes in by | Came to | Would notice first |
|---|---|---|---|---|
| The owner | person | browser, signed in | share "Q3 plan" and stop sharing it | a link that still opens after they turned it off |
| The viewer | person | a link, signed out | read "Q3 plan" | a link that does not open it |

**What good means.** Each line can fail. A journey checks it, or a review cites it.

- The viewer sees "Q3 plan" from the link. (the example's authors)
- After the owner turns link sharing off, the link no longer opens "Q3 plan". (the example's authors)

### UX principles

- Corners are 10 px on buttons and 16 px on cards and dialogs. (the example's authors)

### Brand

| What | Where |
|---|---|
| Name | not stated yet |
| Logo | not stated yet |
| Colors, type | the style block of each page in `app/` |

### Design system

| What | Where |
|---|---|
| Spacing | the style block of `app/owner.html` and `app/viewer.html` |
| Components | not stated yet |
| Loading | "Loading…" in `app/viewer.html`, "Opening…" on the Share button in `app/owner.html` |

## Journeys

- You can share a presentation by link, and turn the link off again. **proven** (`share-by-link.journey.yaml`, script in `tests/`)

## Running safely

- `npm test` starts the app on a free port. Its state is in memory and a restart resets it.
- The owner signs in with a one-time link, `/signin/owner`. The viewer is signed out.
- The app sends nothing.
