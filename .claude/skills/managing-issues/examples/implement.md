# Implement Operation Examples

Detailed examples showing the Implement operation workflow for different tiers.

---

## Example 1: Trivial Issue (Tier 1)

**Issue:** #42 - Fix typo in README

**Labels:** `documentation`

**Workflow:**

```
1. Phase 0: Pre-flight
   → Issue open? ✓
   → Tests pass? ✓
   → Create branch: git checkout -b docs/42-fix-readme-typo

2. Phase 1: Business Analysis (Quick)
   → 1 search: Any style guide for docs?
   → No checkpoint (Tier 1)

3. Skip Phases 2-3, 5, 7-8, 10 (Tier 1)

4. Phase 4: Implementation
   → Fix typo directly in README.md

5. Phase 6: Security (Basic)
   → npm audit: Pass
   → Secret check: Pass

6. Phase 9: Documentation
   → No CLAUDE.md update needed (trivial)

7. Phase 11: Finalization
   → Quality gates: Pass
   → Commit: "docs: fix typo in README - Closes #42"
   → Checkpoint: Approve commit
   → Checkpoint: "Merge to main and delete branch"
```

**Key Points:**
- Only 2 checkpoints (Security, Commit)
- Minimal phases executed
- Quick business analysis, no checkpoint

---

## Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs

**Labels:** `enhancement`

**Workflow:**

```
1. Phase 0: Pre-flight
   → Issue open? ✓
   → Tests pass? ✓
   → Create branch: git checkout -b feat/11-chrome-style-tabs

2. Phase 1: Business Analysis (Comprehensive)
   → WebSearch: "chrome style tabs react", "dockview custom tabs"
   → Found: No suitable library, VS Code uses custom implementation
   → Questionnaire: Reference=VS Code, Scope=defined
   → Checkpoint: Present research → Approved

3. Phase 2: Discovery
   → Agent: explore-codebase
   → Identify: DockviewReact tabs, HeaderComponent
   → Checkpoint: Confirm understanding

4. Phase 3: Architecture
   → Agent: design-solution
   → Plan: EditorTab component, context menu, CSS
   → Plan Verification Gate: Architect verifies → APPROVED
   → Checkpoint: Present plan → User approves

5. Phase 4: Implementation
   → Agent: implement-code → Create EditorTab.tsx
   → Agent: write-tests → Create EditorTab.test.tsx

6. Phase 5: Architectural Review
   → Agent: review-architecture
   → SOLID analysis: Pass
   → Checkpoint: Architectural assessment approved

7. Phase 6: Security (Full)
   → Agent: audit-security
   → npm audit: Pass
   → OWASP: Pass
   → Checkpoint: Security passed

8. Phase 7: Quality Review
   → Agent: review-code
   → Maintainability: 78/100
   → Checkpoint: Quality approved

9. Phase 8: Verification
   → Agent: design-solution (verify mode)
   → Verification Gate: VERIFIED
   → Checkpoint: Verification approved

10. Phase 9: Documentation
    → Agent: update-docs
    → CLAUDE.md updated with new feature

11. Phase 10: UAT
    → npm run build && npm run dev
    → Checkpoint: User tests → "UAT passed"

12. Phase 11: Finalization
    → Quality gates: All pass
    → Agent: summarize-diff
    → Commit: "feat(tabs): add Chrome-style dynamic tabs - Closes #11"
    → Checkpoint: Approve commit
    → Checkpoint: "Merge to main and delete branch"
```

**Key Points:**
- All 12 phases active (0-11)
- 10 checkpoints total
- Two verification gates (Plan + Implementation)
- Full security audit

---

## Checkpoint Summary (Implement)

| Checkpoint | Tier 1 | Tier 2 |
|------------|--------|--------|
| Business Analysis | - | ✓ |
| Discovery | - | ✓ |
| Architecture | - | ✓ |
| Architectural Review | - | ✓ |
| Security Scan | ✓ | ✓ |
| Quality Review | - | ✓ |
| Verification | - | ✓ |
| UAT | - | ✓ |
| Commit | ✓ | ✓ |
| Branch Management | ✓ | ✓ |
| **Total** | **2** | **10** |
