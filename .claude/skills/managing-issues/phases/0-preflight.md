# Phase 0: Pre-flight Checks

**Goal:** Validate environment, issue state, and create feature branch.
**Quality Gate:** QG-0 (Mandatory)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] Git repository exists in current directory
- [ ] `gh` CLI installed and authenticated
- [ ] Issue number provided by user
- [ ] No other implementation in progress

---

## Execution Steps

### Step 1: Validate Issue

```bash
gh issue view <number> --json state,title,labels,body
```

**Check:**
- Issue exists
- State is OPEN (not closed, not draft)
- No `blocked` label

### Step 2: Validate Working Directory

```bash
git status --porcelain
```

**Check:**
- No uncommitted changes
- No untracked files in src/

### Step 3: Run Baseline Tests

```bash
npm run test
npm run typecheck
```

**Check:**
- All tests pass
- No type errors

### Step 4: Determine Complexity Tier

| Labels | Tier |
|--------|------|
| `good first issue`, `documentation`, `typo`, `chore` | Tier 1 (Trivial) |
| `bug`, `enhancement`, `breaking-change`, `security`, unlabeled | Tier 2 (Standard) |

### Step 5: Create Feature Branch

```bash
git checkout -b <type>/<number>-<short-description>
```

**Branch naming:**
- `fix/<number>-<description>` - Bug fixes
- `feat/<number>-<description>` - New features
- `docs/<number>-<description>` - Documentation only

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Feature Branch | Named branch checked out |
| Issue Metadata | Title, labels, body, acceptance criteria |
| Tier Classification | Tier 1 or Tier 2 |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 1.**

- [ ] Issue is OPEN and not blocked
- [ ] Issue has acceptance criteria (or clarification requested)
- [ ] Working directory is clean
- [ ] All tests pass (npm test)
- [ ] Typecheck passes (npm run typecheck)
- [ ] Feature branch created and checked out
- [ ] Tier classification determined

---

## QUALITY GATE: QG-0

**Gate Type:** Mandatory
**Gate ID:** QG-0

### Pass Criteria

| Criterion | Check |
|-----------|-------|
| Issue valid | OPEN state, no `blocked` label |
| Clean state | No uncommitted changes |
| Tests pass | `npm test` exits 0 |
| Types valid | `npm run typecheck` exits 0 |
| Branch created | Feature branch checked out |

### Result

**QG-0 Result:** [PASS | FAIL]

### On FAIL

1. Identify specific failure reason
2. Present to user with fix suggestion
3. Retry after user addresses issue
4. Max 3 retries, then ESCALATE

### Escalation Options

| Failure | Resolution |
|---------|------------|
| Issue closed | Abort - cannot implement closed issue |
| Issue blocked | Abort - resolve blocker first |
| Tests failing | Fix baseline before starting new work |
| Uncommitted changes | `git stash` or commit first |
| Missing acceptance criteria | Request clarification on issue |

---

## NEXT PHASE

**QG-0 = PASS required to proceed to Phase 1: Business Analysis**

**STOP if QG-0 ≠ PASS. Do not proceed.**
