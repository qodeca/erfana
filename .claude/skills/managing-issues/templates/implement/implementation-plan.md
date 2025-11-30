# Implementation Plan Template

Use this template to document the architecture/implementation plan after the architect-reviewer analysis.

---

## Issue Summary

**Issue:** #<number> - <title>
**Type:** Bug / Enhancement / Feature / Refactor
**Complexity Tier:** 1 (Trivial) / 2 (Standard)
**Labels:** <label1>, <label2>

---

## Acceptance Criteria

From issue:
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <criterion 3>

---

## Technical Approach

### Summary
<1-2 sentence description of the solution approach>

### Design Decisions
1. **<Decision 1>:** <rationale>
2. **<Decision 2>:** <rationale>

### Patterns Applied
- <Pattern name>: <where and why>

---

## Changes Required

### Modified Files

| File | Change Type | Description |
|------|-------------|-------------|
| `<path>` | Modify | <what changes> |
| `<path>` | Modify | <what changes> |

### New Files

| File | Purpose |
|------|---------|
| `<path>` | <purpose> |
| `<path>` | <purpose> |

### Deleted Files

| File | Reason |
|------|--------|
| `<path>` | <why removing> |

---

## Component Design

### <Component Name>

**Purpose:** <what it does>

**Interface:**
```typescript
interface <ComponentProps> {
  // key props
}
```

**Dependencies:**
- <dependency 1>
- <dependency 2>

---

## Testing Strategy

### Unit Tests
- [ ] <test scenario 1>
- [ ] <test scenario 2>

### Integration Tests
- [ ] <test scenario>

### Visual/Manual Tests
- [ ] <test scenario>

**Coverage Target:** >80% for new code

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| <risk> | Low/Med/High | Low/Med/High | <mitigation> |

---

## Dependencies

### Blocked By
- None / <issue/task>

### Blocks
- None / <issue/task>

---

## Estimated Effort

**Files:** <count>
**Lines (estimated):** <count>
**Time:** <estimate>

---

## Agent Assignments

| Phase | Agent | Task |
|-------|-------|------|
| Implementation | typescript-pro | <specific task> |
| Testing | test-automator | <specific task> |
| Review | code-reviewer | Full review |

---

## Approval

- [ ] User approved this plan
- [ ] Ready to proceed with implementation

**Approved by:** <user>
**Date:** <date>
