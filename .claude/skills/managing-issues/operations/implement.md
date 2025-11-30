# Operation: Implement

Implement GitHub issues through strictly enforced phases with mandatory quality gates after each phase.

---

## CRITICAL ENFORCEMENT RULES

**These rules are NON-NEGOTIABLE. Violations are automatic failures.**

1. **NO PHASE SKIPPING** - ALL phases MUST execute (Tier determines depth, not skip)
2. **QUALITY GATES MANDATORY** - Every phase ends with a Quality Gate
3. **SEQUENTIAL EXECUTION** - Phase N cannot start until QG-(N-1) = PASS
4. **INPUT CONDITIONS REQUIRED** - Phase CANNOT start if any input condition unchecked
5. **OUTPUT CONDITIONS REQUIRED** - Phase CANNOT complete if any output condition unchecked
6. **3-RETRY LIMIT** - Max 3 retries per phase, then ESCALATE to user
7. **STOP ON FAIL** - If Quality Gate = FAIL after 3 retries, STOP workflow

---

## Overview

| Attribute | Value |
|-----------|-------|
| Phases | 12 (0-11) |
| Tiers | 2 (Trivial, Standard) |
| Quality Gates | 12 (one per phase) |
| Agents | 13 specialized agents |

---

## Complexity Tiers

**Tiers determine DEPTH of validation, NOT phase skipping.**

### Tier 1: Trivial
**Labels:** `good first issue`, `documentation`, `typo`, `chore`
**Validation Depth:** Light (automated checks, minimal user checkpoints)
**Phases:** ALL phases execute with quick validation

### Tier 2: Standard (Default)
**Labels:** `bug`, `enhancement`, `breaking-change`, `architecture`, `security`, `major`, or unlabeled
**Validation Depth:** Full (comprehensive checks, all user checkpoints)
**Phases:** ALL phases execute with deep validation

---

## Phase Overview with Quality Gates

| Phase | Name | Agent(s) | Quality Gate | Gate Type |
|-------|------|----------|--------------|-----------|
| 0 | Pre-flight | - | QG-0 | Mandatory |
| 1 | Business Analysis | analyze-requirements | QG-1 | Checkpoint (T2) |
| 2 | Discovery | explore-codebase | QG-2 | Checkpoint (T2) |
| 3 | Architecture | design-solution | QG-3 | User-Approval |
| 4 | Implementation | implement-code, write-tests | QG-4 | Automated |
| 5 | Architectural Review | review-architecture | QG-5 | Checkpoint (T2) |
| 6 | Security | audit-security | QG-6 | Mandatory |
| 7 | Quality Review | review-code | QG-7 | Checkpoint (T2) |
| 8 | Verification | design-solution | QG-8 | Mandatory |
| 9 | Documentation | update-docs | QG-9 | Automated |
| 10 | UAT | - | QG-10 | User-Approval (T2) |
| 11 | Finalization | summarize-diff | QG-11 | User-Approval |

---

## Quality Gate Types

| Type | Description | Retry Allowed | User Interaction |
|------|-------------|---------------|------------------|
| **Mandatory** | MUST pass, no override | Yes (3x) | Escalate on fail |
| **Checkpoint** | Requires acknowledgment (Tier 2) | Yes (3x) | Review findings |
| **User-Approval** | Requires explicit user consent | No | Must approve |
| **Automated** | Pass if automated checks pass | Yes (3x) | None unless fail |

---

## Phase Execution Pattern

Every phase follows this EXACT pattern:

```
┌─────────────────────────────────────────┐
│ PHASE N: <Name>                         │
├─────────────────────────────────────────┤
│ 1. CHECK INPUT CONDITIONS               │
│    - IF any unchecked → STOP            │
│    - IF previous QG ≠ PASS → STOP       │
├─────────────────────────────────────────┤
│ 2. EXECUTE PHASE                        │
│    - Run agent(s)                       │
│    - Produce artifacts                  │
├─────────────────────────────────────────┤
│ 3. VERIFY OUTPUT CONDITIONS             │
│    - IF any unchecked → RETRY (max 3)   │
├─────────────────────────────────────────┤
│ 4. QUALITY GATE                         │
│    - Evaluate pass criteria             │
│    - IF PASS → Proceed to Phase N+1     │
│    - IF FAIL → Retry or Escalate        │
└─────────────────────────────────────────┘
```

---

## Phases

### Phase 0: Pre-flight
**Details:** See [phases/0-preflight.md](../phases/0-preflight.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | Git repo exists, gh CLI authenticated |
| Output Artifacts | Feature branch, validated issue |
| Quality Gate | QG-0 (Mandatory) |

**Quick Summary:**
- Validate issue exists and is OPEN
- Verify clean working directory
- Run baseline tests
- Create feature branch

---

### Phase 1: Business Analysis
**Details:** See [phases/1-business-analysis.md](../phases/1-business-analysis.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-0 = PASS |
| Agent | analyze-requirements |
| Output Artifacts | Research summary, requirements document |
| Quality Gate | QG-1 (Checkpoint for T2, Automated for T1) |

**Quick Summary:**
- Research prior art
- Clarify requirements via questionnaire
- Validate acceptance criteria

---

### Phase 2: Discovery
**Details:** See [phases/2-discovery.md](../phases/2-discovery.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-1 = PASS |
| Agent | explore-codebase |
| Output Artifacts | Affected files list, patterns found |
| Quality Gate | QG-2 (Checkpoint for T2, Automated for T1) |

**Quick Summary:**
- Identify affected code areas
- Map dependencies
- Review existing patterns

---

### Phase 3: Architecture
**Details:** See [phases/3-architecture.md](../phases/3-architecture.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-2 = PASS |
| Agent | design-solution |
| Output Artifacts | Implementation plan |
| Quality Gate | QG-3 (User-Approval) |

**Quick Summary:**
- Design implementation approach
- Architect verifies plan completeness
- User approves plan before implementation

---

### Phase 4: Implementation
**Details:** See [phases/4-implementation.md](../phases/4-implementation.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-3 = PASS |
| Agents | implement-code, write-tests |
| Output Artifacts | Code changes, tests |
| Quality Gate | QG-4 (Automated) |

**Quick Summary:**
- Write code following approved plan
- Write tests for new code
- Verify typecheck and lint pass

---

### Phase 5: Architectural Review
**Details:** See [phases/5-architectural-review.md](../phases/5-architectural-review.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-4 = PASS |
| Agent | review-architecture |
| Output Artifacts | Architecture assessment |
| Quality Gate | QG-5 (Checkpoint for T2, Automated for T1) |

**Quick Summary:**
- Validate SOLID principles
- Check coupling/cohesion
- Verify design patterns

---

### Phase 6: Security
**Details:** See [phases/6-security.md](../phases/6-security.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-5 = PASS |
| Agent | audit-security |
| Output Artifacts | Security scan results |
| Quality Gate | QG-6 (Mandatory - NEVER skippable) |

**Quick Summary:**
- Run npm audit
- Check for secrets
- Static analysis (T2)
- OWASP verification (T2)

---

### Phase 7: Quality Review
**Details:** See [phases/7-review.md](../phases/7-review.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-6 = PASS |
| Agent | review-code |
| Output Artifacts | Quality assessment |
| Quality Gate | QG-7 (Checkpoint for T2, Automated for T1) |

**Quick Summary:**
- Code smell detection
- Complexity analysis
- Maintainability scoring
- Test quality assessment

---

### Phase 8: Verification
**Details:** See [phases/8-verification.md](../phases/8-verification.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-7 = PASS |
| Agent | design-solution (verify mode) |
| Output Artifacts | Verification report |
| Quality Gate | QG-8 (Mandatory) |

**Quick Summary:**
- Compare implementation vs approved plan
- Verify all acceptance criteria met
- Architect confirms VERIFIED

---

### Phase 9: Documentation
**Details:** See [phases/9-documentation.md](../phases/9-documentation.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-8 = PASS |
| Agent | update-docs |
| Output Artifacts | Updated documentation |
| Quality Gate | QG-9 (Automated) |

**Quick Summary:**
- Update CLAUDE.md
- Update test counts
- Add JSDoc for new APIs

---

### Phase 10: UAT
**Details:** See [phases/10-uat.md](../phases/10-uat.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-9 = PASS |
| Agent | - (manual) |
| Output Artifacts | User confirmation |
| Quality Gate | QG-10 (User-Approval for T2, Automated for T1) |

**Quick Summary:**
- Build project
- User manually tests
- Verify acceptance criteria

---

### Phase 11: Finalization
**Details:** See [phases/11-finalization.md](../phases/11-finalization.md)

| Attribute | Value |
|-----------|-------|
| Input Conditions | QG-10 = PASS |
| Agent | summarize-diff |
| Output Artifacts | Commit, branch management |
| Quality Gate | QG-11 (User-Approval) |

**Quick Summary:**
- Run all quality gates (test, typecheck, lint)
- Create commit with proper message
- Branch management (merge/push)

---

## Workflow State Diagram

```
START
  │
  ▼
┌─────────────┐     FAIL (3x)     ┌──────────┐
│   Phase 0   │──────────────────▶│ ESCALATE │
│  Pre-flight │                   └──────────┘
└─────┬───────┘
      │ QG-0 PASS
      ▼
┌─────────────┐     FAIL (3x)     ┌──────────┐
│   Phase 1   │──────────────────▶│ ESCALATE │
│  Business   │                   └──────────┘
└─────┬───────┘
      │ QG-1 PASS
      ▼
     ...
      │
      ▼
┌─────────────┐     FAIL (3x)     ┌──────────┐
│  Phase 11   │──────────────────▶│ ESCALATE │
│ Finalization│                   └──────────┘
└─────┬───────┘
      │ QG-11 PASS
      ▼
    DONE
```

---

## Escalation Procedure

When a phase fails after 3 retries:

1. **Present Issue Summary**
   ```markdown
   ## Phase <N> Failed

   **Phase:** <name>
   **Attempts:** 3/3
   **Failure Reason:** <specific reason>

   **Options:**
   - [Retry] - Try again with different approach
   - [Override] - Skip this check (if allowed)
   - [Abort] - Stop implementation
   ```

2. **Document Decision**
   - Record user's choice
   - If override: document justification in commit

3. **Non-Overridable Phases**
   - Phase 0 (Pre-flight) - NEVER skippable
   - Phase 6 (Security) - NEVER skippable
   - Phase 8 (Verification) - NEVER skippable
   - Phase 11 Quality Gates - NEVER skippable

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

## Quality Gate Summary by Tier

| Quality Gate | Tier 1 | Tier 2 | Can Override |
|--------------|--------|--------|--------------|
| QG-0: Pre-flight | Mandatory | Mandatory | **NO** |
| QG-1: Business Analysis | Automated | Checkpoint | Yes |
| QG-2: Discovery | Automated | Checkpoint | Yes |
| QG-3: Architecture | User-Approval | User-Approval | Yes |
| QG-4: Implementation | Automated | Automated | Yes |
| QG-5: Architectural Review | Automated | Checkpoint | Yes |
| QG-6: Security | Mandatory | Mandatory | **NO** |
| QG-7: Quality Review | Automated | Checkpoint | Yes |
| QG-8: Verification | Mandatory | Mandatory | **NO** |
| QG-9: Documentation | Automated | Automated | Yes |
| QG-10: UAT | Automated | User-Approval | Yes |
| QG-11: Finalization | User-Approval | User-Approval | Yes |

**Gate Types:**
- **Mandatory**: MUST pass, cannot be overridden (QG-0, QG-6, QG-8)
- **Checkpoint**: User reviews findings before proceeding (Tier 2 only)
- **User-Approval**: Requires explicit user consent
- **Automated**: Passes if automated checks pass

**Note:** ALL phases execute for both tiers. Tier determines validation depth, not phase skipping.

---

## Phase Files Reference

| Phase | File |
|-------|------|
| 0 | [phases/0-preflight.md](../phases/0-preflight.md) |
| 1 | [phases/1-business-analysis.md](../phases/1-business-analysis.md) |
| 2 | [phases/2-discovery.md](../phases/2-discovery.md) |
| 3 | [phases/3-architecture.md](../phases/3-architecture.md) |
| 4 | [phases/4-implementation.md](../phases/4-implementation.md) |
| 5 | [phases/5-architectural-review.md](../phases/5-architectural-review.md) |
| 6 | [phases/6-security.md](../phases/6-security.md) |
| 7 | [phases/7-review.md](../phases/7-review.md) |
| 8 | [phases/8-verification.md](../phases/8-verification.md) |
| 9 | [phases/9-documentation.md](../phases/9-documentation.md) |
| 10 | [phases/10-uat.md](../phases/10-uat.md) |
| 11 | [phases/11-finalization.md](../phases/11-finalization.md) |
