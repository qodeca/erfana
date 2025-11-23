---
name: implementing-github-issues
description: Implement GitHub issues through structured phases with specialized agents and human checkpoints. Supports 3 complexity tiers (trivial/standard/complex) with appropriate checkpoint levels. Requires GitHub issue number. Use when working on an issue, 'implement #N', 'fix issue #N', or 'work on issue'.
---

# Implementing GitHub Issues

This skill guides the complete implementation of GitHub issues through structured phases, orchestrating specialized agents with human checkpoints at critical decision points.

## When to Use This Skill

Use `implementing-github-issues` when:
- Assigned a GitHub issue to implement
- Asked to "implement", "fix", or "work on" an issue
- Need structured workflow with checkpoints for quality control
- Want agent-assisted architecture, implementation, and review

**Trigger phrases:**
- "Implement issue #123"
- "Work on #45"
- "Fix this GitHub issue"
- "Let's tackle issue #99"

**Prerequisites:**
- GitHub CLI (`gh`) installed and authenticated
- Git repository cloned locally
- Node.js and npm available
- Project uses conventional commits

---

## Quick Start

```
User: "Implement issue #11"
```

The skill will:
1. Fetch issue details via `gh issue view 11`
2. Determine complexity tier based on labels
3. Guide through appropriate phases with checkpoints

---

## Phase Overview

| Phase | Purpose | Agent(s) | Checkpoint |
|-------|---------|----------|------------|
| 0. Pre-flight | Validate environment | - | - |
| 1. Discovery | Understand issue & codebase | codebase-explorer | Tier 2+ |
| 2. Architecture | Design solution + verify plan | solution-architect | Tier 2+ |
| 3. Implementation | Write code + tests | code-implementer, test-writer | - |
| 4. Review | Code quality check | code-reviewer, security-auditor (Tier 3) | Tier 3 |
| 4.5 Arch Verification | Verify implementation matches plan | solution-architect | Tier 2+ |
| 5. Documentation | Update docs | project-documenter | - |
| 6. UAT | Manual testing | - | Tier 2+ |
| 7. Finalization | Quality gates, commit, branch | diff-summarizer | All tiers |
| 8. Release (optional) | Production release | release-engineer | When releasing |

---

## Complexity Tiers

Determine tier from issue labels:

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Checkpoints:** Before Commit only (1 total)
**Skip phases:** Architecture, Architecture Verification, Review, UAT
**Estimated time:** 15-30 minutes

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, or unlabeled
**Checkpoints:** After Discovery, After Architecture (with plan verification), After Arch Verification, After UAT, Before Commit (5 total)
**Verification gates:** Plan verification (Phase 2), Implementation verification (Phase 4.5)
**Estimated time:** 30 minutes - 2 hours

### Tier 3: Complex
**Labels:** `breaking-change`, `architecture`, `security`, `major`
**Checkpoints:** All phases (7 total)
**Verification gates:** Plan verification (Phase 2), Implementation verification (Phase 4.5)
**Additional:** Security review required
**Estimated time:** 2+ hours

---

## Phase 0: Pre-flight Checks

Before starting, verify:

```bash
# Issue validation
gh issue view <number> --json state,title,labels,body

# Environment checks
git status --porcelain           # No uncommitted changes
npm test                          # Tests pass
npm run typecheck                 # Types valid
```

### Pre-flight Checklist
- [ ] Issue exists and is OPEN
- [ ] Issue has acceptance criteria (or request clarification)
- [ ] No `blocked` label on issue
- [ ] Tests pass on current branch
- [ ] No uncommitted changes in working directory
- [ ] Check for duplicate issues: `gh issue list --search "<keywords>"`

### Branch Strategy

For Tier 2+ issues, create a feature branch:
```bash
# Create feature branch (recommended)
git checkout -b fix/<number>-<short-description>
# Example: git checkout -b fix/11-chrome-style-tabs

# Or work on current branch for trivial fixes (Tier 1)
```

### Abort Pre-flight If
- Issue is CLOSED or DRAFT state
- `blocked` label is present
- Tests failing on main branch (fix baseline first)
- Uncommitted changes exist (stash or commit first)

**DO NOT proceed without resolving blockers.**

### If Pre-flight Fails
- Uncommitted changes: `git stash` or commit first
- Tests failing: Fix baseline before starting new work
- Issue blocked: Wait or work on blocker first
- Missing acceptance criteria: Comment on issue requesting details

---

## Phase 1: Discovery

**Goal:** Understand the issue and affected codebase areas.

### Steps

1. **Extract Issue Details**
   ```bash
   gh issue view <number> --json title,body,labels,assignees
   ```

2. **Identify Acceptance Criteria**
   - Look for checkboxes in issue body
   - If none exist, derive from description
   - Confirm understanding with user

3. **Codebase Analysis**
   - Search for relevant code areas
   - Identify affected components (main/, renderer/, shared/)
   - Review existing patterns in target area
   - Check for related tests to understand expected behavior

4. **Estimate Complexity**
   - Count files likely affected
   - Identify cross-cutting concerns
   - Check for breaking change potential

### Discovery Checkpoint (Tier 2+)

Present to user:
```markdown
## Issue Understanding

**Issue:** #<number> - <title>
**Type:** Bug / Enhancement / Feature
**Tier:** <1/2/3> based on <reason>

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

**Affected Areas:**
- <file/module 1>
- <file/module 2>

**Questions/Clarifications:**
- <any ambiguities>

Proceed with architecture planning? [Yes/No/Clarify]
```

---

## Phase 2: Architecture

**Goal:** Design the implementation approach.
**Agent:** `solution-architect`

### Steps

1. **Invoke Architect Agent**

   Use the Task tool to spawn the solution-architect agent:
   ```
   Task(subagent_type='solution-architect')

   Prompt: "Design implementation for issue #11 - Add Chrome-style tabs

   Acceptance criteria:
   - Dynamic tab sizing (min 80px, max 300px)
   - Dirty indicator for unsaved changes
   - Context menu (Close, Close Others, Close All)

   Affected areas:
   - src/renderer/src/components/Tabs/
   - DockviewReact tab components

   Existing patterns:
   - Review WelcomeTab.tsx for component structure
   - Check useProjectStore for state management

   Deliverable: Implementation plan with file changes, risks, and estimates."
   ```

2. **Produce Implementation Plan**
   Use template: `templates/implementation-plan.md`

3. **Identify Agent Needs**
   Based on issue type:
   - Feature: code-implementer (required)
   - Bug fix (complex): bug-investigator
   - Refactor: refactoring-advisor
   - Tests only: test-writer

4. **Plan Verification Gate** (Definition of Done - Tier 2+)

   BEFORE presenting plan to user, solution-architect verifies the plan:

   ```
   Task(subagent_type='solution-architect')

   Prompt: "Verify implementation plan for issue #<number>:

   Plan to verify:
   <include the generated implementation plan>

   Verification criteria:
   - Completeness: All acceptance criteria addressed?
   - Feasibility: Aligns with existing codebase patterns?
   - Risks: All risks identified with mitigations?
   - Testing: Strategy covers all changes adequately?
   - Dependencies: All affected files/modules identified?

   Report: [APPROVED / NEEDS REVISION]

   If NEEDS REVISION, provide specific issues to address."
   ```

   **Correction Loop (mandatory):**
   ```
   IF architect reports NEEDS REVISION:
     1. Address each identified issue
     2. Update the implementation plan
     3. Re-invoke solution-architect for verification
     4. Repeat until APPROVED

   ONLY proceed to user checkpoint after architect APPROVED.
   ```

   This gate ensures users only see architect-approved plans.

### Architecture Checkpoint (Tier 2+)

Present implementation plan to user:
```markdown
## Implementation Plan

**Approach:** <summary>

**Changes:**
1. <file>: <change description>
2. <file>: <change description>

**New Files:**
- <path>: <purpose>

**Tests Required:**
- <test type>: <coverage area>

**Risks:**
- <potential issue>

**Estimated Effort:** <time>

Approve plan? [Yes/Revise/Abort]
```

### Abort Criteria
- Issue is poorly scoped → Request issue refinement
- Requires breaking changes not labeled → Request label update
- Blocked by missing dependency → Document blocker

---

## Phase 3: Implementation

**Goal:** Write code and tests following the approved plan.
**Agents:** `code-implementer`, `test-writer`

### Steps

1. **Implementation with code-implementer**

   Use the Task tool to spawn the code-implementer agent:
   ```
   Task(subagent_type='code-implementer')

   Prompt: "Implement EditorTab component for issue #11

   Plan summary:
   - Create EditorTab.tsx with IDockviewPanelHeaderProps interface
   - Add EditorTab.css with dynamic sizing (80-300px flex)
   - Include dirty indicator, close button, context menu

   Files to create:
   - src/renderer/src/components/Tabs/EditorTab.tsx
   - src/renderer/src/components/Tabs/EditorTab.css

   Patterns to follow:
   - Use useProjectStore for dirty state
   - Use useDialog for confirmation
   - Follow WelcomeTab.tsx structure

   Include comprehensive tests."
   ```

2. **Write Tests (TDD-friendly)**
   - Write tests alongside or before implementation
   - Use `test-writer` for complex test scenarios
   - Target >80% coverage for new code

3. **Incremental Verification**
   ```bash
   npm run typecheck    # After each major change
   npm test             # Frequently
   ```

### Implementation Guidelines

- Follow existing patterns in codebase
- Keep changes focused on acceptance criteria
- NO scope creep ("while I'm here..." belongs in separate issue)
- Simple changes (<10 lines) don't need agent orchestration

### Agent Selection for Implementation

```
Issue Type → Agent
├── TypeScript code → code-implementer
├── Complex tests → test-writer
├── Bug diagnosis → bug-investigator
└── Code cleanup → refactoring-advisor
```

---

## Phase 4: Review

**Goal:** Validate code quality and catch issues early.
**Agent:** `code-reviewer`

### Steps

1. **Invoke Code Reviewer**

   Use the Task tool to spawn the code-reviewer agent:
   ```
   Task(subagent_type='code-reviewer')

   Prompt: "Review changes for issue #11 - Chrome-style tabs

   Changed files:
   - src/renderer/src/components/Tabs/EditorTab.tsx (new)
   - src/renderer/src/components/Tabs/EditorTab.css (new)
   - src/renderer/src/components/Tabs/useTabContextMenu.tsx (new)
   - src/renderer/src/components/ContextMenu/ContextMenu.tsx (modified)

   Focus areas:
   - Security (XSS in tooltips, event handling)
   - Performance (re-renders, memoization)
   - Accessibility (aria labels, keyboard navigation)
   - Test coverage adequacy"
   ```

2. **Review Categories**
   - Security vulnerabilities
   - Performance issues
   - Best practices compliance
   - Test coverage adequacy
   - Documentation completeness

3. **Address Findings**
   - Critical: Must fix before proceeding
   - Medium: Should fix, document if deferring
   - Low: Optional, can defer to follow-up issue

### Review Checkpoint (Tier 3)

Present findings to user:
```markdown
## Code Review Results

**Critical Issues:** <count>
- <issue 1>

**Medium Issues:** <count>
- <issue 1>

**Recommendations:**
- <suggestion>

Address all critical issues? [Yes/Defer with justification]
```

### Security Review (Tier 3 only)

For security-sensitive changes, verify:
- [ ] No path traversal vulnerabilities
- [ ] IPC handlers validate input
- [ ] No secrets in code
- [ ] CSP not weakened
- [ ] Dangerous protocols still blocked

---

## Phase 4.5: Implementation Verification Gate

**Goal:** Verify implementation matches approved plan before marking as complete.
**Agent:** `solution-architect`
**Skip for:** Tier 1 (trivial changes)

Implementation is NOT complete until architect verifies conformance. This is part of the **Definition of Done**.

### Steps

1. **Invoke Architect for Verification**

   After code review passes and all tests pass, verify implementation integrity:

   ```
   Task(subagent_type='solution-architect')

   Prompt: "Verify implementation for issue #<number> against approved plan:

   Approved plan summary:
   <include key points from the approved implementation plan>

   Implemented changes:
   <list of files changed/created>

   Verification criteria:
   - Plan conformance: Does the implementation match the approved design?
   - Acceptance criteria: All requirements from issue implemented?
   - Patterns: Codebase conventions and architecture followed?
   - Test coverage: All changes adequately tested?
   - Technical debt: Any shortcuts or deviations introduced?

   Report: [VERIFIED / NEEDS CORRECTION]

   If NEEDS CORRECTION, provide specific issues to address."
   ```

2. **Correction Loop (mandatory)**

   ```
   IF architect reports NEEDS CORRECTION:
     1. Re-invoke code-implementer to address specific issues
     2. Re-run tests (npm run test)
     3. Re-invoke code-reviewer if substantial changes were made
     4. Re-invoke solution-architect for verification
     5. Repeat until VERIFIED

   ONLY proceed to Documentation after architect VERIFIED.
   ```

### Implementation Verification Checkpoint (Tier 2+)

Present verification result to user:
```markdown
## Implementation Verification

**Status:** [VERIFIED / NEEDS CORRECTION]

**Plan Conformance:**
- <assessment of how well implementation matches plan>

**Deviations (if any):**
- <list any deviations from original plan>

**Recommendations:**
- <any suggestions for improvement>

[Proceed to Documentation / Address Issues]
```

### Definition of Done (Phase 4.5)

Before proceeding to Phase 5, ALL must be true:
- [ ] All tests pass
- [ ] Code review passed (Phase 4)
- [ ] **Architect verification: VERIFIED**

---

## Phase 5: Documentation

**Goal:** Update relevant documentation.
**Agent:** `project-documenter` (if significant changes), `docs-updater` (for simple fixes)

### Steps

1. **Determine Documentation Needs**
   - CLAUDE.md: Architectural changes, version updates
   - docs/: Feature documentation
   - README: User-facing changes
   - Inline comments: Complex logic

2. **Update CLAUDE.md**
   - Add to "Recent Changes" section
   - Update version if releasing
   - Update test count if changed

3. **Update Feature Docs**
   - Only if new user-facing feature
   - Follow existing doc patterns

### Documentation Guidelines

- Prefer inline code comments over external docs for implementation details
- Update test count in CLAUDE.md: `**Total: X tests passing (Y test files)**`
- Don't document obvious code

---

## Phase 6: User Acceptance Testing (UAT)

**Goal:** Verify changes work correctly in running application before committing.
**Skip for:** Tier 1 (trivial changes)

### Steps

1. **Build the Project**
   ```bash
   npm run build
   ```
   Verify build completes without errors.

2. **Start Development Server**
   ```bash
   npm run dev
   ```
   Launch the application for manual testing.

3. **Request Manual Testing**
   Ask user to manually test the implemented functionality against acceptance criteria.

### UAT Checkpoint (Tier 2+)

Present to user:
```markdown
## User Acceptance Testing

The application is running. Please manually test the changes.

**Acceptance Criteria to Verify:**
- [ ] Criterion 1
- [ ] Criterion 2

**How to test:**
1. [Step-by-step testing instructions]
2. [What to look for]

When finished, select an option:
```

**Options:**
- **UAT passed** - All acceptance criteria verified, proceed to finalization
- **Found issues** - Problems discovered during testing (please describe)
- **Skip UAT** - Skip manual testing (Tier 1 only)

### If Issues Found

1. Stop the dev server
2. Fix the reported issues
3. Re-run quality gates (`npm test`, `npm run typecheck`)
4. Restart UAT from Step 1

---

## Phase 7: Finalization

**Goal:** Pass quality gates and create commit.

### Quality Gates (Required)

```bash
npm run test        # All tests must pass
npm run typecheck   # No type errors
npm run lint        # No lint errors
```

### If Quality Gates Fail

1. **Tests fail:**
   - Check if failure is related to changes
   - If pre-existing: Document and continue (don't fix unrelated issues)
   - If new: Debug and fix

2. **Typecheck fails:**
   - Fix type errors in changed files
   - Don't modify types in unrelated files

3. **Lint fails:**
   - Auto-fix: `npm run lint -- --fix`
   - Manual fix remaining issues

### Finalization Checkpoint (All Tiers)

```markdown
## Ready to Commit

**Quality Gates:**
- [ ] Tests: PASS (<count> tests)
- [ ] Typecheck: PASS
- [ ] Lint: PASS

**Changes Summary:**
- <count> files changed
- <count> insertions, <count> deletions

**Commit Message:**
<type>: <description>

<body>

Closes #<number>

Create commit? [Yes/Adjust message/Abort]
```

### Commit Format

```bash
git add -A
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<body explaining what and why>

Closes #<number>
EOF
)"
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

### Branch Management Checkpoint

After commit succeeds, present options to user:

```markdown
## Branch Management

Commit created successfully. How would you like to proceed?
```

**Options:**
- **Merge to main and delete branch** - Recommended for completed work
- **Merge to main and keep branch** - If follow-up work expected on same branch
- **Push to remote only** - Keep on feature branch, create PR later
- **Local only** - Don't push or merge yet (manual handling)

### Branch Management Actions

Based on user selection:

**Merge to main and delete branch:**
```bash
git checkout main
git merge <branch-name>
git push origin main
git branch -d <branch-name>
git push origin --delete <branch-name>  # if remote branch exists
```

**Merge to main and keep branch:**
```bash
git checkout main
git merge <branch-name>
git push origin main
git checkout <branch-name>
```

**Push to remote only:**
```bash
git push -u origin <branch-name>
```

**Local only:**
No git operations performed. User handles manually.

---

## Phase 8: Release (Optional)

**Goal:** Prepare production release with user-friendly release notes.
**Agent:** `release-engineer`

Use this phase only when preparing an actual release (not for every issue).

### Steps

1. **Invoke Release Engineer**

   Use the Task tool to spawn the release-engineer agent:
   ```
   Task(subagent_type='release-engineer')

   Prompt: "Prepare release v0.4.3

   Previous release: v0.4.2
   Analyze commits since last release.
   Generate release notes in release/0.4.3/ folder.
   Follow v0.4.1 release notes format."
   ```

2. **Release Checklist**
   - [ ] Version bumped in package.json
   - [ ] Release notes generated
   - [ ] CLAUDE.md updated
   - [ ] All tests passing
   - [ ] Build completes successfully
   - [ ] Git tag created

### Release Notes Format

Follow the established format from `release/0.4.1/erfana-0.4.1-release-notes.md`:
- User-friendly language (not technical jargon)
- "What's New" section with feature benefits
- "Bug Fixes" section
- "Technical Details" with test count and build info

---

## Abort Procedure

If implementation cannot continue:

1. **Document Reason**
   ```bash
   gh issue comment <number> --body "Implementation paused: <reason>"
   ```

2. **Clean Up Working Directory**
   ```bash
   git checkout .                    # Discard changes
   git clean -fd                     # Remove untracked files
   ```

3. **Clean Up Branch (if created)**
   ```bash
   # Only if you created a feature branch
   git checkout main
   git branch -D fix/<number>-<description>
   ```

4. **Update Issue**
   - Remove self-assignment
   - Add findings that may help next attempt
   - Suggest issue refinements if needed

### When to Abort
- Blocker discovered mid-implementation
- Scope significantly larger than estimated
- Breaking changes require broader team input
- Security concerns need expert review

---

## Anti-Patterns

### DO NOT:

1. **Scope Creep**
   - Adding features not in acceptance criteria
   - "While I'm here..." changes (create separate issue)

2. **Premature Optimization**
   - Performance work without benchmarks
   - Over-engineering simple solutions

3. **Test Pollution**
   - Modifying unrelated tests
   - Replacing tests instead of adding

4. **Agent Overuse**
   - Using agents for <10 line changes
   - Multiple agents when one suffices

5. **Checkpoint Gaming**
   - Rushing approvals without review
   - "Looks good" without verification

6. **Undocumented Breaking Changes**
   - Changing public APIs without migration guide
   - Removing features without deprecation

---

## Examples

### Example 1: Trivial Issue (Tier 1)

**Issue:** #42 - Fix typo in README
```
1. Pre-flight: Check issue is open ✓
2. Skip Discovery, Architecture, Architecture Verification, Review, UAT
3. Implementation: Fix typo directly
4. Finalization: Run lint, commit
   "docs: fix typo in README - Closes #42"
   → Checkpoint: Approve commit
   → Checkpoint: Branch management (usually "Local only" for trivial)
```

### Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs
```
1. Pre-flight: Verify environment ✓
2. Discovery: Understand DockviewReact tabs, identify components
   → Checkpoint: Confirm understanding
3. Architecture: Design EditorTab component, context menu
   → Plan Verification Gate: Architect verifies plan → APPROVED
   → Checkpoint: Present approved plan to user → Approve plan
4. Implementation: Create EditorTab.tsx, CSS, tests
5. Review: code-reviewer checks quality
6. Arch Verification: Architect verifies implementation matches plan
   → Verification Gate: solution-architect confirms → VERIFIED
   → Checkpoint: Present verification to user → Proceed
7. Documentation: Update CLAUDE.md changelog
8. UAT: Build project, run dev server
   → Checkpoint: User tests manually, selects "UAT passed"
9. Finalization: Pass quality gates, commit
   → Checkpoint: Approve commit
   → Checkpoint: Select "Merge to main and delete branch"
```

### Example 3: Complex Security Issue (Tier 3)

**Issue:** #99 - Add path traversal protection
```
1. Pre-flight: Verify environment ✓
2. Discovery: Analyze all file operations
   → Checkpoint: Confirm scope
3. Architecture: Design pathSecurity.ts module
   → Plan Verification Gate: Architect verifies plan → APPROVED
   → Checkpoint: Approve security approach
4. Implementation: Implement with comprehensive tests
5. Review: code-reviewer + security checklist
   → Checkpoint: Approve security review
6. Documentation: Update security docs
7. UAT: Build, run dev, test path traversal scenarios
   → Checkpoint: User verifies security, selects "UAT passed"
8. Finalization: All quality gates + security gates
   → Checkpoint: Approve commit
   → Checkpoint: Select "Merge to main and delete branch"
```

---

## Reference

See `agents-reference.md` for:
- Complete agent capabilities
- Agent selection decision tree
- When NOT to use agents
