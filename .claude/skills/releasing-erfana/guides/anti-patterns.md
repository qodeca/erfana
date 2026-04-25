# Anti-patterns

Patterns that have caused real release-day incidents. Used by the `releasing-erfana` skill.

| Don't | Do instead |
|-------|------------|
| Run from `develop` | Run only from `main` |
| Push with `git push --tags` | Push one tag at a time |
| `git rev-parse v${TAG}` for annotated tags | `git rev-parse v${TAG}^{}` |
| Skip the minisign verification because "assets look right" | Always verify minisign → sha256 → attestations |
| Re-tag the same version after any signed artifact shipped | Bump to next patch — the tag is burned |
| Auto-mark the draft as latest | Explicit operator approval required |
| Manually `gh release upload` to fix a missing asset | Delete the draft, bump the patch, re-run |
| Edit an already-published release's assets | Cut a hotfix |
