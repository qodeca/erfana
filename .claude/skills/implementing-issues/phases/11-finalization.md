# Phase 11: Finalization

**Goal:** Pass quality gates and create commit.

## Quality Gates (Required)

```bash
npm run test        # All tests must pass
npm run typecheck   # No type errors
npm run lint        # No lint errors
```

## If Quality Gates Fail

1. **Tests fail:**
   - Check if failure is related to changes
   - If pre-existing: Document and continue (don't fix unrelated issues)
   - If new: Debug and fix

2. **Typecheck fails:**
   - Fix type errors in changed files
   - Don't modify types in unrelated files

3. **Lint fails:**
   - Auto-fix: `npm run lint -- --fix`
   - Manual fix remaining issues

## Finalization Checkpoint (All Tiers)

```markdown
## Ready to Commit

**Quality Gates:**
- [ ] Tests: PASS (<count> tests)
- [ ] Typecheck: PASS
- [ ] Lint: PASS

**Changes Summary:**
- <count> files changed
- <count> insertions, <count> deletions

**Commit Message:**
<type>: <description>

<body>

Closes #<number>

Create commit? [Yes/Adjust message/Abort]
```

## Commit Format

```bash
git add -A
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body explaining what and why>

Closes #<number>
EOF
)"
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

## Branch Management Checkpoint

After commit succeeds, present options to user:

```markdown
## Branch Management

Commit created successfully. How would you like to proceed?
```

**Options:**
- **Merge to main and delete branch** - Recommended for completed work
- **Merge to main and keep branch** - If follow-up work expected on same branch
- **Push to remote only** - Keep on feature branch, create PR later
- **Local only** - Don't push or merge yet (manual handling)

## Branch Management Actions

Based on user selection:

**Merge to main and delete branch:**
```bash
git checkout main
git merge <branch-name>
git push origin main
git branch -d <branch-name>
git push origin --delete <branch-name>  # if remote branch exists
```

**Merge to main and keep branch:**
```bash
git checkout main
git merge <branch-name>
git push origin main
git checkout <branch-name>
```

**Push to remote only:**
```bash
git push -u origin <branch-name>
```

**Local only:**
No git operations performed. User handles manually.

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review quality gate failures in detail
  2. Fix specific issues (tests, typecheck, or lint)
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] All quality gates passed (tests, typecheck, lint)
- [ ] Commit created successfully with proper conventional commit format
- [ ] Commit message includes "Closes #<number>" reference
- [ ] User selected branch management option
- [ ] Branch management actions completed successfully (if applicable)

**STOP if any item unchecked. Do not proceed.**
