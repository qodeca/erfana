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

## Checkpoint Summary (All Operations)

| Checkpoint | Create | Implement T1 | Implement T2 | Review |
|------------|--------|--------------|--------------|--------|
| Business Analysis | - | - | ✓ | - |
| Discovery | - | - | ✓ | - |
| Architecture | - | - | ✓ | - |
| Duplicate Check | ✓ | - | - | - |
| Draft Approval | ✓ | - | - | - |
| Scope Selection | - | - | - | ✓ |
| Level Selection | - | - | - | ✓ |
| Architectural Review | - | - | ✓ | - |
| Security Scan | - | ✓ | ✓ | - |
| Quality Review | - | - | ✓ | - |
| Verification | - | - | ✓ | - |
| UAT | - | - | ✓ | - |
| Commit | - | ✓ | ✓ | - |
| Branch Management | - | ✓ | ✓ | - |
| **Total** | **2** | **2** | **10** | **2** |

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
