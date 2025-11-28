---
name: implementing-issues
description: Implement GitHub issues through structured phases with specialized agents and human checkpoints. Supports 3 complexity tiers (trivial/standard/complex) with appropriate checkpoint levels. Requires GitHub issue number. Use when working on an issue, 'implement #N', 'fix issue #N', or 'work on issue'.
---

# Implementing GitHub Issues

This skill guides the complete implementation of GitHub issues through structured phases, orchestrating specialized agents with human checkpoints at critical decision points.

## CRITICAL RULES

- MUST create TodoWrite list at skill start (see Progress Tracking)
- MUST NOT skip security scan (Phase 4)
- MUST NOT commit without quality gates passing
- STOP if any pre-flight check fails

## When to Use This Skill

Use `implementing-issues` when:
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

## Progress Tracking (MANDATORY)

**At skill start, create todo list with all applicable phases:**

```
TodoWrite([
  {content: "Phase 0: Pre-flight checks", status: "in_progress", activeForm: "Running pre-flight checks"},
  {content: "Phase 1: Discovery", status: "pending", activeForm: "Discovering codebase"},
  {content: "Phase 2: Architecture", status: "pending", activeForm: "Designing architecture"},
  {content: "Phase 3: Implementation", status: "pending", activeForm: "Implementing code"},
  {content: "Phase 4: Security scan", status: "pending", activeForm: "Scanning for security issues"},
  {content: "Phase 5: Review", status: "pending", activeForm: "Reviewing code"},
  {content: "Phase 6: Verification", status: "pending", activeForm: "Verifying implementation"},
  {content: "Phase 7: Documentation", status: "pending", activeForm: "Updating documentation"},
  {content: "Phase 8: UAT", status: "pending", activeForm: "Running acceptance tests"},
  {content: "Phase 9: Finalization", status: "pending", activeForm: "Finalizing commit"},
  {content: "Phase 10: Release (optional)", status: "pending", activeForm: "Preparing release"}
])
```

**Rules:**
- Mark phase `in_progress` BEFORE starting
- Mark phase `completed` IMMEDIATELY after quality gate passes
- Only ONE phase should be `in_progress` at a time
- Skip phases per tier (Tier 1 skips Discovery, Architecture, etc.)

---

## Phase Overview

| Phase | Purpose | Agent(s) | Checkpoint |
|-------|---------|----------|------------|
| 0. Pre-flight | Validate environment | - | - |
| 1. Discovery | Understand issue & codebase | codebase-explorer | Tier 2+ |
| 2. Architecture | Design solution + verify plan | solution-architect | Tier 2+ |
| 3. Implementation | Write code + tests | code-implementer, test-writer | - |
| 4. Security | Shift-left security check | security-auditor (Tier 3) | All tiers |
| 5. Review | Code quality check | code-reviewer | Tier 3 |
| 6. Verification | Verify implementation matches plan | solution-architect | Tier 2+ |
| 7. Documentation | Update docs | project-documenter | - |
| 8. UAT | Manual testing | - | Tier 2+ |
| 9. Finalization | Quality gates, commit, branch | diff-summarizer | All tiers |
| 10. Release (optional) | Production release | release-engineer | When releasing |

---

## Complexity Tiers

Determine tier from issue labels:

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Checkpoints:** Security Scan, Before Commit (2 total)
**Skip phases:** Discovery, Architecture, Verification, Review, UAT
**Security:** Basic scan required (npm audit, secret detection)
**Estimated time:** 15-30 minutes

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, or unlabeled
**Checkpoints:** After Discovery, After Architecture (with plan verification), Security Scan, After Verification, After UAT, Before Commit (6 total)
**Verification gates:** Plan verification (Phase 2), Implementation verification (Phase 6)
**Security:** Full security scan required
**Estimated time:** 30 minutes - 2 hours

### Tier 3: Complex
**Labels:** `breaking-change`, `architecture`, `security`, `major`
**Checkpoints:** All phases (8 total)
**Verification gates:** Plan verification (Phase 2), Implementation verification (Phase 6)
**Security:** Full security scan + security-auditor agent review + OWASP verification
**Estimated time:** 2+ hours

---

## Phases

### Phase 0: Pre-flight
**Goal:** Validate environment and create feature branch.
**Checkpoint:** Pre-flight checklist passed
**Details:** See `phases/0-preflight.md`

**Quick checklist:**
- [ ] Issue exists and is OPEN
- [ ] No `blocked` label
- [ ] Tests pass on current branch
- [ ] No uncommitted changes
- [ ] **Feature branch created** (e.g., `git checkout -b fix/11-short-description`)

**Abort if:** Issue closed, blocked, baseline tests fail, uncommitted changes exist.

---

### Phase 1: Discovery (Tier 2+)
**Goal:** Understand issue and affected codebase.
**Agent:** codebase-explorer
**Checkpoint:** Issue understanding confirmed
**Details:** See `phases/1-discovery.md`

**Deliverable:** Issue understanding report with acceptance criteria, affected areas, complexity estimate.

---

### Phase 2: Architecture (Tier 2+)
**Goal:** Design implementation approach with verification.
**Agent:** solution-architect
**Checkpoint:** Plan approved by user
**Details:** See `phases/2-architecture.md`

**Steps:**
1. Invoke solution-architect to create implementation plan
2. **Plan Verification Gate:** Architect verifies plan completeness/feasibility → Must get APPROVED
3. Present approved plan to user for final approval
4. Only proceed after user approval

**Deliverable:** Implementation plan (file changes, tests, risks, estimates).

---

### Phase 3: Implementation
**Goal:** Write code and tests following approved plan.
**Agents:** code-implementer, test-writer
**Checkpoint:** Tests passing, typecheck clean
**Details:** See `phases/3-implementation.md`

**Guidelines:**
- Follow existing codebase patterns
- Keep changes focused on acceptance criteria
- No scope creep ("while I'm here..." belongs in separate issue)
- Target >80% coverage for new code

---

### Phase 4: Security (All Tiers)
**Goal:** Catch security issues early.
**Agent:** security-auditor (Tier 3)
**Checkpoint:** Security checklist passed
**Details:** See `phases/4-security.md`

**All Tiers Checklist:**
- [ ] `npm audit` reports no high/critical vulnerabilities
- [ ] No secrets or API keys in committed code
- [ ] No new dangerous dependencies added
- [ ] User input properly validated at entry points

**Tier 3 Additional:**
- [ ] Full `security-auditor` agent review
- [ ] OWASP Top 10 verification
- [ ] Path traversal protection verified
- [ ] IPC handlers validate all input

**STOP if critical/high vulnerabilities found.**

---

### Phase 5: Review (Tier 3)
**Goal:** Validate code quality.
**Agent:** code-reviewer
**Checkpoint:** Critical issues addressed
**Details:** See `phases/5-review.md`

**Review categories:** Security, performance, best practices, test coverage, documentation.

**Action required:** Fix all critical issues before proceeding.

---

### Phase 6: Verification (Tier 2+)
**Goal:** Verify implementation matches approved plan.
**Agent:** solution-architect
**Checkpoint:** Architect confirms VERIFIED
**Details:** See `phases/6-verification.md`

**Steps:**
1. Invoke solution-architect to verify implementation against approved plan
2. **Verification Gate:** Architect checks plan conformance, acceptance criteria, patterns, tests
3. If NEEDS CORRECTION: Fix issues → Re-verify (loop until VERIFIED)
4. Only proceed after architect reports VERIFIED

**Definition of Done:**
- [ ] All tests pass
- [ ] Code review passed (Phase 5)
- [ ] **Architect verification: VERIFIED**

---

### Phase 7: Documentation
**Goal:** Update relevant documentation.
**Agent:** project-documenter
**Checkpoint:** CLAUDE.md updated
**Details:** See `phases/7-documentation.md`

**Checklist:**
- [ ] CLAUDE.md "Recent Changes" updated
- [ ] Test count updated: `**Total: X tests passing (Y test files)**`
- [ ] New public APIs have JSDoc/TSDoc
- [ ] Complex logic has inline comments
- [ ] Feature docs updated (if user-facing change)

---

### Phase 8: UAT (Tier 2+)
**Goal:** Manual testing by user.
**Checkpoint:** User confirms acceptance criteria
**Details:** See `phases/8-uat.md`

**Steps:**
1. Build project: `npm run build`
2. Start dev server: `npm run dev`
3. Request user to test against acceptance criteria
4. Options: **UAT passed** / **Found issues** / **Skip UAT** (Tier 1 only)

---

### Phase 9: Finalization (All Tiers)
**Goal:** Pass quality gates, create commit, manage branch.
**Agent:** diff-summarizer
**Checkpoint:** Quality gates pass, commit approved
**Details:** See `phases/9-finalization.md`

**Quality Gates (Required):**
```bash
npm run test        # All tests must pass
npm run typecheck   # No type errors
npm run lint        # No lint errors
```

**Commit Format:**
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

**Branch Management Options:**
- **Merge to main and delete branch** - Recommended
- **Merge to main and keep branch** - If follow-up work expected
- **Push to remote only** - Create PR later
- **Local only** - Manual handling

---

### Phase 10: Release (Optional)
**Goal:** Prepare production release.
**Agent:** release-engineer
**Checkpoint:** Release notes approved
**Details:** See `phases/10-release.md`

**Use only when preparing actual release (not for every issue).**

**Release Checklist:**
- [ ] Version bumped in package.json
- [ ] Release notes generated
- [ ] CLAUDE.md updated
- [ ] All tests passing
- [ ] Build completes successfully
- [ ] Git tag created

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

3. **Clean Up Feature Branch**
   ```bash
   git checkout main
   git branch -D fix/<number>-<description>
   git push origin --delete fix/<number>-<description>  # if pushed to remote
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
1. Pre-flight: Check issue is open, create branch ✓
   git checkout -b docs/42-fix-readme-typo
2. Skip Discovery, Architecture, Verification, Review, UAT
3. Implementation: Fix typo directly
4. Security (Phase 4): npm audit, secret check → Pass
5. Finalization (Phase 9): Run lint, commit
   "docs: fix typo in README - Closes #42"
   → Checkpoint: Approve commit
   → Checkpoint: Branch management (select "Merge to main and delete branch")
```

### Example 2: Standard Feature (Tier 2)

**Issue:** #11 - Add Chrome-style tabs
```
1. Pre-flight (Phase 0): Verify environment, create branch ✓
   git checkout -b feat/11-chrome-style-tabs
2. Discovery (Phase 1): Understand DockviewReact tabs, identify components
   → Checkpoint: Confirm understanding
3. Architecture (Phase 2): Design EditorTab component, context menu
   → Plan Verification Gate: Architect verifies plan → APPROVED
   → Checkpoint: Present approved plan to user → Approve plan
4. Implementation (Phase 3): Create EditorTab.tsx, CSS, tests
5. Security (Phase 4): Full security scan → Pass
6. Review (Phase 5): Skipped (Tier 2)
7. Verification (Phase 6): Architect verifies implementation matches plan
   → Verification Gate: solution-architect confirms → VERIFIED
   → Checkpoint: Present verification to user → Proceed
8. Documentation (Phase 7): Update CLAUDE.md changelog
9. UAT (Phase 8): Build project, run dev server
   → Checkpoint: User tests manually, selects "UAT passed"
10. Finalization (Phase 9): Pass quality gates, commit
    → Checkpoint: Approve commit
    → Checkpoint: Select "Merge to main and delete branch"
```

### Example 3: Complex Security Issue (Tier 3)

**Issue:** #99 - Add path traversal protection
```
1. Pre-flight (Phase 0): Verify environment, create branch ✓
   git checkout -b fix/99-path-traversal-protection
2. Discovery (Phase 1): Analyze all file operations
   → Checkpoint: Confirm scope
3. Architecture (Phase 2): Design pathSecurity.ts module
   → Plan Verification Gate: Architect verifies plan → APPROVED
   → Checkpoint: Approve security approach
4. Implementation (Phase 3): Implement with comprehensive tests
5. Security (Phase 4): Full scan + security-auditor agent + OWASP
   → Pass all security gates
6. Review (Phase 5): code-reviewer + security checklist
   → Checkpoint: Approve security review
7. Verification (Phase 6): Architect verifies implementation matches plan
   → Verification Gate: solution-architect confirms → VERIFIED
   → Checkpoint: Present verification to user → Proceed
8. Documentation (Phase 7): Update security docs
9. UAT (Phase 8): Build, run dev, test path traversal scenarios
   → Checkpoint: User verifies security, selects "UAT passed"
10. Finalization (Phase 9): All quality gates + security gates
    → Checkpoint: Approve commit
    → Checkpoint: Select "Merge to main and delete branch"
```

---

## Reference

- **Phase Guides:** See `phases/` directory for detailed instructions
- **Agent Reference:** See `agents-reference.md` for agent capabilities
- **Templates:** See `templates/` directory

## Architecture Note

This skill is an **orchestrator** that delegates work to built-in system agents via `Task(subagent_type='...')`. It does NOT have a dedicated `agents/` directory because it uses Claude Code's built-in agents:

- `codebase-explorer` - Fast codebase navigation
- `solution-architect` - System design and planning
- `code-implementer` - Write production code
- `test-writer` - Create tests
- `code-reviewer` - Pre-commit review
- `security-auditor` - Security analysis
- `project-documenter` - Documentation updates
- `diff-summarizer` - Commit messages
- `release-engineer` - Release preparation

This is a valid pattern for skills that orchestrate reusable system capabilities.
