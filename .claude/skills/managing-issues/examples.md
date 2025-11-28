# Managing Issues Examples

Detailed examples showing workflows for each operation.

---

## Create Operation Examples

### Example 1: Bug Report Flow

**User says:** "The resize handles are too thin and hard to grab"

**Workflow:**

```
1. Phase 1: Understand the Problem
   → Issue type: Bug (UX issue affecting resize interaction)

2. Phase 2: Ask Clarifying Questions
   → AskUserQuestion:
     - Which panels? → Project Tree, Editor, Terminal dividers
     - What size feels right? → 6-8px
     - Hover feedback? → Yes, teal accent
     - Severity? → Medium

3. Phase 3: Check for Duplicates
   → gh issue list --search "resize handle"
   → No duplicates found

4. Phase 4: Draft the Issue
   → Using bug-report template:

   ## Summary
   Panel resize handles are difficult to grab due to narrow hit area.

   ## Affected Areas
   - Project Tree <-> Editor divider
   - Editor <-> Terminal divider

   ## Expected Behavior
   - Resize handles should have comfortable grab area (~6-8px)
   - Visual feedback on hover

   ## Acceptance Criteria
   - [ ] All dividers have increased hit area
   - [ ] Hover state shows visual indicator
   - [ ] Consistent UX across all panels

   ## Implementation Notes for Claude Code
   1. Research how the layout system handles resize
   2. Check for existing resize-related styling
   3. Ensure changes apply consistently to all panels

5. Phase 5: Present and Confirm
   → Present draft to user
   → User approves
   → gh issue create --title "Resize handles are too thin" --label "bug"
   → Return issue URL
```

**Result:** Issue #35 created

---

### Example 2: Feature Request Flow

**User says:** "I want dark mode support"

**Workflow:**

```
1. Phase 1: Understand the Problem
   → Issue type: Enhancement (new feature)

2. Phase 2: Ask Clarifying Questions
   → AskUserQuestion:
     - Toggle mechanism? → System preference
     - Which components? → All (editor, preview, panels)
     - Reference implementation? → VS Code

3. Phase 3: Check for Duplicates
   → gh issue list --search "dark mode"
   → No duplicates found

4. Phase 4: Draft the Issue
   → Using enhancement template:

   ## Summary
   Add dark mode support with system preference detection.

   ## Motivation
   Users working in low-light environments need reduced eye strain.

   ## Expected Behavior
   - Automatically detect system dark/light preference
   - Apply theme to all UI components
   - Match VS Code's theme behavior

   ## Acceptance Criteria
   - [ ] System preference detection works
   - [ ] All UI components support dark theme
   - [ ] Theme switches seamlessly without restart
   - [ ] No visual glitches during transition

   ## Implementation Notes for Claude Code
   1. Research existing theme infrastructure
   2. Check how Monaco editor handles themes
   3. Ensure preview markdown respects theme

5. Phase 5: Present and Confirm
   → Present draft to user
   → User approves
   → gh issue create --title "Add dark mode support" --label "enhancement"
   → Return issue URL
```

**Result:** Issue #36 created

---

## Implement Operation Examples

### Example 3: Trivial Issue (Tier 1)

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

### Example 4: Standard Feature (Tier 2)

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

## Checkpoint Summary

| Checkpoint | Create | Implement T1 | Implement T2 |
|------------|--------|--------------|--------------|
| Business Analysis | - | - | ✓ |
| Discovery | - | - | ✓ |
| Architecture | - | - | ✓ |
| Duplicate Check | ✓ | - | - |
| Draft Approval | ✓ | - | - |
| Architectural Review | - | - | ✓ |
| Security Scan | - | ✓ | ✓ |
| Quality Review | - | - | ✓ |
| Verification | - | - | ✓ |
| UAT | - | - | ✓ |
| Commit | - | ✓ | ✓ |
| Branch Management | - | ✓ | ✓ |
| **Total** | **2** | **2** | **10** |

---

## Quick Reference

| Scenario | Operation | Tier |
|----------|-----------|------|
| User reports bug | Create | - |
| User wants feature | Create | - |
| Fix typo in docs | Implement | 1 |
| Update test count | Implement | 1 |
| Add new component | Implement | 2 |
| Fix complex bug | Implement | 2 |
| Security fix | Implement | 2 |
| Architecture refactor | Implement | 2 |
