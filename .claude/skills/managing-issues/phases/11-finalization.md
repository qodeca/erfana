# Phase 11: Finalization

**Goal:** Pass final quality gates, create commit, manage branch.
**Agent:** `summarize-diff`
**Quality Gate:** QG-11 (User-Approval - FINAL GATE)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-10 = PASS (UAT completed)
- [ ] All acceptance criteria verified
- [ ] Documentation updated
- [ ] All previous quality gates passed

---

## Execution Steps

### Step 1: Run Final Quality Gates

```bash
npm run test        # All tests must pass
npm run typecheck   # No type errors
npm run lint        # No lint errors
```

**ALL must pass. No exceptions.**

### Step 2: Generate Commit Summary

Use `summarize-diff` agent to:
1. Analyze all changes
2. Generate commit message
3. Summarize for user review

### Step 3: Create Commit

Format:
```bash
git add -A
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body explaining what and why>

Closes #<number>
EOF
)"
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### Step 4: Branch Management

Present options to user:
1. **Merge to main and delete branch** (Recommended)
2. **Merge to main and keep branch**
3. **Push to remote only**
4. **Local only**

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Quality Gate Results | test, typecheck, lint results |
| Commit | Created commit with proper message |
| Branch State | Merged/pushed per user choice |

---

## OUTPUT CONDITIONS

**ALL must be checked to complete implementation.**

- [ ] All tests pass (`npm run test`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Commit created with proper conventional commit format
- [ ] Commit message includes `Closes #<number>`
- [ ] Branch management completed per user choice

---

## QUALITY GATE: QG-11

**Gate Type:** User-Approval (ALL tiers - FINAL GATE)
**Gate ID:** QG-11

### Pass Criteria

| Criterion | Required |
|-----------|----------|
| Tests pass | `npm run test` exits 0 |
| Types pass | `npm run typecheck` exits 0 |
| Lint pass | `npm run lint` exits 0 |
| Commit approved | User approved message |
| Branch managed | User selected option completed |

### Final Checkpoint

Present to user:

```markdown
## Ready to Commit

**Issue:** #<number> - <title>

### Quality Gates
| Gate | Status |
|------|--------|
| Tests | ✅ PASS (<count> tests) |
| Typecheck | ✅ PASS |
| Lint | ✅ PASS |

### Changes Summary
- <count> files changed
- <insertions> insertions, <deletions> deletions

### Commit Message
```
<type>(<scope>): <description>

<body>

Closes #<number>
```

**Create commit?** [Approve / Adjust Message / Abort]
```

### Branch Management Checkpoint

After commit approved:

```markdown
## Branch Management

Commit created successfully.

**Current branch:** <branch-name>

**Options:**
- **Merge and delete** - Merge to main, delete feature branch (recommended)
- **Merge and keep** - Merge to main, keep branch for follow-up
- **Push only** - Push to remote, create PR later
- **Local only** - No push or merge (manual handling)

**Select option:** [Merge+Delete / Merge+Keep / Push / Local]
```

### Result

**QG-11 Result:** [PASS | FAIL]

### On FAIL

If quality gates fail:
1. **Tests fail:** Fix failing tests
2. **Typecheck fails:** Fix type errors
3. **Lint fails:** Run `npm run lint -- --fix`, fix remaining

Re-run quality gates. Max 3 retries, then ESCALATE.

### Branch Management Actions

**Merge and delete:**
```bash
git checkout main
git merge <branch>
git push origin main
git branch -d <branch>
git push origin --delete <branch>
```

**Merge and keep:**
```bash
git checkout main
git merge <branch>
git push origin main
git checkout <branch>
```

**Push only:**
```bash
git push -u origin <branch>
```

**Local only:**
No actions performed.

---

## IMPLEMENTATION COMPLETE

**QG-11 = PASS marks successful implementation.**

### Summary

All phases completed:
- [x] Phase 0: Pre-flight
- [x] Phase 1: Business Analysis
- [x] Phase 2: Discovery
- [x] Phase 3: Architecture
- [x] Phase 4: Implementation
- [x] Phase 5: Architectural Review
- [x] Phase 6: Security
- [x] Phase 7: Quality Review
- [x] Phase 8: Verification
- [x] Phase 9: Documentation
- [x] Phase 10: UAT
- [x] Phase 11: Finalization

**Issue #<number> implementation complete.**
