# Phase 2: Discovery

**Goal:** Understand affected codebase areas and existing patterns.
**Agent:** `explore-codebase`
**Quality Gate:** QG-2 (Checkpoint for T2, Automated for T1)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-1 = PASS (Business Analysis completed)
- [ ] Research summary available
- [ ] Requirements document available
- [ ] Acceptance criteria validated

---

## Execution Steps

### Step 1: Extract Issue Details

Review issue metadata:
- Title and description
- Acceptance criteria
- Labels and priority

### Step 2: Identify Affected Areas

Using Glob and Grep, search for:
- Files related to feature/bug
- Components that will be modified
- Shared utilities that might be affected

```
Search patterns:
- Feature keywords in filenames
- Related imports and dependencies
- Test files for affected components
```

### Step 3: Review Existing Patterns

Read affected files to understand:
- Code style and conventions
- Existing patterns (hooks, utilities)
- Test patterns used
- Error handling approaches

### Step 4: Map Dependencies

Identify:
- Direct dependencies of affected files
- Shared state/stores
- IPC channels (if main/renderer)
- External library usage

### Step 5: Estimate Complexity

| Factor | Low | Medium | High |
|--------|-----|--------|------|
| Files affected | 1-3 | 4-8 | 9+ |
| Cross-cutting | None | Some | Major |
| Breaking changes | No | Possible | Likely |
| Test coverage | Good | Partial | Missing |

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Affected Files List | All files that will be modified/created |
| Dependency Map | How affected files relate to each other |
| Pattern Inventory | Existing patterns to follow |
| Complexity Assessment | Final tier confirmation |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 3.**

- [ ] Acceptance criteria clearly identified
- [ ] All affected code areas mapped
- [ ] Dependencies between affected files documented
- [ ] Existing patterns in affected areas reviewed
- [ ] Related test files identified
- [ ] Complexity tier confirmed (may upgrade from T1 to T2)

---

## QUALITY GATE: QG-2

**Gate Type:** Checkpoint (T2) | Automated (T1)
**Gate ID:** QG-2

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| Files identified | 1-3 files | All affected files |
| Patterns reviewed | Basic | Comprehensive |
| Dependencies mapped | Direct only | Full dependency tree |
| User checkpoint | Not required | Required |

### Tier 2 Checkpoint

Present to user:

```markdown
## Discovery Complete

**Issue:** #<number> - <title>
**Tier:** <tier> (confirmed)

### Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>

### Affected Areas
| File | Change Type | Reason |
|------|-------------|--------|
| <file1> | Modify | <reason> |
| <file2> | Create | <reason> |

### Existing Patterns Found
- <pattern 1>: <where used>
- <pattern 2>: <where used>

### Dependencies
```
<file1>
  └── imports: <dep1>, <dep2>
  └── used by: <consumer1>
```

### Complexity Assessment
- Files: <count>
- Cross-cutting: <yes/no>
- Breaking changes: <risk level>

**Proceed to Architecture?** [Approve / Clarify / Re-analyze]
```

### Result

**QG-2 Result:** [PASS | FAIL]

### On FAIL

1. Review search results
2. Expand search patterns
3. Re-analyze dependencies
4. Max 3 retries, then ESCALATE

---

## NEXT PHASE

**QG-2 = PASS required to proceed to Phase 3: Architecture**

**STOP if QG-2 ≠ PASS. Do not proceed.**
