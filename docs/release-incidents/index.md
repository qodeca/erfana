# Release incident history

This is the running log of `release.yml` workflow failures during real or dry-run releases. Every memo (`vX.Y.Z-attempt-N.md`) carries the verbatim run URL, last 100 lines of the failed-step log, and the matched signature from [`.claude/skills/releasing-erfana/guides/troubleshooting.md`](../../.claude/skills/releasing-erfana/guides/troubleshooting.md) § CI failure signatures.

The `release-failure-analyzer` agent appends entries to this index automatically. Manual entries should follow the same format.

## How to use this file

1. **As an operator hitting a CI failure:** the analyzer agent will write a new memo and append a row here. Read the matched signature, apply the fix, bump the patch, retry.
2. **As an operator who just hit an unmatched signature:** the agent marks the row's `Matched signature` cell as `unknown` — once you've found the root cause, **add a new row to the cookbook** at `.claude/skills/releasing-erfana/guides/troubleshooting.md` so the next failure of the same shape resolves automatically.
3. **As a release engineer reviewing the pipeline's health:** scan the table for repeating signatures — three failures of the same row means the underlying tooling needs a structural fix, not just a workaround.

## Incident history — `release.yml` failures

Newest first. Auto-appended by the `release-failure-analyzer` agent on terminal-failed `release.yml` runs.

| Date | Version | Attempt | Run | Failed leg | Matched signature | Memo |
|------|---------|---------|-----|------------|-------------------|------|
| _no `release.yml` incidents recorded yet — first one will be appended automatically by the failure-analyzer agent_ |

## Operator-side incident history

Failures during the local `releasing-erfana` skill's Phase 4 (download + verify) or Phase 5 (post-publish re-verify) that do NOT correspond to a `release.yml` failure. These do **not** burn the tag — they document operator-side recovery patterns. Append manually; there is no analyzer agent for this class.

Newest first.

| Date | Version | Phase | Symptom | Recovery summary | Memo |
|------|---------|-------|---------|------------------|------|
| 2026-05-22 | v0.9.6 | 4.2 download | TCP read timeout from `185.199.111.133:443` (GitHub/Fastly CDN) mid-stream; `gh release download --clobber` exited 1 with 7 of 11 assets complete and 4 partial | `curl -C -` per-file parallel resume against `.assets[].apiUrl`. All 4 partial files finished in ~3 min vs an estimated ~25 min for `gh --clobber` from scratch. Gates 4.3–4.5 then passed cleanly. | [v0.9.6-cdn-recovery.md](./v0.9.6-cdn-recovery.md) |

## Memo format

Each `vX.Y.Z-attempt-N.md` file contains:

```markdown
# Release incident: v{version} attempt #{N}

- **Run URL:** https://github.com/qodeca/erfana/actions/runs/{run_id}
- **Timestamp:** {ISO8601 UTC}
- **Failed leg(s):** {Linux | macOS | Windows | Prepare | Finalize | Cleanup}
- **Failed step:** {step name}

## Matched signature

{cookbook row N — symptom + root cause + fix that worked}

OR

## NEW SIGNATURE — needs cookbook row

{distinctive log fragment for future cookbook addition}

## Last 100 lines of failed log

```
{fenced log fragment}
```

## Suggested next action

{cookbook fix verbatim, OR diagnostic steps if unmatched}
```

## v0.9.5 bring-up archive

The 15+ dry-run cycles that preceded this index (runs 24897481170 → 24908659275, 2026-04-24 → 2026-04-25) produced the cookbook itself rather than per-incident memos. Each cookbook row in [`.claude/skills/releasing-erfana/guides/troubleshooting.md`](../../.claude/skills/releasing-erfana/guides/troubleshooting.md) carries the `First seen` run reference. Future incidents will land here as memos and append to the table above.
