# Phase 0: Pre-flight Checks

**Goal:** Validate environment, issue state, and create feature branch.
**Quality Gate:** QG-0 (Mandatory)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] **Current branch is `develop`** (BLOCKING - no workaround, no retry)
- [ ] Git repository exists in current directory
- [ ] `gh` CLI installed and authenticated
- [ ] Issue number provided by user
- [ ] No other implementation in progress

---

## Execution Steps

### Step 1: Validate source branch

**BLOCKING - This step MUST pass before ANY other step. NO retry allowed.**

```bash
current_branch=$(git branch --show-current)
if [ "$current_branch" != "develop" ]; then
  echo "ERROR: Must be on 'develop' branch to start implementation"
  echo "Current branch: $current_branch"
  exit 1
fi
```

**On Failure:**

| Action | Description |
|--------|-------------|
| STOP immediately | Do not proceed to any other step |
| Inform user | "Implementation can ONLY start from 'develop' branch" |
| Provide fix | `git checkout develop && git pull origin develop` |

**Why no retry?** This is a prerequisite, not a transient failure. User must manually switch branches.

---

### Step 2: Validate issue

```bash
gh issue view <number> --json state,title,labels,body
```

**Check:**
- Issue exists
- State is OPEN (not closed, not draft)
- No `blocked` label

### Step 3: Validate working directory

```bash
git status --porcelain
```

**Check:**
- No uncommitted changes
- No untracked files in src/

### Step 4: Run baseline tests

```bash
npm run test
npm run typecheck
```

**Check:**
- All tests pass
- No type errors

### Step 5: Determine complexity tier

| Labels | Tier |
|--------|------|
| `good first issue`, `documentation`, `typo`, `chore` | Tier 1 (Trivial) |
| `bug`, `enhancement`, `breaking-change`, `security`, unlabeled | Tier 2 (Standard) |

### Step 6: Create feature branch

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
| **Source branch** | **Started from `develop` (BLOCKING)** |
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
| **Wrong source branch** | **STOP (no retry) - switch to develop first** |
| Issue closed | Abort - cannot implement closed issue |
| Issue blocked | Abort - resolve blocker first |
| Tests failing | Fix baseline before starting new work |
| Uncommitted changes | `git stash` or commit first |
| Missing acceptance criteria | Request clarification on issue |

---

## NEXT PHASE

**QG-0 = PASS required to proceed to Phase 1: Business Analysis**

**STOP if QG-0 ≠ PASS. Do not proceed.**
