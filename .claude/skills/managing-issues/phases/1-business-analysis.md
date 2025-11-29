# Phase 1: Business Analysis

**Goal:** Research prior art and clarify requirements before exploring codebase.
**Agent:** `analyze-requirements`
**Quality Gate:** QG-1 (Checkpoint for T2, Automated for T1)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-0 = PASS (Pre-flight completed)
- [ ] Feature branch checked out
- [ ] Issue metadata available (title, body, labels)
- [ ] Tier classification determined

---

## Execution Steps

### Step 1: Issue Classification

Determine issue type from labels and body:

| Type | Labels | Research Focus |
|------|--------|----------------|
| Bug | `bug`, `defect` | Root cause patterns, known issues |
| Enhancement | `enhancement`, `improvement` | Similar features, design patterns |
| Feature | `feature`, unlabeled | Libraries, prior art, references |
| Security | `security`, `vulnerability` | OWASP, CVE databases |
| Refactor | `refactor`, `cleanup` | Design patterns, SOLID |

### Step 2: Prior Art Research

**Tier 1:** 1-2 searches (quick)
**Tier 2:** 3-5 searches (focused)

Use WebSearch to find:
- Existing libraries/packages
- Similar implementations
- Best practices
- Known issues and solutions

### Step 3: Requirements Questionnaire

Present tier-appropriate questions using AskUserQuestion:

**Tier 1:** 1-2 questions
**Tier 2:** 3-5 questions

Categories:
1. Requirements clarification
2. Edge cases & boundaries
3. Reference implementations
4. Scope boundaries

### Step 4: Acceptance Criteria Validation

Verify all criteria are:
- [ ] Testable (observable behavior)
- [ ] Measurable (success metrics)
- [ ] Bounded (explicit scope)

If gaps found: Add suggested criteria for user approval.

### Step 5: Create Requirements Summary

Compile:
1. Issue classification
2. Prior art findings with recommendations
3. Clarified requirements
4. Validated acceptance criteria
5. Identified risks
6. Recommended approach

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Research Summary | Prior art findings, library recommendations |
| Requirements Document | Clarified requirements from questionnaire |
| Validated Criteria | Acceptance criteria with gaps addressed |
| Risk Assessment | Identified risks and mitigations |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 2.**

- [ ] Issue type classified
- [ ] Prior art research completed (depth per tier)
- [ ] Requirements questionnaire completed
- [ ] All user answers explicit (no skipped questions)
- [ ] Acceptance criteria validated
- [ ] Scope boundaries documented
- [ ] Research summary created

---

## QUALITY GATE: QG-1

**Gate Type:** Checkpoint (T2) | Automated (T1)
**Gate ID:** QG-1

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| Research completed | 1-2 searches | 3-5 searches |
| Questions answered | 1-2 | 3-5 |
| Criteria validated | Basic check | Full validation |
| User checkpoint | Not required | Required |

### Tier 2 Checkpoint

Present to user:

```markdown
## Business Analysis Complete

**Issue:** #<number> - <title>
**Type:** <classification>
**Tier:** <tier>

### Prior Art Findings
- <finding 1>
- <finding 2>

### Requirements Clarification
| Question | Answer | Impact |
|----------|--------|--------|
| <Q1> | <A1> | <impact> |

### Validated Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>

### Scope Boundaries
**In Scope:** <items>
**Out of Scope:** <items>

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| <risk> | <L/M/H> | <L/M/H> | <action> |

**Proceed to Discovery?** [Approve / Revise / Add Questions]
```

### Result

**QG-1 Result:** [PASS | FAIL]

### On FAIL

1. Review specific failure reason
2. Address missing requirements or research
3. Re-run questionnaire if needed
4. Max 3 retries, then ESCALATE

---

## NEXT PHASE

**QG-1 = PASS required to proceed to Phase 2: Discovery**

**STOP if QG-1 ≠ PASS. Do not proceed.**
