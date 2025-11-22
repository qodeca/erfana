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
| 1. Discovery | Understand issue & codebase | - | Tier 2+ |
| 2. Architecture | Design solution | architect-reviewer | Tier 2+ |
| 3. Implementation | Write code + tests | typescript-pro, test-automator | - |
| 4. Review | Code quality check | code-reviewer | Tier 3 |
| 5. Documentation | Update docs | documentation-engineer | - |
| 6. Finalization | Quality gates, commit | - | All tiers |

---

## Complexity Tiers

Determine tier from issue labels:

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Checkpoints:** Before Commit only (1 total)
**Skip phases:** Architecture, Review
**Estimated time:** 15-30 minutes

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, or unlabeled
**Checkpoints:** After Discovery, After Architecture, Before Commit (3 total)
**Estimated time:** 30 minutes - 2 hours

### Tier 3: Complex
**Labels:** `breaking-change`, `architecture`, `security`, `major`
**Checkpoints:** All phases (5 total)
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
**Agent:** `architect-reviewer`

### Steps

1. **Invoke Architect Agent**

   Use the Task tool to spawn the architect-reviewer agent:
   ```
   Task(subagent_type='architect-reviewer')

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
   - Feature: typescript-pro (required)
   - Bug fix (complex): error-detective
   - Refactor: refactoring-specialist
   - Tests only: test-automator

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
**Agents:** `typescript-pro`, `test-automator`

### Steps

1. **Implementation with typescript-pro**

   Use the Task tool to spawn the typescript-pro agent:
   ```
   Task(subagent_type='typescript-pro')

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
   - Use `test-automator` for complex test scenarios
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
├── TypeScript code → typescript-pro
├── CLI/scripts → cli-developer
├── Complex tests → test-automator
├── Bug diagnosis → error-detective
└── Code cleanup → refactoring-specialist
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

## Phase 5: Documentation

**Goal:** Update relevant documentation.
**Agent:** `documentation-engineer` (if significant changes)

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

## Phase 6: Finalization

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
2. Skip Discovery, Architecture, Review
3. Implementation: Fix typo directly
4. Finalization: Run lint, commit
   "docs: fix typo in README - Closes #42"
```

### Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs
```
1. Pre-flight: Verify environment ✓
2. Discovery: Understand DockviewReact tabs, identify components
   → Checkpoint: Confirm understanding
3. Architecture: Design EditorTab component, context menu
   → Checkpoint: Approve plan
4. Implementation: Create EditorTab.tsx, CSS, tests
5. Review: code-reviewer checks quality
6. Documentation: Update CLAUDE.md changelog
7. Finalization: Pass quality gates
   → Checkpoint: Approve commit
```

### Example 3: Complex Security Issue (Tier 3)

**Issue:** #99 - Add path traversal protection
```
1. Pre-flight: Verify environment ✓
2. Discovery: Analyze all file operations
   → Checkpoint: Confirm scope
3. Architecture: Design pathSecurity.ts module
   → Checkpoint: Approve security approach
4. Implementation: Implement with comprehensive tests
5. Review: code-reviewer + security checklist
   → Checkpoint: Approve security review
6. Documentation: Update security docs
7. Finalization: All quality gates + security gates
   → Checkpoint: Final approval
```

---

## Reference

See `agents-reference.md` for:
- Complete agent capabilities
- Agent selection decision tree
- When NOT to use agents
