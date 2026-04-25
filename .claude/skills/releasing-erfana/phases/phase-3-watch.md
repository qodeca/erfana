# Phase 3: Watch release.yml

This phase polls the `release.yml` CI run started by the Phase 2 tag push. The pipeline takes 25–60 minutes wall-clock (Linux + Windows ~8 min each in parallel; macOS notarize is the long pole at 20–45 min). The skill **polls** rather than foreground-watches because the orchestrator's per-tool execution budget is bounded — `gh run watch` cannot span the full pipeline.

**Pre-condition**: tag `v${VERSION}` exists on origin, dereferences to a commit on `main`, and that commit has a green `checks.yml` run (asserted by the workflow's `prepare` job).

**Post-condition**: `release.yml` either reached `completed/success` (operator continues to Phase 4) or terminal-failed (handed to `release-failure-analyzer`).

## 3.1 Resolve `RUN_ID`

Annotated tags must be dereferenced with `^{}` for workflow-run queries — `gh run list` keys on commit SHA, not tag-object SHA. The workflow may take up to 60 s to appear after the push.

```bash
TAG_SHA=$(git rev-parse "v${VERSION}^{}")
RUN_ID=""
for i in $(seq 1 12); do
  RUN_ID=$(gh run list --workflow=release.yml \
    --commit="$TAG_SHA" --limit=1 \
    --json databaseId --jq '.[0].databaseId // empty')
  if [ -n "$RUN_ID" ]; then break; fi
  sleep 5
done
if [ -z "$RUN_ID" ]; then
  echo "FAIL: release.yml did not pick up tag v${VERSION} within 60 s"
  exit 1
fi
echo "Release run: https://github.com/qodeca/erfana/actions/runs/${RUN_ID}"
```

## 3.2 Poll until completion

The orchestrator polls every **240 s** (4 min) — under the 5-min Anthropic prompt-cache TTL so the cache stays warm — with a hard ceiling of **22 polls (~88 min)**. Foreground `gh run watch` is intentionally not used: `timeout 90m` is GNU-only (missing on macOS by default), and the Bash tool's 600 s ceiling cannot span the full pipeline anyway.

```bash
for poll in $(seq 1 22); do
  STATE=$(gh run view "$RUN_ID" \
    --json status,conclusion \
    --jq '"\(.status)/\(.conclusion // "")"')
  case "$STATE" in
    completed/success)
      echo "release.yml: SUCCESS"
      RC=0
      break
      ;;
    completed/*)
      echo "release.yml: $STATE — abort"
      RC=1
      break
      ;;
    *)
      echo "poll $poll/22: $STATE"
      sleep 240
      ;;
  esac
done

# If we exhausted the loop without breaking, the pipeline exceeded the
# 88-minute ceiling — treat as failure.
if [ -z "${RC:-}" ]; then
  echo "FAIL: release.yml exceeded 88-minute ceiling"
  RC=1
fi
```

The orchestrator is expected to surface progress between polls (number completed, current macOS step, etc.) using `gh run view --json jobs` — this is operator-facing only and does not affect the gate.

## 3.3 On failure → invoke `release-failure-analyzer`

If `RC` is non-zero, **do NOT just dump 200 log lines and exit.** Delegate to the failure analyzer so the diagnostic capture is structured and reusable.

```
Agent(subagent_type: "release-failure-analyzer")
Prompt: "Analyse failed release.yml run.
         Inputs:
           - run_id: ${RUN_ID}
           - version: ${VERSION}
           - attempt_number: <Nth attempt for this version, see docs/release-incidents/index.md>
           - project_path: <repo root>
         Identify failed leg(s), match log against the troubleshooting cookbook,
         write incident memo to docs/release-incidents/v${VERSION}-attempt-{N}.md,
         append index entry. Return structured JSON per agent contract."
```

The agent writes the memo and returns:
- Matched cookbook row (if any) with the suggested fix verbatim.
- Run URL.
- Memo path (e.g., `docs/release-incidents/v0.9.5-attempt-2.md`).
- Last 100 log lines for context.

**Skill action after analyzer returns:**

1. Display the matched fix prominently to the operator.
2. Surface the memo path so they can read full context.
3. Use `AskUserQuestion` to decide next step:

| Option | Action |
|--------|--------|
| Apply fix + bump patch + re-run | Operator commits the fix; skill bumps version, restarts from Phase 0. |
| Investigate further | Skill exits; operator reviews memo manually. |
| Mark as unknown signature → cookbook update + retry | **Gated path** (see below). Skill verifies the cookbook gained a new row matching the unmatched signature before allowing re-entry to Phase 0. |

**Unknown-signature gate (option 3):** if `matched.found=false`, the skill MUST verify the cookbook gained a new row before re-entering Phase 0 — preventing repeated identical failures on the same unmatched signature.

```bash
# Pick a distinctive 8-12 word phrase from the unmatched log fragment.
DISTINCTIVE="<phrase>"
# AskUserQuestion: "Have you added a new cookbook row for this signature?"
# If "Yes": grep cookbook for the distinctive phrase. If absent → fail.
grep -qF "$DISTINCTIVE" .claude/skills/releasing-erfana/guides/troubleshooting.md || {
  echo "::error::Cookbook update claimed but distinctive phrase not found"
  exit 1
}
```

**Tag is burned regardless** — every retry must use a new patch version. This is non-negotiable per the enforcement rules.

```bash
# After the analyzer returns, surface its output and stop the skill.
# Subsequent attempts re-enter the skill at Phase 0 with the bumped version.
echo "Release run failed. URL: https://github.com/qodeca/erfana/actions/runs/${RUN_ID}"
echo "Incident memo: ${MEMO_PATH}"
exit 1
```

## `gh` version dependency

Phase 3 depends on these `gh` JSON fields being supported by the operator's `gh` install:

| Call | Field |
|---|---|
| `gh run list --json databaseId` | `databaseId` |
| `gh run view --json status,conclusion,jobs` | `status`, `conclusion`, `jobs[].name`, `jobs[].status`, `jobs[].conclusion` |

Confirmed working with `gh` 2.91.0 (the version used during the v0.9.5 release). The Prerequisites table in `SKILL.md` pins `gh ≥ 2.55.0`. If `gh release view --json isLatest` returns "Unknown JSON field" (older `gh` versions are missing the field), fall back to:

```bash
gh api repos/qodeca/erfana/releases/latest --jq '.draft, .prerelease, .html_url'
```

## Checkpoint 3.A

- [ ] `RUN_ID` resolved against the tag's dereferenced commit SHA (within 60 s retry window)
- [ ] Polling reached `completed/success`, OR
- [ ] Failure handed to `release-failure-analyzer` with run id + memo path
- [ ] Tag-burn rule observed: any retry uses a new patch version
