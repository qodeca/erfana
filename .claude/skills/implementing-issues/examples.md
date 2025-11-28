# Implementation Examples

Detailed examples showing the implementing-issues workflow for each complexity tier.

---

## Example 1: Trivial Issue (Tier 1)

**Issue:** #42 - Fix typo in README

```
1. Pre-flight: Check issue is open, create branch ✓
   git checkout -b docs/42-fix-readme-typo
2. Skip Discovery, Architecture, Architectural Review, Verification, Review, UAT
3. Implementation: Fix typo directly
4. Security (Phase 6): npm audit, secret check → Pass
5. Finalization (Phase 11): Run lint, commit
   "docs: fix typo in README - Closes #42"
   → Checkpoint: Approve commit
   → Checkpoint: Branch management (select "Merge to main and delete branch")
```

**Key Points:**
- Minimal phases (Pre-flight → Implementation → Security → Finalization)
- No Discovery, Architecture, Verification, Review, or UAT
- Quick business analysis (1-2 searches, no checkpoint)
- Single commit, merge to main

---

## Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs

```
1. Pre-flight (Phase 0): Verify environment, create branch ✓
   git checkout -b feat/11-chrome-style-tabs

2. Business Analysis (Phase 1): Comprehensive research
   → WebSearch: "chrome style tabs react", "dockview custom tabs", "VS Code tab implementation"
   → Found: No suitable library, VS Code uses custom implementation
   → Questionnaire: Reference=VS Code, Scope=defined, Edge cases=comprehensive
   → Checkpoint: Present research + requirements → Approved

3. Discovery (Phase 2): Understand DockviewReact tabs, identify components
   → Checkpoint: Confirm understanding

4. Architecture (Phase 3): Design EditorTab component, context menu
   → Plan Verification Gate: Architect verifies plan → APPROVED
   → Checkpoint: Present approved plan to user → Approve plan

5. Implementation (Phase 4): Create EditorTab.tsx, CSS, tests

6. Architectural Review (Phase 5): Review SOLID principles, coupling, cohesion
   → Report: APPROVED

7. Security (Phase 6): Full scan + security-auditor agent + OWASP
   → Pass all security gates

8. Review (Phase 7): code-reviewer + quality checklist
   → Checkpoint: Approve quality review

9. Verification (Phase 8): Architect verifies implementation matches plan
   → Verification Gate: solution-architect confirms → VERIFIED
   → Checkpoint: Present verification to user → Proceed

10. Documentation (Phase 9): Update CLAUDE.md changelog

11. UAT (Phase 10): Build project, run dev server
    → Checkpoint: User tests manually, selects "UAT passed"

12. Finalization (Phase 11): Pass quality gates, commit
    → Checkpoint: Approve commit
    → Checkpoint: Select "Merge to main and delete branch"
```

**Key Points:**
- All 12 phases active (0-11)
- Comprehensive business analysis (5-8 searches)
- security-auditor agent + OWASP verification (Phase 6)
- code-reviewer required (Phase 7)
- Two verification gates: Plan (Phase 3) + Implementation (Phase 8)
- UAT with user testing
- 10 checkpoints total

---

## Checkpoint Summary by Tier

| Checkpoint | Tier 1 | Tier 2 |
|------------|--------|--------|
| Business Analysis | - | ✓ |
| Discovery | - | ✓ |
| Architecture (Plan) | - | ✓ |
| Architectural Review | - | ✓ |
| Security Scan | ✓ | ✓ |
| Quality Review | - | ✓ |
| Verification | - | ✓ |
| UAT | - | ✓ |
| Commit | ✓ | ✓ |
| Branch Management | ✓ | ✓ |
| **Total** | **2** | **10** |

---

## Quick Reference: When to Use Each Tier

| Scenario | Tier | Reasoning |
|----------|------|-----------|
| Fix typo in docs | 1 | No code logic, minimal risk |
| Update test count | 1 | Trivial change |
| Add new UI component | 2 | Requires design, testing |
| Implement new feature | 2 | Standard development flow |
| Security vulnerability | 2 | Requires security-auditor |
| Breaking API change | 2 | Requires comprehensive review |
| Architecture refactor | 2 | High impact, many files |
