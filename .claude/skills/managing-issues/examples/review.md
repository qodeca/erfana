# Review Operation Examples

Detailed examples showing the Review operation workflow for different scopes and levels.

---

## Example 1: Component Review (Standard)

**User says:** "Review the EditorTab component"

**Workflow:**

```
1. Phase 0: Scope Selection (MANDATORY)
   → Detect "component" from request
   → AskUserQuestion: Confirm scope
   → User confirms: "Component"

2. Phase 1: Target Identification
   → Glob: **/*EditorTab*
   → Found:
     - src/.../EditorTab.tsx
     - src/.../EditorTab.css
     - src/.../EditorTab.test.tsx
   → 3 files identified

3. Phase 2: Level Selection (MANDATORY)
   → AskUserQuestion: "What level of review?"
   → User selects: "Standard"

4. Phase 3: Execute Review
   → Agent: review-standalone (standard mode)
   → Dimensions: security, anti-patterns, code-quality, basic-solid, testing

   Security Check:
   → Grep for secrets: None found ✓
   → Grep for injection: None found ✓

   Code Quality:
   → File length: 180 lines ✓
   → Naming conventions: Follows codebase ✓
   → Complexity: Reasonable ✓

   SOLID (Basic):
   → SRP: Component handles rendering + context menu (minor concern)
   → DIP: Uses context for services ✓

   Testing:
   → Test coverage: 85% ✓
   → Edge cases: Missing keyboard nav test

5. Phase 4: Present Results

   ## Review Summary

   **Scope:** Component - EditorTab
   **Level:** Standard
   **Files Reviewed:** 3

   ### Findings by Severity
   - Critical: 0
   - High: 0
   - Medium: 2
   - Low: 1

   ### Medium Priority Issues
   1. [SOLID/SRP] Context menu logic could be extracted to hook
   2. [Performance] Menu items array recreated on each render

   ### Low Priority Issues
   1. [Testing] No test for keyboard navigation

   ### Recommendations
   1. Consider extracting context menu to useContextMenu hook
   2. Wrap menu items in useMemo
   3. Add keyboard navigation tests

   → AskUserQuestion: "Would you like me to fix any issues?"
   → User selects: "Done"
```

**Result:** Review complete, 3 findings reported

---

## Example 2: PR/Diff Review (Quick)

**User says:** "Quick review my changes"

**Workflow:**

```
1. Phase 0: Scope Selection (MANDATORY)
   → Detect "changes" from request
   → Detect "quick" from request
   → AskUserQuestion: Confirm scope
   → User confirms: "PR/Diff"

2. Phase 1: Target Identification
   → git diff --name-only main
   → Changed files:
     - src/.../TerminalPanel.tsx
     - src/.../useTerminalStore.ts
     - src/.../terminal.css
   → 3 files identified

3. Phase 2: Level Selection (MANDATORY)
   → Level already specified ("quick")
   → AskUserQuestion to confirm: "Quick"
   → User confirms

4. Phase 3: Execute Review
   → Agent: review-standalone (quick mode)
   → Dimensions: security, anti-patterns

   Security Check:
   → Grep for secrets: None found ✓
   → Grep for injection: Found exec() usage ⚠️

   Anti-Patterns:
   → No God Objects ✓
   → No Feature Envy ✓

5. Phase 4: Present Results

   ## Review Summary

   **Scope:** PR/Diff
   **Level:** Quick
   **Files Reviewed:** 3

   ### Findings by Severity
   - Critical: 0
   - High: 1
   - Medium: 0
   - Low: 0

   ### High Priority Issues
   1. [Security] exec() usage in useTerminalStore.ts:45
      - Input appears to come from user
      - Ensure command is validated/sanitized

   ### Recommendations
   1. Add input validation before exec() call
   2. Consider using spawn() for safer subprocess control

   → AskUserQuestion: "Would you like me to fix any issues?"
   → User selects: "Fix critical/high"
   → Route to fix workflow
```

**Result:** Review complete, 1 high-priority issue found and fixed

---

## Example 3: Module Review (Deep)

**User says:** "I need a thorough review of the services folder"

**Workflow:**

```
1. Phase 0: Scope Selection (MANDATORY)
   → Detect "services folder" = module
   → Detect "thorough" = deep
   → AskUserQuestion: Confirm scope
   → User confirms: "Module"

2. Phase 1: Target Identification
   → AskUserQuestion: "Which module?"
   → User: "src/main/services/"
   → Glob: src/main/services/**/*.ts
   → Found 12 files

3. Phase 2: Level Selection (MANDATORY)
   → Level hint from "thorough"
   → AskUserQuestion: Confirm "Deep"
   → User confirms

4. Phase 3: Execute Review
   → Agent: review-standalone (deep mode)
   → Agent: review-architecture (full SOLID)
   → Agent: audit-security (OWASP)
   → Agent: review-code (quality metrics)

   All Dimensions Analyzed:
   - security ✓
   - anti-patterns ✓
   - code-quality ✓
   - all-solid ✓
   - coupling ✓
   - cohesion ✓
   - performance ✓
   - testing ✓
   - documentation ✓

5. Phase 4: Present Results

   ## Review Summary

   **Scope:** Module - src/main/services/
   **Level:** Deep
   **Files Reviewed:** 12

   ### Findings by Severity
   - Critical: 0
   - High: 2
   - Medium: 8
   - Low: 4

   ### SOLID Analysis
   - SRP: 10/12 files pass
   - OCP: 11/12 files pass
   - LSP: N/A (no inheritance)
   - ISP: 12/12 files pass
   - DIP: 8/12 files pass

   ### Coupling: Medium
   - Some services directly depend on others
   - Recommend interface abstraction

   ### Cohesion: High
   - Services are well-focused

   ### High Priority Issues
   1. [SOLID/DIP] FileService directly instantiates SettingsService
   2. [Security] Path traversal not validated in readFile()

   ### Medium Priority Issues
   1. [SRP] FileService handles both reading AND watching
   2. [Performance] Synchronous file operations in TerminalService
   ... (6 more)

   ### Documentation Gaps
   - 4 services missing JSDoc
   - No architecture overview

   ### Recommendations (Prioritized)
   1. Add path validation in FileService.readFile()
   2. Inject SettingsService via constructor
   3. Split FileService into FileReader and FileWatcher
   4. Add JSDoc to public methods
   5. Create services/README.md

   → AskUserQuestion: "Would you like me to fix any issues?"
   → User selects: "Create issues"
   → Route to Create operation for each high/medium finding
```

**Result:** Comprehensive review complete, 14 findings, 2 GitHub issues created

---

## Checkpoint Summary (Review)

| Checkpoint | Review |
|------------|--------|
| Scope Selection | ✓ |
| Level Selection | ✓ |
| **Total** | **2** |
