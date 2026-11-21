# Publish a run

You can send a run to a service. Publishing sends `run.json`, every screenshot and every video in the run folder. Anyone who can open the run on the service sees them.

To try it, run the local dev server, which keeps runs in memory. From `examples/share-by-link`:

```bash
npx journeysfirst dev-server --port 4500
npx journeysfirst publish journey-runs/share-by-link/<run id> --to http://127.0.0.1:4500
```

To publish to a hosted service, `publish` reads the token from `JOURNEYSFIRST_TOKEN`. Export it in your environment, or load it from a git-ignored env file. Never type the token into the command itself, where it stays in shell history:

```bash
JOURNEYSFIRST_TOKEN="$(grep '^JOURNEYSFIRST_TOKEN=' .env | cut -d= -f2-)" npx journeysfirst publish <run folder> --to https://<service>/v1
```

- `--to` defaults to `JOURNEYSFIRST_URL`. Publish refuses a plain `http://` address unless it is this machine (`localhost`, `127.0.0.1`), because the token would travel in the clear.
- The dev server asks for a token only when `JOURNEYSFIRST_TOKEN` is set when it starts.
- Publish sends the journey (`--journey <file>`, or `journeys/<name>.journey.yaml` when it exists), so the service can check that the run's steps match it. A run sent without its journey is kept as unverified.
- Publishing is idempotent. The same run id with the same content returns the existing run. Different content is a conflict once the run is sealed. Before that, it replaces the open run, so a run with a fixed file publishes at once.
- The digest is sha256 over `run.json` as it is in the folder, plus each file's sha256. The service checks the digest, then settles the run with its own rules. It keeps both the run as sent and its verdict (see [Run results v1](../spec/run-results-v1.md#publishing)).
- An interrupted publish resumes. It uploads only the files the service is missing.

API: `PUT /runs/<id>` with `{digest, run, files, journey}` (journey optional). `files` maps each file to its sha256, and `sizes` maps it to its length; the service refuses a file type it does not take, or a run of more than 64 files, before it creates anything. The reply is `{run_id, state, missing, url, unverified}`. `url` is the run's link for a person. It lists each missing file as `{name, upload: {method, url, headers}}`, and publish sends the file's bytes there as given. The token goes only to the service's own host, never to a storage url. A reply that lists bare names gets `PUT /runs/<id>/files/<name>` (kept for older services). Then `POST /runs/<id>/finalize` with `{digest}`. When the upload url is the service's storage, finalize reads each file back and checks its sha256, size and type before it seals. A file that did not arrive is listed with a fresh target, and publish sends it once more. `GET /runs/<run_id or id>` answers with `runAnswer` (`journeysfirst/run-answer`): the result first, then what failed and what wasn't checked, then the link.

`npm run verify:publish` checks the protocol's edge cases against a service (`-- --to <url>`, with `JOURNEYSFIRST_TOKEN`; a local one by default) and prints one table. Point it only at a project kept for checks: runs that seal stay there.

Every error is `{"error": {"code", "message", "hint", "problems"}}`, and `problems` lists every problem at once. A 503 means the service is busy. Publish waits for its `Retry-After` (at most 30 seconds, or 5 when it is not a number of seconds) and tries again, up to three times. The protocol is one function, `publishHandler(store)` in `journeysfirst/publish-handler`. The dev server runs it on a memory store. A hosted service runs the same function on its own database and storage, so both answer the same codes and bodies.

`journeysfirst/display` has the helpers a page needs to show a run (`isCheck`, `screenshotFile`, `stepState`, `runTitle`, `clock`, `videoAt`, the verdict labels). It has no Node imports, so a browser can load it.
