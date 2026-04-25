---
name: releasing-erfana
description: Build and release a new version of Erfana via the multi-platform CI release workflow. Enforces main-branch discipline, assembles two-tier release notes, pushes a signed tag, polls the release pipeline in GitHub Actions, cryptographically verifies every artifact, and gates the final publish on explicit operator approval. Use when Erfana is ready to ship.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# Releasing Erfana

Orchestrates the Erfana release flow that ends with **one GitHub release containing signed, notarized, attested artifacts for Windows + macOS + Linux**. The CI matrix (`.github/workflows/release.yml`) does all build, sign, notarize, verify, and draft-upload work. This skill handles pre-tag sanity, tag push, CI polling, local cryptographic verification, and the human approval checkpoint.

Detailed ops reference: [docs/build/release.md](../../../docs/build/release.md).
Design anchor: [#174](https://github.com/qodeca/erfana/issues/174).

## When this skill applies

Activate when the user says:

- "release Erfana"
- "prepare release"
- "cut a release"
- "ship v0.9.5" (or similar version)
- "new release"

Activate only when the working copy can reasonably be released — do not activate for build/test troubleshooting, dev-only tagging, or non-release `v*` tags.

## Prerequisites

| Dependency | Purpose | Check |
|-----------|---------|-------|
| `git` | Signed tag, push | `git --version` |
| `node` (≥24) | Read package.json, run git-cliff if installed via npx | `node --version` |
| `gh` | Release polling, asset download, draft publish | `gh --version` |
| `git cliff` | Technical section for release notes | `git cliff --version` (skill will fall back to `npx git-cliff` if needed) |
| `minisign` | Verify `SHA256SUMS.minisig` | `minisign -v` |
| `sha256sum` | Recompute asset hashes locally | `command -v sha256sum` |

All external credentials (Apple Developer, Azure Artifact Signing, minisign release keypair) live in **GitHub secrets** and never flow through the local machine.

## Agents

| Agent | Purpose | Source | Used in |
|-------|---------|--------|---------|
| `release-quality-runner` | Enforce Phase 0 pre-flight checklist (branch, version, secrets, workflow lint, electron-builder schema) | shared (project override) | Phase 0 |
| `release-notes-drafter` | Emit two-tier release-notes markdown via `git cliff` + operator summary | shared (project override) | Phase 1 |
| `release-failure-analyzer` | On Phase 3 CI failure: identify failed leg, match log against the troubleshooting cookbook, write structured incident memo to `docs/release-incidents/` | project-local | Phase 3 (failure path) |

**`release-build-executor` is retired.** CI owns the build. The skill watches, verifies, and publishes.

## Quick reference

| Item | Value |
|------|-------|
| Release branch | `main` (skill refuses elsewhere) |
| Tag pattern | `v[0-9]+.[0-9]+.[0-9]+` (strict; pre-release suffixes rejected) |
| Version source | `package.json` → `"version"` |
| Release notes path | `docs/release-notes/v{version}.md` (two-tier with `<details>`) |
| CI workflow | `.github/workflows/release.yml` |
| Expected release assets | 9 binaries + `SHA256SUMS` + `SHA256SUMS.minisig` (11 total) |
| Provenance attestations | **Not used** — GitHub Artifact Attestations are Enterprise-only for private repos. Authenticity covered by minisign + per-platform OS signing. |
| Minisign release pubkey | `docs/security.md` § Release signing |

## Critical enforcement rules (NON-NEGOTIABLE)

1. **Main only.** Phase 0 aborts if `git branch --show-current` is not `main`.
2. **Strict semver.** Phase 0 rejects anything other than `v[0-9]+.[0-9]+.[0-9]+`.
3. **Signed tags only.** Protected-tag rule on the remote enforces this; skill surfaces actionable errors if tag push is rejected.
4. **Verify before publish.** Phase 4 must complete minisign + per-file sha256 verification before the operator approval prompt is shown.
5. **No auto-publish.** Marking the draft as `--latest` requires explicit operator approval after verification is green.
6. **No bypass.** A verification failure in Phase 4 aborts — do not prompt for approval, do not suggest manual overrides. The release is burned; bump the patch.
7. **Delegate wherever possible.** The quality checklist (Phase 0) and release notes drafting (Phase 1) go through agents.
8. **Idempotency with honesty.** If a tag is already pushed, Phase 0 offers resume-to-Phase-3 (non-destructive) or delete-and-retry (destructive, explicit operator confirmation).

---

## Todo list (MANDATORY)

At release start, the skill MUST call the `TaskCreate` tool once per phase to register six tracking tasks:

- **Phase 0:** Pre-flight (main-branch + semver + CHANGELOG)
- **Phase 1:** Release notes (two-tier)
- **Phase 2:** Signed tag + push
- **Phase 3:** Watch release workflow
- **Phase 4:** Verify + publish checkpoint
- **Phase 5:** Post-publish verification + summary

Update each task via `TaskUpdate` to `in_progress` before starting and `completed` after its checkpoint passes. The list above is content for the `subject` field of each `TaskCreate` call — not literal source code.

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
    elif [ "$ASSET_COUNT" -ge 11 ]; then
      RELEASE_STATE="draft-ready"   # 9 binaries + SHA256SUMS + .minisig = 11
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

**Case C — `RELEASE_STATE=draft-ready`** (draft has all 11 expected assets, finalize completed):

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

### 0.5 Delegate the rest of the checklist to `release-quality-runner`

```
Agent(subagent_type: "release-quality-runner")
Prompt: "Run the Phase 0 release-readiness checklist for Erfana at {project_path}
         on branch main. Return structured pass/fail for:
         - running dev servers
         - uncommitted changes (should be none after our gate)
         - node version
         - gh authenticated
         - minisign installed
         Return: { overall: 'pass'|'fail', failures: string[], warnings: string[] }"
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

### 1.2 Collect the user-facing summary from the operator (SKILL-LEVEL)

Subagents cannot call `AskUserQuestion` — it must be called from the skill. Use it now to collect 3–5 bullet points that describe the release in user-facing terms.

Present via `AskUserQuestion`: ask for 3–5 brief bullet points summarising what changed from the end user's perspective. Prompt text example:

> "Summarise v{VERSION} in 3–5 bullets for end users. Examples: 'Releases are now cryptographically signed on macOS, Windows, and Linux' / 'Fixed a bug where terminal scroll lost the last line'. Skip developer-internal changes — the technical section below covers those from commit history."

Persist the operator's reply into a variable (e.g., `$USER_SUMMARY`) as a single markdown string containing the bullets. Do NOT invent bullets if the operator's reply is too short — re-prompt instead.

### 1.3 Delegate composition to the agent

```
Agent(subagent_type: "release-notes-drafter")
Prompt: "Compose two-tier release notes for Erfana v${VERSION}.
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
         Return the composed content + output path."
```

### 1.4 Operator review

Present the generated `docs/release-notes/v${VERSION}.md` and ask whether to accept, edit, or re-draft.

- [ ] Two sections present: user-facing summary and collapsible technical section
- [ ] Operator explicitly approved

### 1.5 Single-commit bundle

Pre-flight check (added per #174 reviewer finding): `git commit -S` fails silently if `user.signingkey` and `gpg.format` aren't configured. Surface a clear error before attempting.

```bash
# Pre-flight: commit signing must be configured. The protected-tag rule
# (Phase I) only enforces signed TAGS, not signed commits — but our
# release commit uses -S, so a missing config is a hard fail here.
if ! git config --get user.signingkey >/dev/null 2>&1 \
   || ! git config --get gpg.format >/dev/null 2>&1; then
  echo "ERROR: commit signing not configured." >&2
  echo "Set user.signingkey and gpg.format (ssh|gpg) before re-running." >&2
  echo "Example (SSH):" >&2
  echo "  git config --global user.signingkey '/Users/<you>/.ssh/id_ed25519.pub'" >&2
  echo "  git config --global gpg.format ssh" >&2
  echo "  git config --global commit.gpgsign true" >&2
  echo "  git config --global tag.gpgsign true" >&2
  exit 1
fi

# One commit bundles: package.json bump (already done pre-skill or done here),
# CHANGELOG append (pre-skill), release notes file.
git add package.json docs/CHANGELOG.md "docs/release-notes/v${VERSION}.md"
git commit -S -m "chore(release): bump version to ${VERSION}"
git push origin main
```

If `main` has new commits on `origin` (raced), re-fetch and confirm with operator before retrying.

### Checkpoint 1.A

- [ ] Commit for `chore(release): bump version to {version}` is on `origin/main`
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

## Phase 3: Watch release workflow

### 3.1 Resolve run ID

```bash
# ^{} dereferences an annotated tag to its commit SHA. Required because
# workflow-run queries are keyed on commit SHA, not tag-object SHA.
TAG_SHA=$(git rev-parse "v${VERSION}^{}")

# Retry loop: the workflow may take up to 60 s to appear.
for i in $(seq 1 12); do
  RUN_ID=$(gh run list --workflow=release.yml \
    --commit="$TAG_SHA" --limit=1 --json databaseId --jq '.[0].databaseId')
  if [ -n "$RUN_ID" ]; then break; fi
  sleep 5
done
if [ -z "$RUN_ID" ]; then
  echo "FAIL: release.yml did not pick up tag ${VERSION} within 60 s"
  exit 1
fi
echo "Release run: https://github.com/qodeca/erfana/actions/runs/${RUN_ID}"
```

### 3.2 Watch with a wall-clock ceiling

```bash
# --exit-status propagates workflow success/failure.
# Wall-clock ceiling 90 min covers: prepare + 3 matrix legs + finalize.
timeout 90m gh run watch "$RUN_ID" --exit-status --interval 10
RC=$?
```

### 3.3 On failure → invoke release-failure-analyzer

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

### Checkpoint 3.A

- [ ] Release run succeeded
- [ ] Draft release `v{version}` exists on GitHub (`gh release view v{version} --json isDraft --jq .isDraft` = `true`)

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

```bash
# Re-download and re-verify minisign on the published release URL.
PUBLISHED=$(gh release view "v${VERSION}" --json url --jq .url)
gh release download "v${VERSION}" --pattern 'SHA256SUMS*' --clobber -D "$WORK/published"
minisign -V -P "$(cat "$WORK/release.pub")" \
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

---

## Reference files

- [`templates/release-notes.md`](templates/release-notes.md) — two-tier release-notes template
- [`guides/troubleshooting.md`](guides/troubleshooting.md) — failure recovery and rollback procedures
- [`docs/build/release.md`](../../../docs/build/release.md) — full operator reference (matrix, secrets, incident response)

---

## Examples

### Example 1: Successful release (v0.9.5)

Operator checks out `main`, bumps `package.json` to `0.9.5`, appends CHANGELOG entry, and invokes the skill.

1. Phase 0: branch ok, tree clean, version valid, CHANGELOG contains `## 0.9.5`.
2. Phase 1: `git cliff` emits technical section; operator supplies 4 bullet points for the summary; single commit pushed.
3. `checks.yml` turns green within ~3 min.
4. Phase 2: signed tag pushed.
5. Phase 3: `release.yml` runs for ~60 min. `gh run watch` returns exit 0.
6. Phase 4: minisign verifies; per-asset sha256 matches signed SHA256SUMS; workflow-output digest matches.
7. Operator approves publish.
8. Phase 5: post-publish verification clean. Release URL surfaced.

### Example 2: Lockfile-drift abort

Operator tags a commit that never produced a green `checks.yml` run.

1. Phase 0–2 run normally.
2. Phase 3: `release.yml` starts. `prepare` job fails the lockfile-drift guard (`No green checks.yml run for <sha>`).
3. `cleanup` deletes the draft and exits red.
4. Skill surfaces the run URL and the `prepare` failure log.
5. Operator re-runs `checks.yml` on the commit; once green, operator re-invokes the skill from Phase 3 (idempotent resume).

### Example 3: Hash mismatch in Phase 4

Malicious or accidental tampering with a draft asset after `finalize`.

1. Phase 0–3 run normally.
2. Phase 4: `diff SHA256SUMS SHA256SUMS.local` surfaces a mismatch for one asset.
3. Skill aborts without prompting for approval. Prints the diff, the asset, and the run URL. Deletes the draft after operator confirmation.
4. Operator escalates to the incident-response flow in `docs/build/release.md`.
