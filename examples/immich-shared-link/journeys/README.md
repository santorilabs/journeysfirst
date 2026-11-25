# Journeys

**What it is:** Immich, a self-hosted photo library. An owner keeps albums and can share an album by link with people who have no account. (immich-app/immich)
**Stage:** An open-source product. This example runs one journey against a local copy, on the commit that broke the promise and on the commit that fixed it.

## Foundation

### Product principles

| User | Person or agent | Comes in by | Came to | Would notice first |
|---|---|---|---|---|
| The owner | person | browser, signed in | share an album by link and choose what the link shows | a link that shows details they turned off |
| The viewer | person, or an app they give the link to (a photo frame) | the shared link, signed out, in a browser or through the API | see the album's photos | a link that does not open the album |

**What good means.**

- A shared link with "Show metadata" turned off never shows where a photo was taken, the camera or the file name, in the web page or through the API. (Immich's "Show metadata" setting on a shared link)

### Design system

Not linked yet: link the files that hold Immich's spacing, type and radius here.

## Journeys

- When I share an album by link with "Show metadata" turned off, people with the link see my photos but not where they were taken, the camera, or the file names. (`share-album-hide-details.journey.yaml`, script in `tests/`)

## Running safely

- `./stack.sh up <commit sha>` starts Immich on http://127.0.0.1:2285 from Immich's CI image for that commit, with an empty database and photo library. `./stack.sh down` removes it.
- Machine learning is off and no mail server is set, so the app sends nothing out.
- Accounts are made by the test: one admin (`admin@example.test`) and a fresh owner per run (`owner-<run>@example.test`). All on `example.test`.
- Run: `npm run test:break` or `npm run test:fix`. Each starts the stack for its commit, then runs the script.
