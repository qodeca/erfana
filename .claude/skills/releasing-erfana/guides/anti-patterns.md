# Anti-patterns

Patterns that have caused real release-day incidents. Used by the `releasing-erfana` skill.

| Don't | Do instead |
|-------|------------|
| Run from `develop` | Run only from `main`. This forbids *running the skill* elsewhere; it does not forbid §1.5's develop-first push, where the same SHA lands on `develop` to earn its checks and is then pushed to `main` |
| Push a fresh release-prep commit straight to `main` | Push it to `develop`, wait for that SHA's runs to reach `completed`/`success`, then push `main` — required checks are enforced on push, so the direct attempt is rejected with `GH006` |
| Approve `production-signing` with `gh api -F "environment_ids[]=$ID"` | Send a JSON body (`--input -`, `{"environment_ids":[<id>],…}`) — the `-F` form returns `422 … not an integer` |
| Push with `git push --tags` | Push one tag at a time |
| `git rev-parse v${TAG}` for annotated tags | `git rev-parse v${TAG}^{}` |
| Skip the minisign verification because "assets look right" | Always verify minisign → per-asset sha256 → CI `sha256sums-digest` (Phase 4.3–4.5). Releases carry **no** attestations |
| Re-tag the same version after any signed artifact shipped | Bump to next patch — the tag is burned |
| Auto-mark the draft as latest | Explicit operator approval required |
| Manually `gh release upload` to fix a missing asset | Delete the draft, bump the patch, re-run |
| Edit an already-published release's assets | Cut a hotfix |
