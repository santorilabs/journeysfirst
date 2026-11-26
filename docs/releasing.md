# Release Journeys First

1. Choose the next npm version under [SemVer](https://semver.org/). While the package is pre-1.0, use a minor version for changes that require consumers to update their code. Use a patch for compatible fixes.
2. From the repo root, run `npm version <version> --workspace packages/core --no-git-tag-version`. Check that the package version and lockfile agree. The examples use the local workspace, so their dependencies do not need a version bump. Move the release notes from `Unreleased` in [CHANGELOG.md](../CHANGELOG.md) to a heading for the new version. Include any upgrade steps.
3. Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md) and merge the version and notes after CI passes.
4. Publish a GitHub release with tag `v<version>` on that commit. The [publish workflow](../.github/workflows/publish.yml) checks the tag, runs the tests, and packs and checks the npm tarball before publishing it using trusted publishing.
5. Verify the version and tarball on the public registry with `npm view journeysfirst@<version> dist.integrity` and `npm pack journeysfirst@<version> --dry-run --json`. Check that `skills/`, `spec/`, and `docs/` are there. If something is missing, fix the package and release a new version rather than replacing the old one.

The release requires npm trusted publishing for this repository and the `publish.yml` workflow. It does not use a stored npm publish token.
