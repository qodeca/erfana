---
name: releasing-erfana
description: Build and release a new version of Erfana via the multi-platform CI release workflow. Enforces main-branch discipline, assembles two-tier release notes, pushes a signed tag, polls the release pipeline in GitHub Actions, cryptographically verifies every artifact, and gates the final publish on explicit operator approval. Use when Erfana is ready to ship.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion, TodoWrite
capabilities:
  - release-orchestration
  - ci-monitoring
  - artifact-verification
model: opus
user-invocable: true
---

# Releasing Erfana

Orchestrates the Erfana release flow that ends with **one GitHub release containing signed, notarized, attested artifacts for Windows + macOS** (the Linux distribution target was dropped). The CI matrix (`.github/workflows/release.yml`) does all build, sign, notarize, verify, and draft-upload work. This skill handles pre-tag sanity, tag push, CI polling, local cryptographic verification, and the human approval checkpoint.

Detailed ops reference: [docs/build/release.md](../../../docs/build/release.md).
Design anchor: [#174](https://github.com/qodeca/erfana/issues/174).

> **Note**: This skill is project-scope-only. The relative path `../../../docs/build/release.md` is intentional — moving the skill to user-scope (`~/.claude/skills/`) would break the doc reference and orphan the project-local `release-failure-analyzer` agent. See "Architectural exception" below.

## When this skill applies

Activate when the user says:

- "release Erfana"
- "prepare release"
- "cut a release"
- "ship v0.9.5" (or similar version)
- "new release"

Activate only when the working copy can reasonably be released.

**Anti-triggers — do NOT activate for:**
- Build/test troubleshooting (no signed tag involved)
- Dev-only tagging (e.g., `v0.0.0-dev`, internal milestones)
- Hotfix work to a version that hasn't been released
- Investigating CI without intent to ship
- Tag deletion or rollback of a published release (separate ops, not in skill scope)

> **Shell requirement**: Phase 4–5 bash uses array constructs and `<( ... )` process substitution. Run via `bash` (not `zsh`) — `#!/usr/bin/env bash` shebang. See `phases/phase-4-verify.md` §4.2 note.

## Prerequisites

| Dependency | Purpose | Check |
|-----------|---------|-------|
| `git` | Signed tag, push | `git --version` |
| `node` (≥24) | Read package.json, run git-cliff if installed via npx | `node --version` |
| `gh` ≥ 2.55.0 | Release polling, asset download, draft publish | `gh --version` (verified with 2.91.0; older versions may be missing JSON fields used in Phases 3–5 — fall back to `gh api` if needed) |
| `git cliff` | Technical section for release notes | `git cliff --version` (skill will fall back to `npx git-cliff` if needed) |
| `minisign` | Verify `SHA256SUMS.minisig` | `minisign -v` |
| `sha256sum` | Recompute asset hashes locally | `command -v sha256sum` |

All external credentials (Apple Developer, Azure Artifact Signing, minisign release keypair) live in **GitHub secrets** and never flow through the local machine. See [docs/build/release.md § Secrets and rotation calendar](../../../docs/build/release.md#secrets-and-rotation-calendar).

## Constants

These values appear in multiple places. Update here first, then `EXPECTED_ASSETS=4` in §0.4 and the count comment in `phase-4-verify.md` §4.5 will reference this table.

| Constant | Value | Note |
|---|---|---|
| Expected binary count | 2 | macOS-arm64 (`erfana-{version}-arm64.dmg`), Windows x64 NSIS (`erfana-{version}-setup.exe`) |
| Expected total asset count | 4 | 2 binaries + `SHA256SUMS` + `SHA256SUMS.minisig` |
| Phase 3 polling cadence | 240 s × 22 polls | 88 min ceiling for `release.yml` completion |
| Per-leg stuck-leg threshold | 2700 s (45 min) | Single leg in_progress beyond this triggers warning |

## Agents

| Agent | Purpose | Source | Used in |
|-------|---------|--------|---------|
| `release-quality-runner` | Enforce Phase 0 pre-flight checklist (branch, version, secrets, workflow lint, electron-builder schema) | shared (project override) | Phase 0 |
| `release-notes-drafter` | Emit two-tier release-notes markdown via `git cliff` + operator summary | shared (project override) | Phase 1 |
| `release-failure-analyzer` | On Phase 3 CI failure: identify failed leg, match log against the troubleshooting cookbook, write structured incident memo to `docs/release-incidents/` | project-local | Phase 3 (failure path) |

**`release-build-executor` is retired** (removed in [#174](https://github.com/qodeca/erfana/issues/174)). CI owns the build. The skill watches, verifies, and publishes.

## Quick reference

| Item | Value |
|------|-------|
| Release branch | `main` (skill refuses elsewhere) |
| Tag pattern | `v[0-9]+.[0-9]+.[0-9]+` (strict; pre-release suffixes rejected) |
| Version source | `package.json` → `"version"` |
| Release notes path | `docs/release-notes/v{version}.md` (two-tier with `<details>`) |
| CI workflow | `.github/workflows/release.yml` |
| Expected release assets | See `## Constants` above (2 binaries + 2 = 4 total) |
| Provenance attestations | **Not used** — GitHub Artifact Attestations are Enterprise-only for private repos. Authenticity covered by minisign + per-platform OS signing. |
| Minisign release pubkey | `docs/security.md` § Release signing |

## Critical enforcement rules (NON-NEGOTIABLE)

1. **Main only.** Phase 0 aborts if `git branch --show-current` is not `main`.
2. **Strict semver.** Phase 0 rejects anything other than `v[0-9]+.[0-9]+.[0-9]+`.
3. **Signed tags only.** Protected-tag rule on the remote enforces this; skill surfaces actionable errors if tag push is rejected.
4. **Verify before publish.** Phase 4 must complete minisign + per-file sha256 verification before the operator approval prompt is shown.
5. **No auto-publish.** Marking the draft as `--latest` requires explicit operator approval after verification is green.
6. **No bypass.** A verification failure in Phase 4 aborts — do not prompt for approval, do not suggest manual overrides. The release is burned; bump the patch.
7. **MUST delegate every executor step.** The quality checklist (Phase 0) and release notes drafting (Phase 1) go through agents. Documented exceptions (e.g., Phase 5.1 minisign re-verify) must be explicitly justified in-place with a `Rule #7 exception` comment block.
8. **Idempotency with honesty.** If a tag is already pushed, Phase 0 offers resume-to-Phase-3 (non-destructive) or delete-and-retry (destructive, explicit operator confirmation).

### Architectural exception (Rule #2 — project-local agent)

`release-failure-analyzer` is intentionally project-local at `.claude/agents/release-failure-analyzer.md` rather than `~/.claude/agents/`. Rationale: the agent's `<workflow>` step 4 has a hard structural contract with `guides/troubleshooting.md` (Erfana-specific cookbook format, six typed labels per row, platform classification, signature samples). Promoting it to user-scope without splitting the cookbook would require parameterizing a format invariant — a worse abstraction than today's honest project-local agent. Promoting it *with* the cookbook would scatter project-specific operational knowledge across user-scope, breaking the principle that a project skill is the single source of truth for project-specific operational knowledge. This exception is bounded to project skills with bundled domain cookbooks and should be revisited only if a second project develops a structurally-identical cookbook.

---

## Todo list (MANDATORY)

At release start, the skill MUST call `TodoWrite` once with all six phase entries pre-registered, each in `pending` status. The six entries are:

- **Phase 0:** Pre-flight (main-branch + semver + CHANGELOG)
- **Phase 1:** Release notes (two-tier)
- **Phase 2:** Signed tag + push
- **Phase 3:** Watch release workflow
- **Phase 4:** Verify + publish checkpoint
- **Phase 5:** Post-publish verification + summary

Each entry is one object in the `TodoWrite` array with `{content: "<phase summary>", status: "pending", activeForm: "<present-continuous form>"}`. As each phase begins, call `TodoWrite` again with that entry's status set to `in_progress`; on checkpoint pass, set it to `completed`. The list above provides the `content` field text — not literal source code.

---

## Phase 0: Pre-flight

### 0.1 Branch gate

```bash
BR=$(git branch --show-current)
if [ "$BR" != "main" ]; then
  echo "FAIL: Release must run from main, got: $BR"
  exit 1
fi
```

- [ ] Current branch is exactly `main` (no exceptions)

### 0.2 Working tree is clean

```bash
git fetch origin
git status --porcelain
```

- [ ] No uncommitted or untracked files (skill aborts otherwise)
- [ ] Local `main` is not behind `origin/main` (skill surfaces a clear message if so)

### 0.3 Version + CHANGELOG gate

Ask the operator (AskUserQuestion) for the **bump type** (patch / minor / major). The skill computes the proposed version from `package.json`. Then:

```bash
VERSION=$(node -p "require('./package.json').version")
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FAIL: version '$VERSION' is not strict semver"
  exit 1
fi
LAST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
# CHANGELOG must already contain a "## {version}" section for this release.
grep -q "^## $VERSION" docs/CHANGELOG.md || {
  echo "FAIL: docs/CHANGELOG.md is missing a '## $VERSION' section"
  exit 1
}
```

- [ ] `package.json` version is strict semver
- [ ] `docs/CHANGELOG.md` contains `## {version}` heading
- [ ] Proposed version > last tag

### 0.4 Idempotency check: does the tag already exist?

```bash
TAG_EXISTS_LOCAL=false
TAG_EXISTS_REMOTE=false
RELEASE_STATE="none"  # one of: none | draft-empty | draft-ready | published

# Expected total asset count: see SKILL.md `## Constants` table
EXPECTED_ASSETS=4

if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then
  TAG_EXISTS_LOCAL=true
fi
if git ls-remote --exit-code --tags origin "refs/tags/v${VERSION}" >/dev/null; then
  TAG_EXISTS_REMOTE=true
fi

# If the remote tag is already pushed, classify the GitHub release state so
# we can pick the correct resume point (per spec issue #174 §Idempotency).
if [ "$TAG_EXISTS_REMOTE" = "true" ]; then
  RELEASE_JSON=$(gh release view "v${VERSION}" --json isDraft,assets 2>/dev/null || echo "")
  if [ -z "$RELEASE_JSON" ]; then
    RELEASE_STATE="none"  # tag pushed but release doesn't exist yet — run probably in flight
  else
    IS_DRAFT=$(printf '%s' "$RELEASE_JSON" | jq -r '.isDraft')
    ASSET_COUNT=$(printf '%s' "$RELEASE_JSON" | jq -r '.assets | length')
    if [ "$IS_DRAFT" = "false" ]; then
      RELEASE_STATE="published"
    elif [ "$ASSET_COUNT" -ge "$EXPECTED_ASSETS" ]; then
      RELEASE_STATE="draft-ready"   # 2 binaries + SHA256SUMS + .minisig = 4
    else
      RELEASE_STATE="draft-empty"   # finalize hasn't yet sealed the draft
    fi
  fi
fi
```

If a tag already exists, branch on `RELEASE_STATE` and present options via `AskUserQuestion`:

**Case A — `RELEASE_STATE=none`** (tag on origin, no draft yet → run probably in flight):

| Option | Meaning | Risk |
|--------|---------|------|
| Resume at Phase 3 | Wait for CI run to finish, then verify. | Low |
| Delete remote tag and restart | `git push --delete origin v${VERSION}` and re-enter from Phase 1. | **DESTRUCTIVE** — voids any in-flight signed artifact. Require explicit confirmation. |
| Abort | Exit the skill. | None |

**Case B — `RELEASE_STATE=draft-empty`** (draft exists but `finalize` not yet complete):

Same as Case A — finalize is still in flight. Resume at Phase 3.

**Case C — `RELEASE_STATE=draft-ready`** (draft has all 4 expected assets, finalize completed):

| Option | Meaning | Risk |
|--------|---------|------|
| Resume at Phase 4 (verify + approve) | Skip Phase 3 polling; jump straight to cryptographic verification of the existing draft. | Low — Phase 4 is structurally re-entrant and idempotent (read-only verification, then operator approval). |
| Delete draft and restart | `gh release delete "v${VERSION}" --yes --cleanup-tag=false` then `git push --delete origin v${VERSION}` and re-enter from Phase 1. | **DESTRUCTIVE** — voids the signed artifacts. Require explicit confirmation. |
| Abort | Exit the skill. | None |

**Case D — `RELEASE_STATE=published`** (release already published as latest):

```bash
URL=$(gh release view "v${VERSION}" --json url --jq .url)
echo "Release v${VERSION} is already published and marked latest: $URL"
echo "Nothing to do. Exiting."
exit 0
```

No options — exit cleanly. Re-running the skill on a published tag means the operator already approved publication; the only follow-up is a hotfix at the next patch version.

### 0.4.5 Branch protection allows direct push

The skill assumes a solo-developer direct-push workflow. If branch protection on `main` requires PRs, `git push origin main` (Phase 1.5) will be rejected and the skill cannot proceed. Detect this at Phase 0 rather than at tag-time.

```bash
PROT=$(gh api repos/qodeca/erfana/branches/main/protection 2>/dev/null || echo '{}')
PR_REQ=$(printf '%s' "$PROT" | jq -r '.required_pull_request_reviews // {} | keys | length')
if [ "${PR_REQ:-0}" -gt 0 ]; then
  echo "FAIL: main requires PR; skill assumes direct push (single-developer workflow)" >&2
  echo "Remediation (one-time admin action):" >&2
  echo "  gh api -X DELETE \\" >&2
  echo "    repos/qodeca/erfana/branches/main/protection/required_pull_request_reviews" >&2
  echo "Other protection rules (signed tags, required status checks) stay intact." >&2
  exit 1
fi
```

- [ ] `required_pull_request_reviews` is unset on the `main` branch protection rule

### 0.5 Delegate the rest of the checklist to `release-quality-runner`

```
Task(subagent_type: "release-quality-runner",
     prompt: "Run the Phase 0 release-readiness checklist for Erfana at {project_path}
              on branch main. Run all four quality gates (gates: ['lint', 'typecheck', 'test', 'audit'])
              and the pre-flight checklist:
              - running dev servers
              - uncommitted changes (should be none after our gate)
              - node version
              - gh authenticated
              - minisign installed
              Return: {
                overall: 'pass'|'fail',
                failures: string[],
                warnings: string[],
                gates_run: string[]
              }")
```

Any `fail` stops the skill. Warnings are surfaced to the operator, who can continue.

### Checkpoint 0.A

**Ask operator:** "All pre-flight gates passed for v{version}. Proceed to draft the release notes?"

Options: **Proceed** / **Abort**.

---

## Phase 1: Two-tier release notes

### 1.1 Generate the technical section

```bash
# Requires cliff.toml at repo root.
git cliff --tag "v${VERSION}" --unreleased > .release-notes-technical.tmp.md
```

If `git cliff` is not installed, fall back:

```bash
npx -y git-cliff --tag "v${VERSION}" --unreleased > .release-notes-technical.tmp.md
```

### 1.2 Collect the user-facing summary from the operator

Subagents cannot call `AskUserQuestion` — it must be called from the skill. Use it now to collect 3–5 bullet points that describe the release in user-facing terms.

Present via `AskUserQuestion`: ask for 3–5 brief bullet points summarising what changed from the end user's perspective. Prompt text example:

> "Summarise v{VERSION} in 3–5 bullets for end users. Examples: 'Releases are now cryptographically signed on macOS and Windows' / 'Fixed a bug where terminal scroll lost the last line'. Skip developer-internal changes — the technical section below covers those from commit history."

Persist the operator's reply into a variable (e.g., `$USER_SUMMARY`) as a single markdown string containing the bullets. Do NOT invent bullets if the operator's reply is too short — re-prompt instead.

### 1.3 Delegate composition to the agent

```
Task(subagent_type: "release-notes-drafter",
     prompt: "Compose two-tier release notes for Erfana v${VERSION}.
              Inputs:
                - version: ${VERSION}
                - technical_section_path: .release-notes-technical.tmp.md
                - user_summary: <pasted $USER_SUMMARY verbatim>
                - output_path: docs/release-notes/v${VERSION}.md
              Write the file with the exact template:
                # Erfana v${VERSION}
                _Released: <UTC YYYY-MM-DD>_
                ${user_summary}
                <details><summary>Technical changes</summary>
                <technical section contents>
                </details>
              Do NOT invent content beyond inputs. Do NOT call AskUserQuestion.
              Return the composed content + output path.")
```

### 1.4 Operator review

Present the generated `docs/release-notes/v${VERSION}.md` and ask whether to accept, edit, or re-draft.

- [ ] Two sections present: user-facing summary and collapsible technical section
- [ ] Operator explicitly approved

### 1.5 Single-commit bundle

Pre-flight check before §1.5 commit bundle: see [`./guides/git-signing.md`](./guides/git-signing.md) (added per #174 reviewer finding — verifies `user.signingkey` and `gpg.format`; soft-warns on missing `gpg.ssh.allowedSignersFile`).

```bash
# One commit bundles: package.json bump (already done pre-skill or done here),
# CHANGELOG append (pre-skill), release notes file.
git add package.json docs/CHANGELOG.md "docs/release-notes/v${VERSION}.md"

# Pick the commit message based on what is actually staged. If the bump
# already shipped earlier (e.g., develop→main merge), this commit only
# adds the release-notes file — labelling it "bump version" would be a
# false description of the diff.
if git diff --cached --name-only | grep -qx 'package.json'; then
  COMMIT_MSG="chore(release): bump version to ${VERSION}"
else
  COMMIT_MSG="docs(release): add release notes for v${VERSION}"
fi
git commit -S -m "$COMMIT_MSG"
git push origin main
```

If `main` has new commits on `origin` (raced), re-fetch and confirm with operator before retrying.

### Checkpoint 1.A

- [ ] Commit is on `origin/main` (`chore(release): bump version to {version}` if `package.json` was in the staged diff, else `docs(release): add release notes for v{version}`)
- [ ] `checks.yml` has been triggered for this commit (skill prints the URL)

The release workflow's `prepare` job asserts a green `checks.yml` for the tagged commit, so we must wait for `checks.yml` to turn green before tagging.

```bash
TIP_SHA=$(git rev-parse HEAD)
gh run list --workflow=checks.yml --branch=main --commit="$TIP_SHA" --limit=1
# Poll until conclusion = success (max 10 min, 15 s interval). If failure:
# abort, direct operator to fix the failure before re-running.
```

---

## Phase 2: Signed tag + push

### 2.1 Create the signed tag

```bash
git tag -s "v${VERSION}" -m "Release v${VERSION}"
```

If tag creation fails because no signing key is configured: **stop**. Direct the operator to configure SSH/GPG signing (`git config user.signingkey`, `commit.gpgsign true`, `tag.gpgsign true`).

### 2.2 Push the tag

```bash
# One tag at a time — not `git push --tags`. Only the first tag on a
# bulk push reliably fires the release workflow (actions/runner#3644).
git push origin "v${VERSION}"
```

If the push is rejected by the protected-tag rule, surface the exact rejection message and stop.

### Checkpoint 2.A

- [ ] Tag `v{version}` exists on `origin` and is signature-verified

---

## Phase 3: Watch release.yml

Full instructions live in [`phases/phase-3-watch.md`](phases/phase-3-watch.md) — Phase 3 spans up to 88 minutes wall-clock and uses a polling pattern (4-minute cadence, 22-poll ceiling) rather than a foreground `gh run watch`. Reasons: `timeout` is GNU-only (missing on macOS by default), and the orchestrator's per-tool budget cannot span the full pipeline anyway.

Summary table:

| Step | What | Why it's required |
|---|---|---|
| 3.1 | Resolve `RUN_ID` from the tag's dereferenced commit SHA, with retry loop | `release.yml` may take up to 60 s to appear after the push |
| 3.2 | Poll `gh run view --json status,conclusion` every 240 s, hard ceiling 22 polls | Foreground watch exceeds the orchestrator's 600 s Bash budget; 240 s polls keep the prompt cache warm |
| 3.3 | On non-success terminal state, dispatch `release-failure-analyzer` with run id + memo path | Structured incident memo to `docs/release-incidents/`; cookbook-driven fix |

⛔ **Failure aborts.** A failed `release.yml` burns the tag — next attempt requires a patch bump.

### Checkpoint 3.A

- [ ] `RUN_ID` resolved per `phases/phase-3-watch.md` §3.1
- [ ] Polling reached `completed/success`, OR
- [ ] Failure handed to `release-failure-analyzer` with run id + memo path
- [ ] Tag-burn rule observed on retries (new patch version)

---

## Phase 4: Verify + publish checkpoint (CRITICAL)

Full instructions live in [`phases/phase-4-verify.md`](phases/phase-4-verify.md) — Phase 4 is the longest phase, contains the three independent cryptographic gates that are the entire point of this skill, and is the most likely to be read standalone (during release audits, post-incident forensics, or by an operator who only needs to verify a draft). Other phases are short enough to live inline in this file.

Summary table:

| Step | What | Why it's required |
|---|---|---|
| 4.1 | `gh release view --json isDraft` returns `true` | Sanity: `release.yml` produced a draft, not a published release |
| 4.2 | `gh release download` all assets to a temp dir | Local material for verification |
| 4.3 | `minisign -V` over `SHA256SUMS` + `.minisig` | Proves the sums were signed by the release minisign key |
| 4.4 | `sha256sum` every asset, `diff` against `SHA256SUMS` | Proves each asset matches what was signed |
| 4.5 | `gh run download --name sha256sums-digest` + `diff -q` against the asset | Catches post-`finalize` tampering of the draft asset |
| 4.6 | `AskUserQuestion` — Publish + mark latest / Leave as draft / Abort and delete | Explicit operator approval; no auto-publish |

⛔ **Any failure in 4.3–4.5 aborts before the operator is asked.** Do not prompt for approval, do not suggest manual override. The release is burned; bump the patch.

### Checkpoint 4.A

- [ ] Steps 4.1–4.5 all green per `phases/phase-4-verify.md`
- [ ] Operator explicitly chose Publish or Leave-as-draft via `AskUserQuestion`
- [ ] Release visibility matches operator's choice

---

## Phase 5: Post-publish verification + summary

### 5.1 Re-verify the now-public release

> **Rule #7 exception (inline executor work).** The 3 commands below are intentionally inline rather than delegated to an agent. They re-run the Phase 4.3 minisign check against the now-public URL — pure read+verify, zero mutations, identical crypto operation to the agent-delegated check just performed. Wrapping in a new agent for 3 commands adds maintenance burden without diagnostic improvement.

```bash
# Re-download and re-verify minisign on the published release URL.
PUBLISHED=$(gh release view "v${VERSION}" --json url --jq .url)
gh release download "v${VERSION}" --repo qodeca/erfana --pattern 'SHA256SUMS*' --clobber --dir "$WORK/published"
minisign -V -P "$(cat "$WORK/release-primary.pub")" \
  -m "$WORK/published/SHA256SUMS" -x "$WORK/published/SHA256SUMS.minisig"
```

### 5.2 Final summary

Present:
- Published URL
- Artifact list with sizes
- Verification log (all green)
- Rotation reminder if any of Apple API key / Azure cert / minisign key are within 60 days of expiry (skill reads the calendar stored alongside the secrets table in `docs/build/release.md`)
- Next steps: announce internally, update release tracker, etc.

---

## Anti-patterns

See [`./guides/anti-patterns.md`](./guides/anti-patterns.md) for the full Don't/Do table.

---

## Reference files

- [`guides/anti-patterns.md`](guides/anti-patterns.md) — Don't/Do table for release-day patterns
- [`guides/examples.md`](guides/examples.md) — Worked examples (success, lockfile-drift, hash-mismatch)
- [`guides/git-signing.md`](guides/git-signing.md) — Pre-flight git signing check (Phase 1.5)
- [`guides/troubleshooting.md`](guides/troubleshooting.md) — failure recovery and rollback procedures
- [`templates/release-notes.md`](templates/release-notes.md) — two-tier release-notes template
- [`docs/build/release.md`](../../../docs/build/release.md) — full operator reference (matrix, secrets, incident response)

---

## Examples

See [`./guides/examples.md`](./guides/examples.md) for worked examples (successful release, lockfile-drift abort, hash mismatch).
