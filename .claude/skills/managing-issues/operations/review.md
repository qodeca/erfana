# Operation: Review

Comprehensive source code review according to best practices defined in this skill.

---

## Overview

| Attribute | Value |
|-----------|-------|
| Phases | 5 (0-4) |
| Checkpoints | 2 (Scope Selection, Level Selection) |
| Agents | 4 (review-standalone, review-architecture, review-code, audit-security) |
| Autonomy | Medium (requires initial scope/level selection) |

---

## When to Use

Activate when user:
- Asks to "review" code, file, component, or module
- Wants code quality assessment
- Needs architectural analysis
- Requests security audit of existing code
- Says "check", "analyze", or "audit" code

**Trigger phrases:**
- "Review this file"
- "Review the authentication module"
- "Check my component for issues"
- "Analyze the codebase"
- "Audit security of src/main"
- "Review my changes" (PR/Diff)

---

## Core Principle

**ALWAYS ask the user what and how to review.** Never assume scope or depth. The two mandatory questions ensure the review is targeted and appropriately thorough.

---

## Review Scopes

| Scope | Description | Files Involved |
|-------|-------------|----------------|
| **File** | Single file review | 1 file |
| **Component** | React component + related | .tsx + .css + .logic.ts + .test.ts |
| **Module** | Directory/folder | All files in directory |
| **Feature** | Cross-cutting concern | Related files across directories |
| **PR/Diff** | Current branch changes | `git diff --name-only main` |
| **Codebase** | High-level architecture | Key files per layer |

---

## Review Levels

| Level | Focus | Time | Dimensions |
|-------|-------|------|------------|
| **Quick** | Critical issues | ~5 min | Security, Breaking patterns |
| **Standard** | Balanced | ~15 min | + Code quality, Basic SOLID |
| **Deep** | Comprehensive | ~30 min | + All SOLID, Performance, Documentation |

### Dimension Matrix

| Dimension | Quick | Standard | Deep |
|-----------|-------|----------|------|
| Security (secrets, injection) | ✅ | ✅ | ✅ |
| Breaking patterns (anti-patterns) | ✅ | ✅ | ✅ |
| Code quality (naming, complexity) | ❌ | ✅ | ✅ |
| Basic SOLID (SRP, DIP) | ❌ | ✅ | ✅ |
| All SOLID principles | ❌ | ❌ | ✅ |
| Coupling/Cohesion analysis | ❌ | ❌ | ✅ |
| Performance review | ❌ | ❌ | ✅ |
| Test coverage analysis | ❌ | ✅ | ✅ |
| Documentation review | ❌ | ❌ | ✅ |

---

## Workflow

### Phase 0: Scope Selection (MANDATORY)

#### Input Conditions
- [ ] User has requested a review

#### Execution
**MUST use AskUserQuestion** to determine review scope:

```
AskUserQuestion({
  questions: [{
    question: "What would you like me to review?",
    header: "Review Scope",
    options: [
      { label: "File", description: "Review a single file" },
      { label: "Component", description: "React component and related files (tsx, css, logic, tests)" },
      { label: "Module", description: "A directory/folder with multiple files" },
      { label: "Feature", description: "Cross-cutting feature spanning multiple areas" }
    ],
    multiSelect: false
  }]
})
```

**Additional scopes (offer if appropriate):**
- **PR/Diff**: If on a feature branch with changes
- **Codebase**: If request implies high-level analysis

#### Post-Step Validation
- [ ] Scope selected
- [ ] User has confirmed scope choice

#### Quality Gate
If user selects "Other": Ask for clarification (max 3 attempts).

**CHECKPOINT**: Do not proceed until scope is selected.

---

### Phase 1: Target Identification

#### Input Conditions
- [ ] Phase 0 complete
- [ ] Scope determined

#### Execution

Based on scope, identify target files:

**File Scope:**
```
AskUserQuestion({
  questions: [{
    question: "Which file would you like me to review?",
    header: "Target File",
    options: [/* dynamically populated or user provides path */]
  }]
})
```
OR user provides path directly.

**Component Scope:**
```
Glob(pattern="**/<ComponentName>*")
→ Find .tsx, .css, .logic.ts, .test.ts files
```

**Module Scope:**
```
Glob(pattern="<directory>/**/*")
→ Filter to relevant source files
```

**Feature Scope:**
```
Grep(pattern="<feature_keyword>")
→ Identify all related files across codebase
```

**PR/Diff Scope:**
```
Bash(command="git diff --name-only main")
→ List changed files
```

**Codebase Scope:**
```
→ Sample key files from each architectural layer:
  - src/main/services/*.ts (2-3 files)
  - src/renderer/src/components/**/*.tsx (3-4 files)
  - src/renderer/src/stores/*.ts (2-3 files)
  - src/shared/*.ts (1-2 files)
```

#### Post-Step Validation
- [ ] Target files identified
- [ ] Files exist and are readable
- [ ] Count is reasonable (<50 for module, <100 for feature/codebase)

#### Quality Gate
If too many files: Offer to narrow scope or prioritize.

---

### Phase 2: Level Selection (MANDATORY)

#### Input Conditions
- [ ] Phase 1 complete
- [ ] Target files identified

#### Execution
**MUST use AskUserQuestion** to determine review depth:

```
AskUserQuestion({
  questions: [{
    question: "What level of review would you like?",
    header: "Review Level",
    options: [
      { label: "Quick", description: "Critical issues only - security, breaking patterns (~5 min)" },
      { label: "Standard", description: "Balanced review - quality, basic SOLID, testing (~15 min)" },
      { label: "Deep", description: "Comprehensive - all SOLID, performance, documentation (~30 min)" }
    ],
    multiSelect: false
  }]
})
```

#### Post-Step Validation
- [ ] Level selected
- [ ] User has confirmed level choice

#### Quality Gate
If user selects "Other": Ask for specific dimensions they want reviewed.

**CHECKPOINT**: Do not proceed until level is selected.

---

### Phase 3: Execute Review

#### Input Conditions
- [ ] Phase 2 complete
- [ ] Scope, target files, and level determined

#### Execution

Delegate to agents based on level:

**Quick Level:**
```
Delegate to: agents/review-standalone.md
Mode: quick
Dimensions: [security, anti-patterns]
```

**Standard Level:**
```
Delegate to: agents/review-standalone.md
Mode: standard
Dimensions: [security, anti-patterns, code-quality, basic-solid, testing]
```

**Deep Level:**
```
Delegate to: agents/review-standalone.md
Mode: deep
Dimensions: [security, anti-patterns, code-quality, all-solid, coupling, cohesion, performance, documentation]

Additionally delegate to:
- agents/review-architecture.md (for SOLID analysis)
- agents/audit-security.md (for OWASP checks)
```

#### Agent Inputs

```json
{
  "scope": "<file|component|module|feature|pr|codebase>",
  "level": "<quick|standard|deep>",
  "target_files": ["path/to/file1.ts", "path/to/file2.ts"],
  "dimensions": ["security", "code-quality", ...]
}
```

#### Post-Step Validation
- [ ] All target files reviewed
- [ ] All requested dimensions analyzed
- [ ] Findings collected and categorized

#### Quality Gate
If agent fails: Retry (max 3 attempts), then report partial results.

---

### Phase 4: Present Results

#### Input Conditions
- [ ] Phase 3 complete
- [ ] Review findings collected

#### Execution

1. **Aggregate Findings** by severity:
   - Critical: Must address immediately
   - High: Should address soon
   - Medium: Consider addressing
   - Low: Optional improvements

2. **Present Summary**:
   ```markdown
   ## Review Summary

   **Scope:** [Component] - EditorTab
   **Level:** Standard
   **Files Reviewed:** 4

   ### Findings by Severity
   - Critical: 0
   - High: 2
   - Medium: 5
   - Low: 3

   ### Critical Issues
   (none)

   ### High Priority Issues
   1. [Security] Missing input validation in handleInput()
   2. [SOLID/SRP] Component handles both rendering and data fetching

   ### Recommendations
   1. Extract data fetching to custom hook
   2. Add input validation at entry points
   ```

3. **Offer Follow-up**:
   ```
   AskUserQuestion({
     questions: [{
       question: "Would you like me to help fix any of these issues?",
       header: "Next Steps",
       options: [
         { label: "Fix critical/high", description: "Address critical and high priority issues" },
         { label: "Create issues", description: "Create GitHub issues to track findings" },
         { label: "Export report", description: "Save review as markdown file" },
         { label: "Done", description: "No further action needed" }
       ]
     }]
   })
   ```

#### Post-Step Validation
- [ ] Summary presented to user
- [ ] Follow-up option offered

#### Quality Gate
Review complete when user acknowledges results.

---

## Agent Orchestration

### Agent Selection by Level

| Agent | Quick | Standard | Deep |
|-------|-------|----------|------|
| review-standalone | ✅ | ✅ | ✅ |
| review-architecture | ❌ | ❌ | ✅ |
| audit-security | ❌ | ✅ | ✅ |
| review-code | ❌ | ✅ | ✅ |

### Review Dimensions by Agent

| Agent | Dimensions Covered |
|-------|-------------------|
| review-standalone | Orchestrates all, quick scan |
| review-architecture | SOLID, coupling, cohesion, patterns |
| audit-security | OWASP, secrets, injection, npm audit |
| review-code | Quality, naming, complexity, testing |

---

## Error Handling

| Error | Response |
|-------|----------|
| File not found | Skip file, note in findings |
| Permission denied | Report error, continue with accessible files |
| Too many files | Offer to narrow scope |
| Agent timeout | Retry once, then report partial results |
| User cancels | Save partial results, offer to resume later |

---

## Example Flows

### Example 1: Component Review (Standard)

**User says:** "Review the EditorTab component"

**Operation does:**
1. **Phase 0**: Scope = Component (auto-detected from "component")
2. **Phase 1**: Find files:
   - src/.../EditorTab.tsx
   - src/.../EditorTab.css
   - src/.../editorTab.logic.ts (if exists)
   - src/.../EditorTab.test.tsx
3. **Phase 2**: Ask level → User selects "Standard"
4. **Phase 3**: Execute review-standalone (standard) + review-code
5. **Phase 4**: Present findings, offer fix

### Example 2: PR Review (Quick)

**User says:** "Quick review my changes"

**Operation does:**
1. **Phase 0**: Scope = PR/Diff (auto-detected from "changes")
2. **Phase 1**: `git diff --name-only main` → 5 files
3. **Phase 2**: Ask level → User selects "Quick"
4. **Phase 3**: Execute review-standalone (quick)
5. **Phase 4**: Present critical issues only

### Example 3: Module Review (Deep)

**User says:** "I want a thorough review"

**Operation does:**
1. **Phase 0**: Ask scope → User selects "Module"
2. **Phase 1**: Ask which module → User says "src/main/services/"
3. **Phase 2**: Ask level → User selects "Deep"
4. **Phase 3**: Execute all agents
5. **Phase 4**: Present comprehensive report with SOLID analysis

---

## Best Practices Applied

This operation enforces the skill's established best practices:

### From review-code Agent
- Security review (secrets, injection, XSS)
- Performance patterns (re-renders, memory leaks)
- TypeScript types (no unjustified `any`)
- Test coverage verification

### From review-architecture Agent
- SOLID principle analysis (SRP, OCP, LSP, ISP, DIP)
- Coupling/cohesion evaluation
- Anti-pattern detection (God Object, Feature Envy, etc.)
- Layer boundary enforcement

### From audit-security Agent
- npm audit for vulnerabilities
- OWASP Top 10 verification
- Path traversal prevention
- IPC security (Electron-specific)

---

## Autonomy Reference

| Action | Autonomous? |
|--------|-------------|
| Ask scope question | Yes (mandatory) |
| Ask level question | Yes (mandatory) |
| Read files | Yes |
| Run npm audit | Yes |
| Execute grep/glob | Yes |
| Present findings | Yes |
| Fix issues | No - requires approval |
| Create GitHub issues | No - requires approval |
