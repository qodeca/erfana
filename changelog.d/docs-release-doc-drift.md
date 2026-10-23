### Internal

- **The release pre-flight now fails when a doc states a stale version.**
  `npm run check:version-drift` compares the `CLAUDE.md` version banner and the Electron version
  that `SDLC.md`, `CONTRIBUTING.md` and the docs state as current with `package.json` and the
  lockfile, and runs as the `version_drift` gate of the `releasing-erfana` pre-flight. The
  changelog gains a fixed `## [Unreleased]` pointer to `changelog.d/`, and the release audit step
  in `docs/security.md` now diffs against the previous release's exceptions table, whatever its
  version.
