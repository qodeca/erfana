# Release incident history

This is the running log of `release.yml` workflow failures during real or dry-run releases. Every memo (`vX.Y.Z-attempt-N.md`) carries the verbatim run URL, last 100 lines of the failed-step log, and the matched signature from [`.claude/skills/releasing-erfana/guides/troubleshooting.md`](../../.claude/skills/releasing-erfana/guides/troubleshooting.md) § CI failure signatures.

The `release-failure-analyzer` agent appends entries to this index automatically. Manual entries should follow the same format.

## How to use this file

1. **As an operator hitting a CI failure:** the analyzer agent will write a new memo and append a row here. Read the matched signature, apply the fix, bump the patch, retry.
2. **As an operator who just hit an unmatched signature:** the agent marks the row's `Matched signature` cell as `unknown` — once you've found the root cause, **add a new row to the cookbook** at `.claude/skills/releasing-erfana/guides/troubleshooting.md` so the next failure of the same shape resolves automatically.
3. **As a release engineer reviewing the pipeline's health:** scan the table for repeating signatures — three failures of the same row means the underlying tooling needs a structural fix, not just a workaround.

## Incident history

Newest first.

| Date | Version | Attempt | Run | Failed leg | Matched signature | Memo |
|------|---------|---------|-----|------------|-------------------|------|
| _no incidents recorded yet — first one will be appended automatically by the failure-analyzer agent_ |

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
