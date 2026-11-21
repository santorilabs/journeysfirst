# Upgrades that merge themselves

A product repo stays on the Journeys First version it installed until someone upgrades it by hand. This page sets up a repo so each new version on npm arrives as a pull request that merges itself when the repo's journeys pass. When they do not pass, the pull request waits for a person.

## What it does

`npx journeysfirst init` and `npx journeysfirst upgrade` write `.github/workflows/journeysfirst-upgrade.yml`. It runs every day, and when you run it by hand (`gh workflow run journeysfirst-upgrade.yml`). Each run:

1. Reads the journeysfirst version in `package.json` and the newest one on npm (`npm view journeysfirst version`). If they are the same, it stops.
2. Without the `JOURNEYSFIRST_TOKEN` secret, it stops there too. The run passes, with a warning that a new version is out and the commands to upgrade by hand. So a repo that never sets up the token gets no failed runs.
3. Installs the new version with the package manager the repo's lockfile belongs to (pnpm, yarn, bun, else npm), and runs `journeysfirst upgrade` with it. In a pnpm repo with no `packageManager` in `package.json`, it uses the pnpm that wrote the lockfile, so the lockfile format does not change.
4. Force-pushes one branch, `journeysfirst/upgrade`, and opens one pull request from it, or updates the one that is open.
5. Turns on auto-merge, but only when the check that runs the journeys is required on the default branch. That check is the job named `journeys`, or the name in the `JOURNEYS_CHECK` repo variable. Auto-merge waits only for required checks, so without it the pull request would merge without the journeys. Then the pull request waits for a person.

If the branch already has the newest version, a daily run does nothing. So closing the pull request without deleting the branch skips that version. A run by hand makes it again.

To stop upgrades in a repo: `gh workflow disable journeysfirst-upgrade.yml`.

## The rule for merging

The repo's normal CI runs the journeys on every pull request and then runs:

```bash
npx journeysfirst merge-check journey-runs --main main-runs
```

It exits 0 only when every journey in `journeys/` (each case, for a journey with cases) has a valid run in which every check passed. Anything else stops the merge:

- a journey with no run, for example because the test crashed or was skipped;
- a failed check, even if main fails it too;
- a check with no evidence (`not_checked`);
- a blocked check, unless the same check was blocked in main's newest run in `main-runs`. A check that is blocked on main today, for example by a missing test account, does not hold up every pull request. A check that the change stopped from being checked does.

Make the job that runs it a required check. Name the job `journeys`, or set its name with `gh variable set JOURNEYS_CHECK --repo <owner>/<repo> --body "<check name>"`. A required job that is skipped counts as passing on GitHub, so the job must run on every pull request with no `if:` or path filter.

## Set up a repo

### 1. Run the journeys in CI

Add a job to the repo's normal CI workflow. It starts the app the way the journeys need, then runs these steps. It runs on pull requests and on pushes to main, so each main run leaves runs to compare with.

```yaml
  journeys:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read # to download main's runs
    steps:
      # ... check out, install, start what the journeys need ...
      - run: npx playwright install --with-deps --only-shell chromium

      # merge-check decides, from the runs, so a failing journey does not stop here.
      - name: Run the journeys
        run: npx playwright test
        continue-on-error: true

      - name: Get main's newest runs
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          id=$(gh run list --workflow "${{ github.workflow }}" --branch main --event push --status completed --limit 1 --json databaseId --jq '.[0].databaseId // empty')
          if [ -n "$id" ] && gh run download "$id" --name journey-runs --dir main-runs; then echo "Main's runs are from run $id."; else echo "No runs from main yet."; fi

      - name: Journeys pass, or were blocked on main too
        if: github.event_name == 'pull_request'
        run: npx journeysfirst merge-check journey-runs --main main-runs

      - name: Keep the runs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: journey-runs
          path: journey-runs/
          retention-days: 30
```

### 2. A token

The workflow needs a token that can push the branch and open the pull request. The default `GITHUB_TOKEN` cannot: a pull request it opens starts no other workflows, so the journeys would never run, and it cannot push a change to a file in `.github/workflows/`. Reading the newest version from npm needs no token.

Make a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new:

- Resource owner: the organization.
- Repositories: each product repo.
- Permissions: Contents read and write, Pull requests read and write, Workflows read and write.

A GitHub App installed on these repos is the alternative to a personal token.

Save it as `JOURNEYSFIRST_TOKEN` in each product repo. One organization secret covers them all:

```bash
gh secret set JOURNEYSFIRST_TOKEN --org <org> --repos <product repo>,<other product repo>
```

### 3. Repo settings

Turn on auto-merge, and require the journeys job on the default branch:

```bash
gh api --method PATCH repos/<owner>/<repo> -F allow_auto_merge=true
gh api --method POST repos/<owner>/<repo>/rulesets --input - <<'JSON'
{
  "name": "Journeys pass before merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [{ "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [{ "context": "journeys" }] } }],
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
}
JSON
```

`actor_id` 5 is the admin role, so admins can still merge by hand.

### 4. Try it

```bash
gh workflow run journeysfirst-upgrade.yml --repo <owner>/<repo>
gh run watch --repo <owner>/<repo> "$(gh run list --repo <owner>/<repo> --workflow journeysfirst-upgrade.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh pr list --repo <owner>/<repo> --head journeysfirst/upgrade
```
