---
name: implementing-issues
version: 1.0.0
status: active
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
  {content: "Phase 1: Business Analysis", status: "pending", activeForm: "Researching prior art and clarifying requirements"},
  {content: "Phase 2: Discovery", status: "pending", activeForm: "Discovering codebase"},
  {content: "Phase 3: Architecture", status: "pending", activeForm: "Designing architecture"},
  {content: "Phase 4: Implementation", status: "pending", activeForm: "Implementing code"},
  {content: "Phase 5: Architectural Review", status: "pending", activeForm: "Reviewing architecture quality"},
  {content: "Phase 6: Security scan", status: "pending", activeForm: "Scanning for security issues"},
  {content: "Phase 7: Implementation Quality Review", status: "pending", activeForm: "Reviewing code quality"},
  {content: "Phase 8: Verification", status: "pending", activeForm: "Verifying implementation"},
  {content: "Phase 9: Documentation", status: "pending", activeForm: "Updating documentation"},
  {content: "Phase 10: UAT", status: "pending", activeForm: "Running acceptance tests"},
  {content: "Phase 11: Finalization", status: "pending", activeForm: "Finalizing commit"},
  {content: "Phase 12: Release (optional)", status: "pending", activeForm: "Preparing release"}
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
| 1. Business Analysis | Research prior art + clarify requirements | analyze-requirements | Tier 2+ |
| 2. Discovery | Understand issue & codebase | explore-codebase | Tier 2+ |
| 3. Architecture | Design solution + verify plan | design-solution | Tier 2+ |
| 4. Implementation | Write code + tests | implement-code, write-tests | - |
| 5. Architectural Review | Validate SOLID, patterns, structure | review-architecture | Tier 2+ |
| 6. Security | Shift-left security check | audit-security (Tier 3) | All tiers |
| 7. Quality Review | Comprehensive code quality review | review-code | Tier 2+ |
| 8. Verification | Verify implementation matches plan | design-solution | Tier 2+ |
| 9. Documentation | Update docs | update-docs | - |
| 10. UAT | Manual testing | - | Tier 2+ |
| 11. Finalization | Quality gates, commit, branch | summarize-diff | All tiers |
| 12. Release (optional) | Production release | prepare-release | When releasing |

---

## Complexity Tiers

Determine tier from issue labels:

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Checkpoints:** Security Scan, Before Commit (2 total)
**Skip phases:** 2-Discovery, 3-Architecture, 5-Architectural Review, 7-Quality Review, 8-Verification, 10-UAT
**Business Analysis:** Quick mode (1-2 searches, 1-2 questions, no checkpoint)
**Security:** Basic scan required (npm audit, secret detection)
**Estimated time:** 15-30 minutes

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, or unlabeled
**Checkpoints:** After phases 1, 2, 3, 5, 6, 7, 8, 10, 11 (9 total)
**Business Analysis:** Standard mode (3-5 searches, 3-5 questions, checkpoint required)
**Review gates:** Architectural Review (Phase 5), Quality Review (Phase 7)
**Verification gates:** Plan verification (Phase 3), Implementation verification (Phase 8)
**Security:** Full security scan required
**Estimated time:** 30 minutes - 2 hours

### Tier 3: Complex
**Labels:** `breaking-change`, `architecture`, `security`, `major`
**Checkpoints:** All phases (11 total)
**Business Analysis:** Comprehensive mode (5-8 searches, 5-8 questions, checkpoint required)
**Review gates:** Deep Architectural Review (Phase 5), Deep Quality Review (Phase 7)
**Verification gates:** Plan verification (Phase 3), Implementation verification (Phase 8)
**Security:** Full security scan + security-auditor agent review + OWASP verification
**Estimated time:** 2+ hours

---

## Phases

### Phase 0: Pre-flight
**Goal:** Validate environment and create feature branch.
**Checkpoint:** Pre-flight checklist passed
**Details:** See [phases/0-preflight.md](phases/0-preflight.md)

**Quick checklist:**
- [ ] Issue exists and is OPEN
- [ ] No `blocked` label
- [ ] Tests pass on current branch
- [ ] No uncommitted changes
- [ ] **Feature branch created** (e.g., `git checkout -b fix/11-short-description`)

**Abort if:** Issue closed, blocked, baseline tests fail, uncommitted changes exist.

---

### Phase 1: Business Analysis (All Tiers)
**Goal:** Research prior art and clarify requirements before exploring codebase.
**Agent:** analyze-requirements
**Checkpoint:** Research findings + requirements confirmed (Tier 2+)
**Details:** See [phases/1-business-analysis.md](phases/1-business-analysis.md)

**Steps:**
1. Classify issue type (bug/enhancement/feature/security/refactor)
2. Research prior art (libraries, patterns, similar implementations)
3. Present requirements questionnaire (tier-appropriate depth)
4. Validate acceptance criteria completeness
5. Document scope boundaries and risks

**Tier Variations:**
- **Tier 1:** Quick mode (1-2 searches, 1-2 questions, no checkpoint)
- **Tier 2:** Standard mode (3-5 searches, 3-5 questions, checkpoint required)
- **Tier 3:** Comprehensive mode (5-8 searches, 5-8 questions, checkpoint required)

**Deliverable:** Research summary + requirements clarification document

---

### Phase 2: Discovery (Tier 2+)
**Goal:** Understand issue and affected codebase.
**Agent:** explore-codebase
**Checkpoint:** Issue understanding confirmed
**Details:** See [phases/2-discovery.md](phases/2-discovery.md)

**Deliverable:** Issue understanding report with acceptance criteria, affected areas, complexity estimate.

---

### Phase 3: Architecture (Tier 2+)
**Goal:** Design implementation approach with verification.
**Agent:** design-solution
**Checkpoint:** Plan approved by user
**Details:** See [phases/3-architecture.md](phases/3-architecture.md)

**Steps:**
1. Invoke design-solution to create implementation plan
2. **Plan Verification Gate:** Architect verifies plan completeness/feasibility → Must get APPROVED
3. Present approved plan to user for final approval
4. Only proceed after user approval

**Deliverable:** Implementation plan (file changes, tests, risks, estimates).

---

### Phase 4: Implementation
**Goal:** Write code and tests following approved plan.
**Agents:** implement-code, write-tests
**Checkpoint:** Tests passing, typecheck clean
**Details:** See [phases/4-implementation.md](phases/4-implementation.md)

**Guidelines:**
- Follow existing codebase patterns
- Keep changes focused on acceptance criteria
- No scope creep ("while I'm here..." belongs in separate issue)
- Target >80% coverage for new code

---

### Phase 5: Architectural Review (Tier 2+)
**Goal:** Validate architectural quality of implemented code.
**Agent:** review-architecture
**Checkpoint:** Architectural assessment approved
**Details:** See [phases/5-architectural-review.md](phases/5-architectural-review.md)

**Steps:**
1. Invoke review-architecture agent to analyze implemented code
2. Evaluate SOLID principles adherence
3. Assess coupling and cohesion
4. Check design pattern usage
5. Verify dependency directions
6. Present findings to user (if issues found)

**Key Evaluations:**
| Principle | Assessment |
|-----------|------------|
| Single Responsibility | Each component has ONE reason to change |
| Open/Closed | Extensible without modification |
| Liskov Substitution | Subtypes replaceable |
| Interface Segregation | Minimal, focused interfaces |
| Dependency Inversion | Depend on abstractions |

**Deliverable:** Architectural assessment with SOLID analysis, coupling/cohesion scores, and recommendations.

---

### Phase 6: Security (All Tiers)
**Goal:** Catch security issues early.
**Agent:** audit-security (Tier 3)
**Checkpoint:** Security checklist passed
**Details:** See [phases/6-security.md](phases/6-security.md)

**All Tiers Checklist:**
- [ ] `npm audit` reports no high/critical vulnerabilities
- [ ] No secrets or API keys in committed code
- [ ] No new dangerous dependencies added
- [ ] User input properly validated at entry points

**Tier 3 Additional:**
- [ ] Full `audit-security` agent review
- [ ] OWASP Top 10 verification
- [ ] Path traversal protection verified
- [ ] IPC handlers validate all input

**STOP if critical/high vulnerabilities found.**

---

### Phase 7: Quality Review (Tier 2+)
**Goal:** Comprehensive code quality assessment.
**Agent:** review-code
**Checkpoint:** Quality metrics pass thresholds
**Details:** See [phases/7-review.md](phases/7-review.md)

**Review Categories (Expanded):**
| Category | Tier 2 | Tier 3 |
|----------|--------|--------|
| Security vulnerabilities | Basic | Deep |
| Performance issues | Standard | Profiled |
| Code smell detection | 5 core smells | 12+ smells |
| Complexity analysis | Cyclomatic | + Cognitive |
| Maintainability scoring | Yes | Yes |
| Test quality assessment | Basic | Deep |
| Readability evaluation | Yes | Yes |

**Quality Thresholds:**
- Maintainability score: ≥60/100
- Cyclomatic complexity: <15 per function
- Test coverage: >70% (Tier 2), >80% (Tier 3)

**Action required:** Fix all critical and high severity issues before proceeding.

---

### Phase 8: Verification (Tier 2+)
**Goal:** Verify implementation matches approved plan.
**Agent:** design-solution
**Checkpoint:** Architect confirms VERIFIED
**Details:** See [phases/8-verification.md](phases/8-verification.md)

**Steps:**
1. Invoke design-solution to verify implementation against approved plan
2. **Verification Gate:** Architect checks plan conformance, acceptance criteria, patterns, tests
3. If NEEDS CORRECTION: Fix issues → Re-verify (loop until VERIFIED)
4. Only proceed after architect reports VERIFIED

**Definition of Done:**
- [ ] All tests pass
- [ ] Code review passed (Phase 7)
- [ ] **Architect verification: VERIFIED**

---

### Phase 9: Documentation
**Goal:** Update relevant documentation.
**Agent:** update-docs
**Checkpoint:** CLAUDE.md updated
**Details:** See [phases/9-documentation.md](phases/9-documentation.md)

**Checklist:**
- [ ] CLAUDE.md "Recent Changes" updated
- [ ] Test count updated: `**Total: X tests passing (Y test files)**`
- [ ] New public APIs have JSDoc/TSDoc
- [ ] Complex logic has inline comments
- [ ] Feature docs updated (if user-facing change)

---

### Phase 10: UAT (Tier 2+)
**Goal:** Manual testing by user.
**Checkpoint:** User confirms acceptance criteria
**Details:** See [phases/10-uat.md](phases/10-uat.md)

**Steps:**
1. Build project: `npm run build`
2. Start dev server: `npm run dev`
3. Request user to test against acceptance criteria
4. Options: **UAT passed** / **Found issues** / **Skip UAT** (Tier 1 only)

---

### Phase 11: Finalization (All Tiers)
**Goal:** Pass quality gates, create commit, manage branch.
**Agent:** summarize-diff
**Checkpoint:** Quality gates pass, commit approved
**Details:** See [phases/11-finalization.md](phases/11-finalization.md)

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

### Phase 12: Release (Optional)
**Goal:** Prepare production release.
**Agent:** prepare-release
**Checkpoint:** Release notes approved
**Details:** See [phases/12-release.md](phases/12-release.md)

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

See `examples.md` for detailed walkthroughs of each tier:

| Example | Tier | Checkpoints | Key Phases |
|---------|------|-------------|------------|
| Fix typo in README | 1 | 2 | Pre-flight → Implementation → Security → Finalization |
| Add Chrome-style tabs | 2 | 7 | All except Review |
| Path traversal protection | 3 | 9 | All phases |

---

## Reference

- **Phase Guides:** See [phases/](phases/) directory for detailed instructions
- **Agent Reference:** See [agents-reference.md](agents-reference.md) for agent capabilities
- **Templates:** See [templates/](templates/) directory

## Architecture Note

This skill is an **orchestrator** that uses specialized agents for each phase.

### Embedded Agents

All agents are self-contained in `agents/` directory with full execution logic:

| Agent | Purpose |
|-------|---------|
| analyze-requirements | Prior art research + requirements clarification |
| explore-codebase | Find files and patterns related to issue |
| design-solution | Create and verify implementation plans |
| implement-code | Write production code following plan |
| write-tests | Create tests with >80% coverage |
| **review-architecture** | SOLID principles, coupling/cohesion, patterns analysis |
| review-code | Pre-commit quality review with code smells and maintainability |
| audit-security | Security scan and OWASP verification |
| update-docs | Update CLAUDE.md and docs |
| summarize-diff | Generate commit messages |
| prepare-release | Prepare production releases |
| investigate-bug | Root cause analysis |
| advise-refactor | Code smell detection |
| fix-docs | Quick documentation fixes |

Each agent defines: Input/output contracts, execution steps using tools, quality gates, error handling.
