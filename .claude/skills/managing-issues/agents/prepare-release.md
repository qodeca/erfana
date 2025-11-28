# Agent: prepare-release

Prepare production releases with user-friendly notes and version management.

---

## Purpose

Generate release notes, update version numbers, create git tags, and prepare builds.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| version | string | Yes | Semantic version (X.Y.Z) |
| previous_version | string | Yes | Previous version for comparison |
| release_type | string | No | patch/minor/major hint |

### Input Validation

BEFORE execution, verify:
- [ ] version matches semver pattern (X.Y.Z)
- [ ] previous_version matches semver pattern
- [ ] version > previous_version

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Verify Clean State

```
Bash(command="git status --porcelain")
```

Verify:
- Working directory is clean
- On main branch

### Step 2: Analyze Commits

```
Bash(command="git log [previous_version]..HEAD --oneline")
Bash(command="git log [previous_version]..HEAD --pretty=format:'%h %s' --no-merges")
```

Categorize commits:
- Features (feat:)
- Bug fixes (fix:)
- Documentation (docs:)
- Refactoring (refactor:)
- Other

### Step 3: Run Quality Gates

```
Bash(command="npm run lint")
Bash(command="npm run typecheck")
Bash(command="npm run test")
```

ALL must pass to continue.

### Step 4: Generate Release Notes

Create user-friendly notes:

```markdown
# Erfana v[version]

## What's New

### [Feature Category]
- **Feature Name**: Brief user-facing description

### Bug Fixes
- Fixed [issue description]

### Improvements
- [Improvement description]
```

### Step 5: Update Version

Read package.json:

```
Read(file_path="package.json")
```

Update version:

```
Edit(file_path="package.json", old_string="\"version\": \"[previous_version]\"", new_string="\"version\": \"[version]\"")
```

### Step 6: Update CLAUDE.md

```
Read(file_path="CLAUDE.md")
Edit(file_path="CLAUDE.md", old_string="**Version**: [previous_version]", new_string="**Version**: [version]")
```

### Step 7: Build Project

```
Bash(command="npm run build:mac")
```

Verify build completes successfully.

### Step 8: Create Git Tag (Optional)

```
Bash(command="git tag v[version]")
```

Note: Do NOT push tag until user approves.

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| release_notes | string | User-friendly release notes |
| version_updated | boolean | Whether package.json was updated |
| changelog_entry | string | Entry for CHANGELOG.md |
| tag_created | boolean | Whether git tag was created |
| build_status | string | Result of build process |
| next_steps | array | Manual steps required |

---

## Release Notes Format

```markdown
# Erfana v[version]

## What's New

### [Feature Category]
- **Feature Name**: Brief user-facing description
- **Another Feature**: Description

### Bug Fixes
- Fixed [issue description]

### Improvements
- [Improvement description]

## Breaking Changes (if any)
- [Breaking change with migration guide]

## Known Issues (if any)
- [Known issue with workaround]
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All tests pass (`npm run test`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build:mac`)
- [ ] Version in package.json matches input version
- [ ] Git tag created (or ready to create)

### On Quality Gate Failure

If any gate fails:
1. Document failure
2. Do NOT create tag
3. Return with failure status and remediation steps

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 500 tokens |
| Maximum | 800 tokens |

### Efficiency Notes

- Group related changes in notes
- Focus on user-facing impact
- Skip internal refactors in notes

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| Tests fail | Abort release, report failures |
| Build fails | Abort release, report errors |
| Tag already exists | Suggest version bump |
| Uncommitted changes | Abort, require clean state |

---

## Pre-Release Checklist

- [ ] Working directory clean
- [ ] On main branch
- [ ] All tests passing
- [ ] Typecheck clean
- [ ] Lint clean
- [ ] CLAUDE.md updated
- [ ] No security vulnerabilities

---

## Example Invocation

**Input:**
```json
{
  "version": "0.4.2",
  "previous_version": "0.4.1",
  "release_type": "minor"
}
```

**Output:**
```json
{
  "release_notes": "# Erfana v0.4.2\n\n## What's New\n\n### Editor Improvements\n- **Chrome-style Dynamic Tabs**: Tabs now resize dynamically, show dirty indicator, and support context menu with Close, Close Others, and Close All actions.\n\n### Bug Fixes\n- Fixed terminal scroll jumping during streaming output\n\n## Full Changelog\nSee CLAUDE.md for detailed technical changes.",
  "version_updated": true,
  "changelog_entry": "## [0.4.2] - 2025-11-22\n\n### Added\n- Chrome-style dynamic tabs with dirty indicator\n- Tab context menu (Close, Close Others, Close All)\n\n### Fixed\n- Terminal scroll position during Claude CLI streaming",
  "tag_created": true,
  "build_status": "success",
  "next_steps": [
    "Push tag: git push origin v0.4.2",
    "Create GitHub release from tag",
    "Upload build artifacts"
  ]
}
```
