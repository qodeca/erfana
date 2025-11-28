# Operation: Implement

Implement GitHub issues through structured phases with specialized agents and human checkpoints.

---

## Overview

| Attribute | Value |
|-----------|-------|
| Phases | 13 (0-12) |
| Tiers | 2 (Trivial, Standard) |
| Agents | 14 specialized agents |
| Checkpoints | 2-10 depending on tier |

---

## When to Use

Activate when user:
- Is assigned a GitHub issue to implement
- Says "implement", "fix", or "work on" an issue
- Needs structured workflow with quality checkpoints
- Wants agent-assisted architecture and review

**Trigger phrases:**
- "Implement issue #123"
- "Work on #45"
- "Fix this GitHub issue"
- "Let's tackle issue #99"

---

## Prerequisites

- [ ] GitHub CLI (`gh`) installed and authenticated
- [ ] Git repository cloned locally
- [ ] Node.js and npm available
- [ ] Project uses conventional commits

---

## Complexity Tiers

Determine tier from issue labels:

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Checkpoints:** 2 (Security Scan, Before Commit)
**Skip phases:** 2-Discovery, 3-Architecture, 5-Architectural Review, 7-Quality Review, 8-Verification, 10-UAT
**Business Analysis:** Quick mode (1-2 searches, no checkpoint)

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, `breaking-change`, `architecture`, `security`, `major`, or unlabeled
**Checkpoints:** 10 (all phases)
**Business Analysis:** Comprehensive mode (5-8 searches, checkpoint required)
**Review gates:** Deep Architectural Review (Phase 5), Deep Quality Review (Phase 7)
**Verification gates:** Plan verification (Phase 3), Implementation verification (Phase 8)

---

## Phase Overview

| Phase | Purpose | Agent(s) | Tier 1 | Tier 2 |
|-------|---------|----------|--------|--------|
| 0. Pre-flight | Validate environment | - | Yes | Yes |
| 1. Business Analysis | Research + requirements | analyze-requirements | Quick | Full |
| 2. Discovery | Understand codebase | explore-codebase | Skip | Yes |
| 3. Architecture | Design solution | design-solution | Skip | Yes |
| 4. Implementation | Write code + tests | implement-code, write-tests | Yes | Yes |
| 5. Architectural Review | Validate SOLID | review-architecture | Skip | Yes |
| 6. Security | Security check | audit-security | Basic | Full |
| 7. Quality Review | Code quality | review-code | Skip | Yes |
| 8. Verification | Verify vs plan | design-solution | Skip | Yes |
| 9. Documentation | Update docs | update-docs | Yes | Yes |
| 10. UAT | Manual testing | - | Skip | Yes |
| 11. Finalization | Quality gates, commit | summarize-diff | Yes | Yes |
| 12. Release | Production release | prepare-release | Optional | Optional |

---

## Phases

### Phase 0: Pre-flight
**Goal:** Validate environment and create feature branch.
**Details:** See [phases/0-preflight.md](../phases/0-preflight.md)

**Quick checklist:**
- [ ] Issue exists and is OPEN
- [ ] No `blocked` label
- [ ] Tests pass on current branch
- [ ] No uncommitted changes
- [ ] Feature branch created (e.g., `git checkout -b fix/11-short-description`)

**Abort if:** Issue closed, blocked, baseline tests fail, uncommitted changes.

---

### Phase 1: Business Analysis
**Goal:** Research prior art and clarify requirements.
**Agent:** analyze-requirements
**Details:** See [phases/1-business-analysis.md](../phases/1-business-analysis.md)

**Tier Variations:**
- **Tier 1:** Quick mode (1-2 searches, 1-2 questions, no checkpoint)
- **Tier 2:** Comprehensive mode (5-8 searches, 5-8 questions, checkpoint)

**Deliverable:** Research summary + requirements clarification document

---

### Phase 2: Discovery (Tier 2 only)
**Goal:** Understand issue and affected codebase.
**Agent:** explore-codebase
**Checkpoint:** Issue understanding confirmed
**Details:** See [phases/2-discovery.md](../phases/2-discovery.md)

---

### Phase 3: Architecture (Tier 2 only)
**Goal:** Design implementation approach with verification.
**Agent:** design-solution
**Checkpoint:** Plan approved by user
**Details:** See [phases/3-architecture.md](../phases/3-architecture.md)

**Steps:**
1. Invoke design-solution to create plan
2. **Plan Verification Gate:** Architect verifies completeness → Must get APPROVED
3. Present approved plan to user
4. Proceed only after user approval

---

### Phase 4: Implementation
**Goal:** Write code and tests following approved plan.
**Agents:** implement-code, write-tests
**Details:** See [phases/4-implementation.md](../phases/4-implementation.md)

**Guidelines:**
- Follow existing codebase patterns
- Keep changes focused on acceptance criteria
- No scope creep
- Target >80% coverage for new code

---

### Phase 5: Architectural Review (Tier 2 only)
**Goal:** Validate architectural quality.
**Agent:** review-architecture
**Checkpoint:** Architectural assessment approved
**Details:** See [phases/5-architectural-review.md](../phases/5-architectural-review.md)

---

### Phase 6: Security (All Tiers)
**Goal:** Catch security issues early.
**Agent:** audit-security
**Checkpoint:** Security checklist passed
**Details:** See [phases/6-security.md](../phases/6-security.md)

**STOP if critical/high vulnerabilities found.**

---

### Phase 7: Quality Review (Tier 2 only)
**Goal:** Comprehensive code quality assessment.
**Agent:** review-code
**Checkpoint:** Quality metrics pass
**Details:** See [phases/7-review.md](../phases/7-review.md)

---

### Phase 8: Verification (Tier 2 only)
**Goal:** Verify implementation matches approved plan.
**Agent:** design-solution (verify mode)
**Checkpoint:** Architect confirms VERIFIED
**Details:** See [phases/8-verification.md](../phases/8-verification.md)

---

### Phase 9: Documentation
**Goal:** Update relevant documentation.
**Agent:** update-docs
**Details:** See [phases/9-documentation.md](../phases/9-documentation.md)

---

### Phase 10: UAT (Tier 2 only)
**Goal:** Manual testing by user.
**Checkpoint:** User confirms acceptance criteria
**Details:** See [phases/10-uat.md](../phases/10-uat.md)

---

### Phase 11: Finalization (All Tiers)
**Goal:** Pass quality gates, create commit, manage branch.
**Agent:** summarize-diff
**Checkpoint:** Quality gates pass, commit approved
**Details:** See [phases/11-finalization.md](../phases/11-finalization.md)

**Quality Gates:**
```bash
npm run test        # All tests must pass
npm run typecheck   # No type errors
npm run lint        # No lint errors
```

---

### Phase 12: Release (Optional)
**Goal:** Prepare production release.
**Agent:** prepare-release
**Details:** See [phases/12-release.md](../phases/12-release.md)

**Use only when preparing actual release.**

---

## Abort Procedure

If implementation cannot continue:

1. **Document Reason**
   ```bash
   gh issue comment <number> --body "Implementation paused: <reason>"
   ```

2. **Clean Up**
   ```bash
   git checkout .
   git clean -fd
   git checkout main
   git branch -D fix/<number>-<description>
   ```

3. **Update Issue** - Remove self-assignment, add findings

---

## User Override

Users may override workflow gates with documented justification.

### Override Procedure

1. **User explicitly requests override** (e.g., "skip architectural review")
2. **Document justification** - Why the override is appropriate
3. **Record in commit** - Note skipped step in commit message
4. **Cannot override:**
   - Security scan (Phase 6) - NEVER skippable
   - Pre-flight checks (Phase 0) - NEVER skippable
   - Quality gates in Finalization (Phase 11)

### Override Examples

| Request | Response |
|---------|----------|
| "Skip UAT, I tested manually" | Allowed - document in commit |
| "Skip architectural review for hotfix" | Allowed - document justification |
| "Skip security scan" | DENIED - security is mandatory |
| "Skip tests, it's trivial" | Allowed for Tier 1 only |

**Note:** All overrides must be explicit. Never assume user wants to skip steps.

---

## Checkpoint Summary by Tier

| Checkpoint | Tier 1 | Tier 2 |
|------------|--------|--------|
| Business Analysis | - | Yes |
| Discovery | - | Yes |
| Architecture (Plan) | - | Yes |
| Architectural Review | - | Yes |
| Security Scan | Yes | Yes |
| Quality Review | - | Yes |
| Verification | - | Yes |
| UAT | - | Yes |
| Commit | Yes | Yes |
| Branch Management | Yes | Yes |
| **Total** | **2** | **10** |
