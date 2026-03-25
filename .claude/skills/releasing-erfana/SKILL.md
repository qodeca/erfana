---
name: releasing-erfana
description: Build and release new versions of the Erfana Electron app. Runs quality gates (lint, typecheck, tests, security audit), builds platform packages, generates user-friendly release notes, and creates git tags. Use when asked to "release", "build release", "prepare release", or "new version".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# Releasing Erfana

This skill orchestrates the complete release process for Erfana, an Electron-based markdown IDE. All execution is delegated to agents – the skill manages workflow progression, user interaction, and checkpoints.

## When this skill applies

Activate when user says:
- "release new version"
- "build release"
- "prepare release"
- "release erfana"
- "create release"
- "build for production"

## Agents

| Agent | Purpose | Source | Used in |
|-------|---------|--------|---------|
| `release-quality-runner` | Run lint, typecheck, tests, security audit | shared | Phase 1 |
| `release-build-executor` | Build packages, verify output, smoke test | shared | Phase 2 |
| `release-notes-drafter` | Analyze commits, draft user-focused notes | shared | Phase 3 |

## Quick reference

| Item | Value |
|------|-------|
| Version source | `package.json` → `"version"` field |
| Tag format | `v{major}.{minor}.{patch}` (e.g., `v0.4.5`) |
| Release folder | `release/{version}/` |
| DMG naming | `erfana-{version}.dmg` |
| Release notes | `erfana-{version}-release-notes.md` (in release folder) |
| Expected DMG size | 230–290 MB (per-arch macOS) |

## CRITICAL ENFORCEMENT RULES

**These rules are NON-NEGOTIABLE. Violations are automatic failures.**

1. **NO PHASE SKIPPING** – ALL phases (0–5) MUST execute every time. No exceptions.
2. **NO CHECKPOINT SKIPPING** – Every checkpoint MUST present options to user.
3. **SEQUENTIAL EXECUTION** – Phase N cannot start until Phase N-1 checkpoint passes.
4. **"Already done" is NOT a valid skip reason** – Re-execute phases. Prior state may be stale.
5. **Smoke test crash = STOP** – A crash during any smoke test blocks the release. NEVER dismiss a crash.
6. **User confirms every checkpoint** – Do not auto-approve on behalf of the user.
7. **Delegate, don't execute** – All quality gates, builds, and note drafting go through agents.

---

## Todo list (MANDATORY)

At release start, create a todo list tracking all phases:

```
TaskCreate: "Phase 0: Pre-flight checks" (pending)
TaskCreate: "Phase 1: Quality gates" (pending)
TaskCreate: "Phase 2: Build and smoke test" (pending)
TaskCreate: "Phase 3: Release notes" (pending)
TaskCreate: "Phase 4: Git tag" (pending)
TaskCreate: "Phase 5: Summary" (pending)
```

Update each task to `in_progress` before starting and `completed` after checkpoint passes.

---

## Phase 0: Pre-flight checks

**Input conditions:** None (first phase).

### 0.1 Requirements gathering

Ask user with structured options (AskUserQuestion):

**Version bump type:**

| Option | Description | Recommended |
|--------|-------------|-------------|
| PATCH | Bug fixes only, no new features | ✓ (for bug-fix-only releases) |
| MINOR | New features, backward compatible | |
| MAJOR | Breaking changes, major rewrites | |

**Target platform:**

| Option | Description | Recommended |
|--------|-------------|-------------|
| macOS | Default platform | ✓ |
| Windows | Windows build | |
| Linux | Linux build | |
| All | All platforms | |

### 0.2 Check environment

Run directly (lightweight pre-flight, not worth agent delegation):

```bash
# Check for running dev servers
pgrep -f "electron-vite" || echo "No dev servers running"
# Check git status
git status --porcelain
```

- [ ] No dev servers running (or user confirms kill)
- [ ] No uncommitted changes (or user confirms proceed)

### 0.2.5 Change classification (empty release guard)

```bash
# Get last tag
LAST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
# List commits since last tag with conventional commit prefixes
git log ${LAST_TAG}..HEAD --pretty=format:"%s"
```

Classify commits using conventional commit prefixes:
- **User-facing:** `feat:`, `fix:`, `perf:` – these produce release note content
- **Developer-only:** `chore:`, `docs:`, `refactor:`, `test:`, `ci:`, `build:`, `style:`

**If ALL commits are developer-only:** Present warning via AskUserQuestion:
> "No user-facing changes detected since {last_tag}. All {N} commits are developer-only ({list prefixes}). This would be a maintenance-only release. Continue anyway?"

Options:
- Continue (maintenance release)
- Abort release

This is informational, not blocking – user may have valid reasons for a maintenance release.

### 0.3 Version verification

```bash
# Get current version from package.json
grep '"version"' package.json | head -1
# Get last git tag
git tag --list 'v*' --sort=-v:refname | head -1
```

- [ ] Current version > last tag
- [ ] Version matches user's bump type selection

**If version has NOT been bumped** (equals last tag): STOP. Present the semver guide from 0.1, ask user to bump version in package.json, then re-verify. Do not proceed with a version that matches an existing tag.

### 0.4 Checkpoint: confirm version

**Ask user:** "Ready to release version **{version}**? This will be tagged as `v{version}`."

Options:
- Proceed with {version}
- Need to bump version first (stop and let user update package.json)

**Post-checkpoint validation:** User explicitly confirmed version.

---

## Phase 1: Quality gates

**Input conditions:**
- [ ] Phase 0 checkpoint passed
- [ ] Version confirmed by user

### 1.1 Delegate to release-quality-runner

```
Agent(subagent_type: "release-quality-runner")
Prompt: "Run all quality gates for the Erfana project at {project_path}. Return structured pass/fail results."
```

### 1.2 Process results

Parse agent results. Present summary:

```
Quality gates:
- [ ] Lint: PASSED / FAILED
- [ ] TypeScript: PASSED / FAILED
- [ ] Security: X vulnerabilities (Y critical, Z high)
- [ ] Tests: N tests passed
```

### 1.3 Retry logic

If any gate fails:
- **Attempt 1:** Report failure, ask user to fix
- **Attempt 2:** After user fixes, re-delegate to agent
- **Attempt 3:** If still failing, escalate – ask user whether to override or abort

Max retries: 3 per gate. After 3 failures, STOP and ask user for direction.

### 1.4 Checkpoint: quality summary

Only proceed if lint, typecheck, and tests all pass. Security audit allows user override for non-critical findings.

**Post-checkpoint validation:** All 4 gates have PASS or explicit user override.

---

## Phase 2: Build and smoke test

**Input conditions:**
- [ ] Phase 1 checkpoint passed
- [ ] All quality gates PASS (or user override documented)

### 2.1 Clean current version folder (optional)

Only if rebuilding same version. Ask user first:

```bash
# Only if rebuilding same version
rm -rf release/{version}/
```

**IMPORTANT:** Only clean the specific version folder, NEVER the entire release/ directory.

### 2.2 Delegate to release-build-executor

```
Agent(subagent_type: "release-build-executor")
Prompt: "Build version {version} for {platform}. Project path: {project_path}. App name: Erfana. Release dir: release/{version}. Mac arch: mac-arm64. Expected DMG size: 230-290 MB. Verify build output and run smoke tests."
```

### 2.3 Process results

Parse agent results. Present summary:

```
Build artifacts:
- [ ] DMG: erfana-{version}.dmg ({size} MB)
- [ ] Size check: PASS / WARN / FAIL
- [ ] Code signature: PASS / FAIL
- [ ] Smoke test (app): PASS / FAIL
- [ ] Smoke test (DMG): PASS / FAIL
```

### 2.4 Retry logic

If build fails:
- **Attempt 1:** Report error, ask user to fix source issue
- **Attempt 2:** Re-delegate to agent after user fix
- **Attempt 3:** Escalate – present full error log, ask user for direction

If smoke test fails (crash):
- **NO RETRIES** – A crash blocks the release. Present crash indicators and STOP.

### 2.5 Checkpoint: build success

**Post-checkpoint validation:** Build PASS, codesign PASS, both smoke tests PASS.

---

## Phase 3: Release notes – MANDATORY

**This phase MUST execute even if release notes exist from a prior attempt. Prior notes may be stale.**

**Input conditions:**
- [ ] Phase 2 checkpoint passed
- [ ] Build artifacts verified

### 3.1 Delegate to release-notes-drafter

```
Agent(subagent_type: "release-notes-drafter")
Prompt: "Draft release notes for Erfana version {version}. Last tag: {last_tag}. Template: {skill_path}/templates/release-notes.md. Output: release/{version}/erfana-{version}-release-notes.md"
```

### 3.2 Checkpoint: user reviews release notes

**MANDATORY: This checkpoint requires explicit user approval. Do not skip even if notes exist from a prior release attempt.**

Present the draft and ask:
> "Please review these release notes. They will be saved as `erfana-{version}-release-notes.md` in the release folder."

Options:
- Approve as-is
- Request changes (provide feedback, re-delegate to agent)
- Edit directly

### 3.3 Retry logic

If user requests changes:
- Re-delegate to agent with user feedback (max 3 rounds)
- After 3 rounds, let user edit directly

**Post-checkpoint validation:** User explicitly approved release notes.

---

## Phase 4: Git tag – MANDATORY CHECKPOINT

**This checkpoint MUST be presented even if a tag already exists.**

**Input conditions:**
- [ ] Phase 3 checkpoint passed
- [ ] Release notes approved by user

### 4.1 Checkpoint: confirm tagging

**Ask user:**
> "Create git tag `v{version}` for this release?"

Options:
- Yes, create tag
- No, skip tagging
- Yes, and push to remote

### 4.2 Execute tag (directly – simple command)

```bash
git tag v{version}
# If user requested push:
git push origin v{version}
```

**Post-checkpoint validation:** Tag created (or user chose to skip).

---

## Phase 5: Summary

**Input conditions:**
- [ ] All prior phases completed

### 5.1 Release checklist

Present final summary:

```
Release v{version} complete

Artifacts:
- DMG: release/{version}/erfana-{version}.dmg
- Notes: release/{version}/erfana-{version}-release-notes.md

Quality:
- Lint: PASSED
- TypeScript: PASSED
- Tests: {count} passed
- Security: {summary}

Git:
- Tag: v{version} (created / not created)
- Pushed: yes / no

Next steps:
- Test DMG installation manually
- Create GitHub release (if applicable)
- Distribute to users
```

---

## Anti-patterns

| Don't | Do instead |
|-------|------------|
| Delete entire `release/` folder | Only clean `release/{version}/` |
| Include test counts in release notes | Keep notes user-focused |
| Include commit hashes in notes | Describe changes in plain language |
| Skip quality gates | All gates must pass |
| Auto-push git tags | Always confirm with user first |
| Build without version check | Verify version > last tag |
| Dismiss a crash as "expected" | A crash during smoke test ALWAYS blocks the release |
| Skip a phase because "already done" | Re-execute every phase – prior state may be stale |
| Auto-approve a checkpoint | Always present checkpoint to user for explicit confirmation |
| Run commands directly instead of delegating | Use agents for quality gates, builds, and notes |

---

## Reference files

- `templates/release-notes.md` – Release notes template
- `guides/troubleshooting.md` – Troubleshooting and rollback procedures

---

## Examples

### Example 1: Successful release flow

**User:** "Release new version of erfana"

**Skill does:**

1. **Pre-flight:** Creates todo list. Asks bump type (user picks MINOR) and platform (macOS). Checks git status, compares version 0.5.0 vs tag v0.4.6.
2. **Checkpoint 0.4:** "Ready to release v0.5.0?" → User confirms.
3. **Quality gates:** Delegates to `release-quality-runner`. All pass (lint clean, typecheck clean, 7200 tests pass, no critical vulnerabilities).
4. **Checkpoint 1.4:** Shows quality summary → User confirms.
5. **Build:** Delegates to `release-build-executor`. DMG 245 MB, codesign PASS, both smoke tests PASS.
6. **Checkpoint 2.5:** Shows build artifacts → User confirms.
7. **Release notes:** Delegates to `release-notes-drafter`. Finds 3 features, 2 bug fixes. Drafts user-focused notes.
8. **Checkpoint 3.2:** User reviews notes, requests one edit. Re-delegates with feedback. User approves.
9. **Git tag:** Asks user → creates v0.5.0, pushes to remote.
10. **Summary:** All artifacts, quality results, and next steps.

### Example 2: Quality gate failure and recovery

**User:** "Build release"

**Skill does:**

1. **Pre-flight:** Asks bump type (PATCH), platform (macOS). Version 0.4.7 confirmed.
2. **Quality gates:** Delegates to `release-quality-runner`. Tests fail (2 failures in renderer suite).
3. **Attempt 1:** Reports failures with details. User fixes the tests.
4. **Attempt 2:** Re-delegates to agent. All gates pass.
5. **Checkpoint 1.4:** Shows quality summary → User confirms.
6. **Build through summary:** Proceeds normally.

### Example 3: Smoke test crash blocks release

**User:** "Prepare release"

1. **Pre-flight through quality gates:** All pass normally.
2. **Build:** Delegates to `release-build-executor`. Build succeeds (240 MB). Codesign PASS. App launch smoke test detects `SIGABRT` in stderr.
3. **STOP:** "Smoke test detected a crash (SIGABRT). Release blocked. See `guides/troubleshooting.md` for rollback procedures."
4. Release does NOT proceed. User must fix the crash and restart.
