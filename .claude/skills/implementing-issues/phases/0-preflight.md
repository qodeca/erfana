# Phase 0: Pre-flight Checks

Before starting, verify the environment and project state.

## Pre-flight Commands

```bash
# Issue validation
gh issue view <number> --json state,title,labels,body

# Environment checks
git status --porcelain           # No uncommitted changes
npm test                          # Tests pass
npm run typecheck                 # Types valid
```

## Pre-flight Checklist

- [ ] Issue exists and is OPEN
- [ ] Issue has acceptance criteria (or request clarification)
- [ ] No `blocked` label on issue
- [ ] Tests pass on current branch
- [ ] No uncommitted changes in working directory
- [ ] Check for duplicate issues: `gh issue list --search "<keywords>"`
- [ ] **Feature branch created** (see Branch Strategy below)

## Branch Strategy (Required - All Tiers)

Create a feature branch before starting any implementation:

```bash
git checkout -b fix/<number>-<short-description>
# Example: git checkout -b fix/11-chrome-style-tabs
```

**Branch naming convention:**
- `fix/<number>-<description>` for bug fixes and general issues
- `feat/<number>-<description>` for new features
- `docs/<number>-<description>` for documentation-only changes

Branch creation is **mandatory** - never work directly on main. This ensures:
- Clean rollback if implementation fails
- Isolated changes for review
- Consistent workflow across all tiers

## Abort Pre-flight If

- Issue is CLOSED or DRAFT state
- `blocked` label is present
- Tests failing on main branch (fix baseline first)
- Uncommitted changes exist (stash or commit first)

**DO NOT proceed without resolving blockers.**

## If Pre-flight Fails

- Uncommitted changes: `git stash` or commit first
- Tests failing: Fix baseline before starting new work
- Issue blocked: Wait or work on blocker first
- Missing acceptance criteria: Comment on issue requesting details

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review validation output, address specific blockers
  2. Retry after fixing issues
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Issue is OPEN and not blocked
- [ ] Working directory is clean (no uncommitted changes)
- [ ] All tests pass (npm test)
- [ ] Typecheck passes (npm run typecheck)
- [ ] Feature branch created and checked out
- [ ] Acceptance criteria identified or clarification requested

**STOP if any item unchecked. Do not proceed.**
