# Journeys

**What it is:** Docmost, a team wiki. People write pages in spaces, find them with search, and can share a page to the web with a public link. (https://github.com/docmost/docmost README)
**Stage:** An open-source product. This example runs one journey against a local copy, on the commit that broke the promise (docmost#325) and on the commit that fixed it (docmost#1439 and docmost#1445).

## Foundation

### Product principles

| User | Person or agent | Comes in by | Came to | Would notice first |
|---|---|---|---|---|
| You, the space admin | person | browser, signed in | write pages, share them, delete them | a deleted page that someone else can still read |
| The viewer | person | a public link, signed out | read a page shared to the web | a link that still opens a page the owner deleted |
| The teammate | person | browser, signed in, "Can view" in the space | find and read the space's pages | a deleted page still showing in search |

**What good means.**

- A deleted page goes to Trash and can be restored for 30 days. (docmost#325: "Pages in trash will be permanently deleted after 30 days.")
- Before Trash existed, deleting a page ended its public link. Moving a page to Trash must hide it the same way from everyone who is not managing the Trash. (docmost#1439, "fix trash in search", which also makes shared links 404 for trashed pages)
- People with "Can view" do not browse the space's Trash. (docmost#1445, "hide trash from can view permission")

### Design system

Not linked yet: link the files that hold Docmost's spacing, type and radius here.

## Journeys

- When I delete a page, people with the public link and other members can no longer read it or find it. (`trashed-page-stays-hidden.journey.yaml`, script in `tests/`)

## Running safely

- `./stack.sh up break|fix` runs Docmost on this machine, on port 3300, from an image built from that commit. Each run starts from an empty database. `./stack.sh down` removes it.
- All accounts are fresh `@example.test` addresses made by the run.
- Mail goes to a local mailpit sink (port 8325). Telemetry is off (`DISABLE_TELEMETRY=true`).
