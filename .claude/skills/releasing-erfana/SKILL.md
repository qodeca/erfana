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
| `release-quality-runner` | Enforce Phase 0 local pre-flight checklist | shared (project override) | Phase 0 |
| `release-notes-drafter` | Emit two-tier release-notes markdown via `git cliff` + operator summary | shared (project override) | Phase 1 |

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
| Provenance attestations | One per binary, stored in GitHub's attestations store (NOT as release assets); retrieved via `gh attestation verify` |
| Minisign release pubkey | `docs/security.md` § Release signing |

## Critical enforcement rules (NON-NEGOTIABLE)

1. **Main only.** Phase 0 aborts if `git branch --show-current` is not `main`.
2. **Strict semver.** Phase 0 rejects anything other than `v[0-9]+.[0-9]+.[0-9]+`.
3. **Signed tags only.** Protected-tag rule on the remote enforces this; skill surfaces actionable errors if tag push is rejected.
4. **Verify before publish.** Phase 4 must complete minisign + per-file sha256 + per-file attestation verification before the operator approval prompt is shown.
5. **No auto-publish.** Marking the draft as `--latest` requires explicit operator approval after verification is green.
6. **No bypass.** A verification failure in Phase 4 aborts — do not prompt for approval, do not suggest manual overrides. The release is burned; bump the patch.
7. **Delegate wherever possible.** The quality checklist (Phase 0) and release notes drafting (Phase 1) go through agents.
8. **Idempotency with honesty.** If a tag is already pushed, Phase 0 offers resume-to-Phase-3 (non-destructive) or delete-and-retry (destructive, explicit operator confirmation).

---

## Todo list (MANDATORY)

At release start, create a todo list tracking all phases:

```
TaskCreate: "Phase 0: Pre-flight (main-branch + semver + CHANGELOG)"
TaskCreate: "Phase 1: Release notes (two-tier)"
TaskCreate: "Phase 2: Signed tag + push"
TaskCreate: "Phase 3: Watch release workflow"
TaskCreate: "Phase 4: Verify + publish checkpoint"
TaskCreate: "Phase 5: Post-publish verification + summary"
```

Update each task to `in_progress` before starting and `completed` after its checkpoint passes.

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
if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then
  # Local tag exists
  if git ls-remote --exit-code --tags origin "refs/tags/v${VERSION}" >/dev/null; then
    echo "Tag v$VERSION is already on origin"
  fi
fi
```

If a tag already exists locally or on `origin`:

Present options via `AskUserQuestion`:

| Option | Meaning | Risk |
|--------|---------|------|
| Resume at Phase 3 | Assume tag is valid; watch CI and verify. | Low |
| Delete remote tag and restart | `git push --delete origin v${VERSION}` and start again from Phase 1. | **DESTRUCTIVE** — will void any in-flight signed artifact. Require explicit confirmation. |
| Abort | Exit the skill. | None |

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

```bash
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

if [ "$RC" -ne 0 ]; then
  gh run view "$RUN_ID" --log-failed | head -n 200
  echo "Release run failed. URL: https://github.com/qodeca/erfana/actions/runs/${RUN_ID}"
  exit 1
fi
```

### Checkpoint 3.A

- [ ] Release run succeeded
- [ ] Draft release `v{version}` exists on GitHub (`gh release view v{version} --json isDraft --jq .isDraft` = `true`)

---

## Phase 4: Verify + publish checkpoint (CRITICAL)

### 4.1 Fetch draft state

```bash
gh release view "v${VERSION}" --json isDraft,assets \
  | tee /tmp/release-meta.json
DRAFT=$(jq -r '.isDraft' /tmp/release-meta.json)
if [ "$DRAFT" != "true" ]; then
  echo "FAIL: Release is not a draft — expected a draft produced by release.yml"
  exit 1
fi
```

### 4.2 Download SHA256SUMS + every asset

```bash
WORK=$(mktemp -d)
cd "$WORK"
gh release download "v${VERSION}" --pattern '*' --clobber
ls -la
```

### 4.3 Verify minisign signature

The dedicated release minisign public key is published in [docs/security.md § Release signing](../../../docs/security.md) and mirrored in `README.md`. Load it, then:

```bash
PUBKEY_PATH="$WORK/release.pub"
# Write the pubkey from docs/security.md verbatim (skill extracts the
# marked block by fencing).
minisign -V -P "$(cat "$PUBKEY_PATH")" -m SHA256SUMS -x SHA256SUMS.minisig
```

- [ ] `minisign -V` exits 0

### 4.4 Recompute per-asset hashes locally

```bash
ACTUAL="$WORK/SHA256SUMS.local"
# Hash every asset except the sums and its signature themselves.
(cd "$WORK" && for f in *; do
  case "$f" in SHA256SUMS|SHA256SUMS.minisig|SHA256SUMS.local) continue ;; esac
  sha256sum "$f"
done) | sort > "$ACTUAL"

# Compare against the sum list we just verified.
diff <(sort SHA256SUMS) "$ACTUAL" || {
  echo "FAIL: Local hashes differ from signed SHA256SUMS"
  exit 1
}
```

### 4.5 Compare against the `finalize` job's recorded SHA256SUMS

This catches tampering between `finalize` completion and the moment the operator downloads the draft asset. `finalize` publishes the exact bytes of `SHA256SUMS` it signed as a workflow artifact named `sha256sums-digest` (30-day retention). The skill downloads the artifact and byte-compares against the asset on the release.

```bash
# Download finalize's recorded SHA256SUMS as a workflow artifact.
ART_DIR="$WORK/ci-digest"
gh run download "$RUN_ID" --name sha256sums-digest --dir "$ART_DIR"

# Byte-for-byte comparison. diff exits non-zero on any difference and
# prints the delta for forensics.
if ! diff -q "$WORK/SHA256SUMS" "$ART_DIR/SHA256SUMS"; then
  echo "FAIL: Draft SHA256SUMS differs from CI-recorded SHA256SUMS"
  diff "$WORK/SHA256SUMS" "$ART_DIR/SHA256SUMS" || true
  exit 1
fi
```

Why this gate matters: the minisign signature at 4.3 proves the *original* SHA256SUMS was signed by the release key. But after `finalize` publishes, anyone with write access to the repo could use `gh release upload --clobber` to replace `SHA256SUMS` on the draft (and provide a forged minisign replacement if they also held the key). This gate catches that scenario — the workflow artifact is write-once from the run and cannot be substituted without re-running the workflow.

*If any verification step in 4.3–4.5 fails: abort. Do not prompt for approval.*

### 4.6 Verify per-asset attestations

```bash
for f in $(ls "$WORK" | grep -v -E '^SHA256SUMS(\.minisig)?$|^release\.pub$|\.local$'); do
  gh attestation verify "$WORK/$f" --repo "${GITHUB_REPOSITORY}"
done
```

- [ ] Every asset verifies

### 4.7 Operator approval — MANDATORY

Only now may the skill prompt the operator. Present:
- Number of assets
- Expected set (9 binaries + SHA256SUMS + SHA256SUMS.minisig + per-binary `.intoto.jsonl`)
- Verification summary (all green)
- Release URL

Ask via `AskUserQuestion`:

> "All cryptographic verifications passed for v{version}. Publish the release and mark it as latest?"

| Option | Action |
|--------|--------|
| Publish + mark latest | `gh release edit "v${VERSION}" --draft=false --latest` |
| Leave as draft | Skip final edit; instruct operator to publish manually after additional review |
| Abort and delete | `gh release delete "v${VERSION}" --yes --cleanup-tag=false` and exit |

### Checkpoint 4.A

- [ ] Operator explicitly chose Publish or Leave-as-draft
- [ ] Release visibility matches operator's choice

---

## Phase 5: Post-publish verification + summary

### 5.1 Re-verify the now-public release

```bash
# Attestation verify on the published (non-draft) release URL.
PUBLISHED=$(gh release view "v${VERSION}" --json url --jq .url)
for f in $(gh release view "v${VERSION}" --json assets --jq '.assets[].name'); do
  case "$f" in SHA256SUMS|SHA256SUMS.minisig) continue ;; esac
  gh release download "v${VERSION}" --pattern "$f" --clobber -D "$WORK"
  gh attestation verify "$WORK/$f" --repo "${GITHUB_REPOSITORY}"
done
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
6. Phase 4: minisign verifies; per-asset sha256 matches signed SHA256SUMS; workflow-output digest matches; per-asset attestations all verify.
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
