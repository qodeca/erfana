# Phase 0 pre-flight checks (extracted)

> Pre-flight check before the §0.5 agent delegation in the `releasing-erfana` skill.
> SKILL.md §0.4.6 is a pointer to this guide; the script below is executed in exactly
> one place — the `release-quality-runner` agent (`<workflow>` step 11, gate key
> `windows_snapshot`).

## 0.4.6 Windows status snapshot is current

`docs/windows/implementation-plan.md` is the declared single source of truth for
Windows phase status, and the root `CLAUDE.md` refresh policy requires bumping its
"Status snapshot" version anchor **before** tagging. v0.16.3 — the only one of the
0.16.x attempts that actually published — shipped with the snapshot still anchored
on **v0.16.0** (`git show v0.16.3:docs/windows/implementation-plan.md`); the two
attempts before it, v0.16.1 and v0.16.2, were burned by Windows signing failures and
still sit as unpublished drafts, and both carried the same v0.16.0 anchor. One shipped
miss is enough: the policy needs a gate rather than a convention.

### Semantics

- **Strict equality against `package.json`.** Phase 0 runs *after* the version bump,
  so at check time `package.json` already carries the version about to be tagged.
  The snapshot anchor must equal it exactly – no "greater than the last tag" slack.
- **The snapshot is deliberately written ahead of the tag.** Re-anchoring on a version
  that is not yet released is not a documentation lie; it is part of release prep.
- **The re-anchor does NOT ride the §1.5 commit bundle.** §1.5 stages exactly
  `package.json`, `docs/CHANGELOG.md` and `docs/release-notes/v{version}.md` —
  `docs/windows/implementation-plan.md` is not in that list, and this gate runs at
  §0.4.6, i.e. *after* §0.2's clean-tree gate. So remediating a failure mid-release
  dirties the tree and §0.2 will refuse on the next run. The remediation is its own
  earlier commit: edit the anchor, `git commit -m "docs(windows): re-anchor status
  snapshot on v{version}"`, push, wait for `checks.yml`, then restart Phase 0 from
  §0.1. Cheapest path: re-anchor in the same commit as the version bump, before the
  skill is invoked at all.
- **The check runs once, in the agent.** SKILL.md §0.4.6 is a three-line pointer with
  no inline script and no checkbox; the executable copy lives here and runs as the
  `release-quality-runner` `windows_snapshot` gate. This is deliberate delegation, not
  the inline+agent duplication used for gates 0.1 / 0.2 / 0.3 — a shell script this
  fiddly (BSD/GNU `sed`, `grep` exit codes) is worth keeping in exactly one place.
- **The gate is unconditional; the `CLAUDE.md` refresh policy it serves is not.** That
  policy asks for a refresh "on any release that touches Windows-phase scope OR changes
  a phase issue's state". This gate is deliberately stricter: strict equality on *every*
  release, including a pure macOS bugfix. Rationale — the anchor declares which release
  the snapshot describes, so a stale anchor is factually wrong whether or not anything
  Windows-specific moved. Over-triggering costs one line (date + version); under-
  triggering costs silent doc-vs-code drift, which is what v0.16.3 shipped.

### Script

```bash
# VERSION is normally already set by §0.3. The default lets the gate be
# exercised standalone, and the env override lets it be tested against a
# synthetic version without editing package.json.
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
SNAP_FILE="docs/windows/implementation-plan.md"
SNAP_HIT=$(grep -nE '^\*Last updated [0-9]{4}-[0-9]{2}-[0-9]{2}, anchored on v[0-9]+\.[0-9]+\.[0-9]+' \
             "$SNAP_FILE" | head -1 || true)
if [ -z "$SNAP_HIT" ]; then
  echo "FAIL: no parsable status-snapshot anchor in $SNAP_FILE" >&2
  echo "Remediation: the Status snapshot must open with" >&2
  echo "  *Last updated YYYY-MM-DD, anchored on vX.Y.Z (...)" >&2
  exit 1
fi
SNAP_VER=$(printf '%s' "$SNAP_HIT" | sed -E 's/.*anchored on v([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
if [ "$SNAP_VER" != "$VERSION" ]; then
  echo "FAIL: Windows status snapshot anchored on v$SNAP_VER; package.json is $VERSION" >&2
  echo "Remediation: edit $SNAP_FILE:${SNAP_HIT%%:*} - re-anchor on v$VERSION, refresh the date." >&2
  exit 1
fi
```

- [ ] `docs/windows/implementation-plan.md` carries a parsable status-snapshot anchor
- [ ] The anchored version equals `package.json` `"version"` exactly

### Traps

| Trap | Why the script is written this way |
|---|---|
| `grep` exit code | Phase 0 snippets run under `set -euo pipefail`. A no-match `grep` exits 1 and would kill the shell before the friendly error, so the pipeline ends in `\|\| true` and the empty-result case is handled explicitly. |
| `sed -E`, not `sed -r` | macOS (BSD) `sed` has no `-r`; GNU `sed` accepts both. `-E` is the portable spelling for extended regex on the operator's mac and on CI. |
| Line number is recomputed | `grep -n` supplies the hit line and `${SNAP_HIT%%:*}` strips it back out for the remediation message. Never hardcode the line – the snapshot paragraph moves whenever the file is edited. |
| `VERSION` env override | `VERSION="${VERSION:-...}"` lets the gate be exercised (pass and fail paths) without touching `package.json`, which would otherwise pollute the release commit. |
| `head -1` | Only the first anchor line counts. A second "Last updated" line elsewhere in the file must not silently satisfy the gate. |
