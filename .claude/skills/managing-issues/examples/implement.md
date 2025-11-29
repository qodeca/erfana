# Implement Operation Examples

Detailed examples showing the Implement operation workflow for different tiers.

---

## Example 1: Trivial Issue (Tier 1)

**Issue:** #42 - Fix typo in README

**Labels:** `documentation`

**Workflow:**

```
Phase 0: Pre-flight (QG-0 Mandatory)
   → Issue open? ✓
   → Tests pass? ✓
   → Create branch: git checkout -b docs/42-fix-readme-typo
   → QG-0: PASS

Phase 1: Business Analysis (QG-1 Automated)
   → 1 search: Any style guide for docs?
   → Light validation (Tier 1)
   → QG-1: PASS (automated)

Phase 2: Discovery (QG-2 Automated)
   → Quick file identification: README.md
   → Light validation (Tier 1)
   → QG-2: PASS (automated)

Phase 3: Architecture (QG-3 User-Approval)
   → Simple fix, no architecture needed
   → QG-3: PASS (trivial change)

Phase 4: Implementation (QG-4 Automated)
   → Fix typo directly in README.md
   → QG-4: PASS

Phase 5: Architectural Review (QG-5 Automated)
   → Light review (Tier 1)
   → QG-5: PASS (automated)

Phase 6: Security (QG-6 Mandatory)
   → npm audit: Pass
   → Secret check: Pass
   → QG-6: PASS

Phase 7: Quality Review (QG-7 Automated)
   → Light review (Tier 1)
   → QG-7: PASS (automated)

Phase 8: Verification (QG-8 Mandatory)
   → Typo fixed? ✓
   → QG-8: PASS

Phase 9: Documentation (QG-9 Automated)
   → No CLAUDE.md update needed (trivial)
   → QG-9: PASS

Phase 10: UAT (QG-10 Automated)
   → Visual check of README
   → QG-10: PASS (automated for Tier 1)

Phase 11: Finalization (QG-11 User-Approval)
   → All quality gates: PASS
   → Commit: "docs: fix typo in README - Closes #42"
   → User approves commit
   → Merge to main and delete branch
   → QG-11: PASS
```

**Key Points:**
- ALL 12 phases execute (0-11) - tier determines depth, not skip
- Tier 1 uses automated gates where possible (light validation)
- Mandatory gates still enforced: QG-0, QG-6, QG-8
- User approval required for: QG-3, QG-11

---

## Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs

**Labels:** `enhancement`

**Workflow:**

```
Phase 0: Pre-flight (QG-0 Mandatory)
   → Issue open? ✓
   → Tests pass? ✓
   → Create branch: git checkout -b feat/11-chrome-style-tabs
   → QG-0: PASS

Phase 1: Business Analysis (QG-1 Checkpoint)
   → Agent: analyze-requirements
   → WebSearch: "chrome style tabs react", "dockview custom tabs"
   → Found: No suitable library, VS Code uses custom implementation
   → Questionnaire: Reference=VS Code, Scope=defined
   → User reviews research findings
   → QG-1: PASS

Phase 2: Discovery (QG-2 Checkpoint)
   → Agent: explore-codebase
   → Identify: DockviewReact tabs, HeaderComponent
   → User confirms understanding
   → QG-2: PASS

Phase 3: Architecture (QG-3 User-Approval)
   → Agent: design-solution
   → Plan: EditorTab component, context menu, CSS
   → Architect verification: Plan complete
   → User approves plan
   → QG-3: PASS

Phase 4: Implementation (QG-4 Automated)
   → Agent: implement-code → Create EditorTab.tsx
   → Agent: write-tests → Create EditorTab.test.tsx
   → Typecheck: PASS, Lint: PASS
   → QG-4: PASS

Phase 5: Architectural Review (QG-5 Checkpoint)
   → Agent: review-architecture
   → SOLID analysis: Pass
   → User reviews assessment
   → QG-5: PASS

Phase 6: Security (QG-6 Mandatory)
   → Agent: audit-security
   → npm audit: Pass
   → OWASP: Pass (Tier 2 full audit)
   → QG-6: PASS

Phase 7: Quality Review (QG-7 Checkpoint)
   → Agent: review-code
   → Maintainability: 78/100
   → User reviews quality assessment
   → QG-7: PASS

Phase 8: Verification (QG-8 Mandatory)
   → Agent: design-solution (verify mode)
   → Implementation matches plan: VERIFIED
   → QG-8: PASS

Phase 9: Documentation (QG-9 Automated)
   → Agent: update-docs
   → CLAUDE.md updated with new feature
   → QG-9: PASS

Phase 10: UAT (QG-10 User-Approval)
   → npm run build && npm run dev
   → User tests acceptance criteria
   → QG-10: PASS

Phase 11: Finalization (QG-11 User-Approval)
   → All quality gates: PASS
   → Agent: summarize-diff
   → Commit: "feat(tabs): add Chrome-style dynamic tabs - Closes #11"
   → User approves commit
   → Merge to main and delete branch
   → QG-11: PASS
```

**Key Points:**
- ALL 12 phases execute (0-11)
- 12 Quality Gates (one per phase)
- Tier 2 uses Checkpoint gates (user reviews findings)
- Mandatory gates enforced: QG-0, QG-6, QG-8
- Full OWASP security audit for Tier 2

---

## Quality Gate Summary (Implement)

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

**Gate Types:**
- **Mandatory**: MUST pass, cannot be overridden (QG-0, QG-6, QG-8)
- **Checkpoint**: User reviews findings before proceeding (Tier 2 only)
- **User-Approval**: Requires explicit user consent
- **Automated**: Passes if automated checks pass
