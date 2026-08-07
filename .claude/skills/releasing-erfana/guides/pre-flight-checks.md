# Phase 0 pre-flight checks (extracted)

> Pre-flight check before the §0.5 agent delegation in the `releasing-erfana` skill.
> Consumers: SKILL.md §0.4.6 (inline) and the `release-quality-runner` agent
> (`<workflow>` step 11, gate key `windows_snapshot`).

## 0.4.6 Windows status snapshot is current

`docs/windows/implementation-plan.md` is the declared single source of truth for
Windows phase status, and the root `CLAUDE.md` refresh policy requires bumping its
"Status snapshot" version anchor **before** tagging. v0.16.1, v0.16.2 and v0.16.3
all shipped against a stale anchor, so the policy needs a gate rather than a
convention.

### Semantics

- **Strict equality against `package.json`.** Phase 0 runs *after* the version bump,
  so at check time `package.json` already carries the version about to be tagged.
  The snapshot anchor must equal it exactly – no "greater than the last tag" slack.
- **The snapshot is deliberately written ahead of the tag.** Re-anchoring on a version
  that is not yet released is not a documentation lie; it is part of release prep, and
  the commit that carries it is the same §1.5 bundle that carries the release notes.
- **The check runs twice, on purpose.** It is executed inline at §0.4.6 and again as an
  agent gate, exactly as gates 0.1 / 0.2 / 0.3 are duplicated between the skill and
  `release-quality-runner`. The inline run gives the operator a fast, local failure with
  a line number; the agent run keeps the structured Phase 0 report complete. The
  duplication is intentional, not an oversight.

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
