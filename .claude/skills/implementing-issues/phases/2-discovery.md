# Phase 2: Discovery

**Goal:** Understand the issue and affected codebase areas.

## Steps

### 1. Extract Issue Details

```bash
gh issue view <number> --json title,body,labels,assignees
```

### 2. Identify Acceptance Criteria

- Look for checkboxes in issue body
- If none exist, derive from description
- Confirm understanding with user

### 3. Codebase Analysis

- Search for relevant code areas
- Identify affected components (main/, renderer/, shared/)
- Review existing patterns in target area
- Check for related tests to understand expected behavior

### 4. Estimate Complexity

- Count files likely affected
- Identify cross-cutting concerns
- Check for breaking change potential

## Discovery Checkpoint (Tier 2+)

Present to user:

```markdown
## Issue Understanding

**Issue:** #<number> - <title>
**Type:** Bug / Enhancement / Feature
**Tier:** <1/2/3> based on <reason>

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

**Affected Areas:**
- <file/module 1>
- <file/module 2>

**Questions/Clarifications:**
- <any ambiguities>

Proceed with architecture planning? [Yes/No/Clarify]
```

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review issue details again, re-analyze codebase areas
  2. Retry with refined search patterns or keywords
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Skip/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Acceptance criteria clearly identified
- [ ] All affected code areas mapped
- [ ] Complexity tier determined (1/2/3)
- [ ] Existing patterns in affected areas reviewed
- [ ] Related tests identified
- [ ] User approved discovery checkpoint (Tier 2+)

**STOP if any item unchecked. Do not proceed.**
