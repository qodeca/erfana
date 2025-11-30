# Managing Issues Examples

Detailed examples showing workflows for each operation.

---

## Examples by Operation

| Operation | Examples | File |
|-----------|----------|------|
| **Create** | Bug report, Feature request | [examples/create.md](examples/create.md) |
| **Implement** | Tier 1 trivial, Tier 2 standard | [examples/implement.md](examples/implement.md) |
| **Review** | Component, PR/Diff, Module | [examples/review.md](examples/review.md) |

---

## Quality Gate Summary (All Operations)

### Implement Operation Quality Gates

| Quality Gate | Phase | Tier 1 | Tier 2 | Can Override |
|--------------|-------|--------|--------|--------------|
| QG-0: Pre-flight | 0 | Mandatory | Mandatory | **NO** |
| QG-1: Business Analysis | 1 | Automated | Checkpoint | Yes |
| QG-2: Discovery | 2 | Automated | Checkpoint | Yes |
| QG-3: Architecture | 3 | User-Approval | User-Approval | Yes |
| QG-4: Implementation | 4 | Automated | Automated | Yes |
| QG-5: Architectural Review | 5 | Automated | Checkpoint | Yes |
| QG-6: Security | 6 | Mandatory | Mandatory | **NO** |
| QG-7: Quality Review | 7 | Automated | Checkpoint | Yes |
| QG-8: Verification | 8 | Mandatory | Mandatory | **NO** |
| QG-9: Documentation | 9 | Automated | Automated | Yes |
| QG-10: UAT | 10 | Automated | User-Approval | Yes |
| QG-11: Finalization | 11 | User-Approval | User-Approval | Yes |

**Note:** ALL phases execute for both tiers. Tier determines validation depth, not phase skipping.

### Create Operation Checkpoints

| Checkpoint | Required |
|------------|----------|
| Duplicate Check | ✓ |
| Draft Approval | ✓ |

### Review Operation Checkpoints

| Checkpoint | Required |
|------------|----------|
| Scope Selection | ✓ |
| Level Selection | ✓ |

---

## Quick Reference

| Scenario | Operation | Tier/Level |
|----------|-----------|------------|
| User reports bug | Create | - |
| User wants feature | Create | - |
| Fix typo in docs | Implement | Tier 1 |
| Update test count | Implement | Tier 1 |
| Add new component | Implement | Tier 2 |
| Fix complex bug | Implement | Tier 2 |
| Security fix | Implement | Tier 2 |
| Architecture refactor | Implement | Tier 2 |
| Quick code check | Review | Quick |
| Component quality | Review | Standard |
| Full architecture audit | Review | Deep |
| PR before merge | Review | Quick/Standard |
| Module assessment | Review | Standard/Deep |
