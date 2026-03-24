---
name: releasing-erfana
description: Build and release new versions of the Erfana Electron app. Runs quality gates (lint, typecheck, tests, security audit), builds platform packages, generates user-friendly release notes, and creates git tags. Use when asked to "release", "build release", "prepare release", or "new version".
---

# Releasing Erfana

This skill guides you through the complete release process for Erfana, an Electron-based markdown IDE.

## When This Skill Applies

Activate when user says:
- "release new version"
- "build release"
- "prepare release"
- "release erfana"
- "create release"
- "build for production"

## Quick Reference

| Item | Value |
|------|-------|
| Version source | `package.json` → `"version"` field |
| Tag format | `v{major}.{minor}.{patch}` (e.g., `v0.4.5`) |
| Release folder | `release/{version}/` |
| DMG naming | `erfana-{version}.dmg` |
| Release notes | `erfana-{version}-release-notes.md` (in release folder) |
| Expected DMG size | 230-290 MB (per-arch macOS) |

## Important Rules

1. **NEVER delete previous releases** - Only clean the current version folder if needed
2. **Release notes are USER-focused** - No developer content, skills, or test info
3. **Release notes filename** - `erfana-{version}-release-notes.md`
4. **All quality gates must pass** - No skipping lint, typecheck, or tests
5. **Human approves release notes** - Draft is generated, user reviews/edits

---

## Phase 0: Pre-flight Checks

### 0.1 Check Environment

```bash
# Check for running dev servers
pgrep -f "electron-vite" || echo "No dev servers running"

# Check git status
git status --porcelain
```

**If dev servers running:** Ask user if they should be killed.

**If uncommitted changes:** Warn user and ask how to proceed.

### 0.2 Version Verification

```bash
# Get current version from package.json
grep '"version"' package.json | head -1

# Get last git tag
git tag --list 'v*' --sort=-v:refname | head -1

# Compare: version should be HIGHER than last tag
```

**Present to user:**
- Current version: `{version}` (from package.json)
- Last release tag: `{tag}`
- Status: Version bumped / NOT BUMPED (needs attention)

### Semantic Versioning Guide

If version needs bumping, help user choose:

| Type | When to Use | Example |
|------|-------------|---------|
| **PATCH** | Bug fixes only, no new features | 0.4.5 → 0.4.6 |
| **MINOR** | New features, backward compatible | 0.4.5 → 0.5.0 |
| **MAJOR** | Breaking changes, major rewrites | 0.4.5 → 1.0.0 |

**Ask user:** "Based on the commits, this looks like a [PATCH/MINOR/MAJOR] release. Confirm?"

### 0.3 Checkpoint: Confirm Version

Ask user:
> "Ready to release version **{version}**? This will be tagged as `v{version}`."

Options:
- Proceed with {version}
- Need to bump version first (stop and let user update package.json)

---

## Phase 1: Quality Gates

Run all quality checks. **All must pass to proceed.**

### 1.1 Linting

```bash
npm run lint
```

**Pass:** No output (clean)
**Fail:** Show errors, stop release

### 1.2 TypeScript

```bash
npm run typecheck
```

**Pass:** Both node and web configs complete without errors
**Fail:** Show errors, stop release

### 1.3 Security Audit

```bash
npm audit
```

**Evaluate results (strict policy):**

| Severity | Production Deps | Dev Deps Only |
|----------|-----------------|---------------|
| Critical | **STOP** - Must fix before release | Warn, require explicit override |
| High | **STOP** - Must fix or get explicit override | Note but continue |
| Moderate | Note but continue | Continue |
| Low | Continue | Continue |

**If blocked:** Show affected packages and suggest `npm audit fix` or manual resolution.

### 1.4 Tests

```bash
npm run test
```

**Pass:** All tests pass (expect ~7000+ tests)
**Fail:** Show failures, stop release

### 1.5 Checkpoint: Quality Summary

Present results:
```
Quality Gates:
- Lint: PASSED / FAILED
- TypeScript: PASSED / FAILED
- Security: X vulnerabilities (Y high, Z critical)
- Tests: N tests passed
```

Only proceed if lint, typecheck, and tests all pass.

---

## Phase 2: Build

### 2.1 Platform Selection

Ask user which platform(s) to build:
- macOS (default) → `npm run build:mac`
- Windows → `npm run build:win`
- Linux → `npm run build:linux`
- All platforms

### 2.2 Clean Current Version Folder (Optional)

**IMPORTANT:** Only clean the specific version folder, NOT the entire release/ directory.

```bash
# Only if rebuilding same version
rm -rf release/{version}/
```

### 2.3 Build Execution

```bash
# macOS (most common)
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

**Build includes:** typecheck + electron-vite build + electron-builder

### 2.4 Verify Build Output

```bash
# List release artifacts
ls -lh release/{version}/

# Check DMG size (macOS)
ls -lh release/{version}/erfana-{version}.dmg
```

```bash
# Verify code signing consistency (MANDATORY)
codesign --verify --deep --strict release/{version}/mac-arm64/Erfana.app
```

**Size verification (macOS universal):**
- Expected: 230-290 MB
- Warning if: <200 MB or >300 MB
- Critical if: >500 MB (likely includes excluded files)

### 2.5 Smoke Test (macOS) – MANDATORY

**This gate is NON-OVERRIDABLE. A crash blocks the release. No exceptions.**

#### 2.5.1 Code signature verification

```bash
codesign --verify --deep --strict release/{version}/mac-arm64/Erfana.app
```

**Pass:** No output (clean verification)
**Fail:** STOP – code signing is broken, do not proceed

#### 2.5.2 Launch from built app

```bash
# Launch the built app (NOT from dev environment) and capture errors
release/{version}/mac-arm64/Erfana.app/Contents/MacOS/Erfana 2>/tmp/smoke-test-stderr.log &
APP_PID=$!
sleep 5
kill $APP_PID 2>/dev/null
wait $APP_PID 2>/dev/null
cat /tmp/smoke-test-stderr.log
rm -f /tmp/smoke-test-stderr.log
```

**Check stderr for:**
- `dyld` errors (library loading failures)
- `FATAL` messages (GPU process crashes)
- `SIGABRT` or `SIGKILL` (process crashes)

**Pass:** App launches, no crash indicators in stderr
**Fail:** STOP – investigate and fix before proceeding. **NEVER dismiss a crash as "expected behavior".**

#### 2.5.3 Launch from mounted DMG

```bash
hdiutil attach release/{version}/erfana-{version}-arm64.dmg -quiet
/Volumes/Erfana*/Erfana.app/Contents/MacOS/Erfana 2>/tmp/smoke-test-dmg-stderr.log &
APP_PID=$!
sleep 5
kill $APP_PID 2>/dev/null
wait $APP_PID 2>/dev/null
cat /tmp/smoke-test-dmg-stderr.log
rm -f /tmp/smoke-test-dmg-stderr.log
hdiutil detach /Volumes/Erfana* -quiet
```

**Same pass/fail criteria as 2.5.2.**

### 2.6 Checkpoint: Build Success

Present:
```
Build Artifacts:
- DMG: erfana-{version}.dmg ({size} MB)
- ZIP: Erfana-{version}-universal-mac.zip ({size} MB)
- Location: release/{version}/
- Smoke Test: PASSED / FAILED
```

---

## Phase 3: Release Notes

### 3.1 Analyze Changes

```bash
# Get commits since last tag
git log {last-tag}..HEAD --oneline

# Get detailed changes
git log {last-tag}..HEAD --pretty=format:"%h %s"
```

### 3.2 Draft Release Notes

Using the template in `templates/release-notes.md`, create a draft with:

**INCLUDE (user-focused):**
- New features users can use
- Bug fixes that affected users
- UI/UX improvements
- Performance improvements

**EXCLUDE (developer-focused):**
- Test coverage changes
- Refactoring without user impact
- Skill/agent updates
- Development tooling changes
- Commit hashes
- Issue numbers (unless user-facing bug)

### 3.3 Checkpoint: User Reviews Release Notes

Present the draft and ask:
> "Please review these release notes. They will be saved as `erfana-{version}-release-notes.md` in the release folder."

User can:
- Approve as-is
- Request changes
- Edit directly

### 3.4 Save Release Notes

```bash
# Save to release folder
write release/{version}/erfana-{version}-release-notes.md
```

---

## Phase 4: Git Tag (Optional)

### 4.1 Checkpoint: Confirm Tagging

Ask user:
> "Create git tag `v{version}` for this release?"

Options:
- Yes, create tag
- No, skip tagging
- Yes, and push to remote

### 4.2 Create Tag

```bash
git tag v{version}

# If user requested push:
git push origin v{version}
```

---

## Phase 5: Summary

### 5.1 Release Checklist

Present final summary:

```
Release v{version} Complete

Artifacts:
- DMG: release/{version}/erfana-{version}.dmg
- ZIP: release/{version}/Erfana-{version}-universal-mac.zip
- Notes: release/{version}/erfana-{version}-release-notes.md

Quality:
- Lint: PASSED
- TypeScript: PASSED
- Tests: {count} passed
- Security: {summary}

Git:
- Tag: v{version} (created / not created)
- Pushed: yes / no

Next Steps:
- Test DMG installation manually
- Create GitHub Release (if applicable)
- Distribute to users
```

---

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Delete entire `release/` folder | Only clean `release/{version}/` |
| Include test counts in release notes | Keep notes user-focused |
| Include commit hashes in notes | Describe changes in plain language |
| Skip quality gates | All gates must pass |
| Auto-push git tags | Always confirm with user first |
| Build without version check | Verify version > last tag |
| Dismiss a crash as "expected" | A crash during smoke test ALWAYS blocks the release |

---

## Troubleshooting

### Build Size Too Large (>300 MB)

Check electron-builder.yml excludes:
```yaml
files:
  - "!release/**"
  - "!coverage/**"
  - "!tests/**"
```

### Tests Failing

```bash
# Run specific test suite for debugging
npm run test:renderer
npm run test:main
npm run test:preload
```

### TypeScript Errors

```bash
# Check specific config
npm run typecheck:node
npm run typecheck:web
```

---

## Rollback Procedures

### If Build Fails Mid-Process

1. Check error messages in terminal
2. Fix the issue (usually in source code)
3. Clean the failed build: `rm -rf release/{version}/`
4. Restart from Phase 1 (Quality Gates)

### If Critical Bug Found Post-Release

1. **Do NOT delete the release folder** (keep for reference)
2. Create hotfix branch: `git checkout -b hotfix/{version}`
3. Fix the bug
4. Bump patch version in package.json
5. Run full release process for new version
6. If git tag was pushed:
   ```bash
   # Delete remote tag (use with caution)
   git push --delete origin v{version}
   # Delete local tag
   git tag -d v{version}
   ```

### If GitHub Release Was Created

1. Go to GitHub Releases page
2. Edit the release and mark as "Pre-release" or delete draft
3. Add note explaining the issue
4. Create new release with fixed version

### Recovery Checklist

- [ ] Identify what went wrong
- [ ] Document the issue for future reference
- [ ] Clean up any partial artifacts
- [ ] Communicate with users if release was distributed
- [ ] Create new release with fix

---

## Example: Full Release Flow

**User:** "Release new version of erfana"

**Skill does:**

1. **Pre-flight:** Checks git status, compares version 0.4.6 vs tag v0.4.5
2. **Confirms:** "Ready to release v0.4.6?"
3. **Quality gates:** Runs lint, typecheck, audit, tests - all pass
4. **Asks platform:** User selects macOS
5. **Builds:** Creates DMG (235 MB) and ZIP
6. **Analyzes commits:** Finds 3 features, 2 bug fixes
7. **Drafts notes:** User-friendly release notes
8. **User reviews:** Approves with minor edit
9. **Saves:** `release/0.4.6/erfana-0.4.6-release-notes.md`
10. **Asks about tag:** User says yes, create v0.4.6
11. **Summary:** Shows all artifacts and next steps
