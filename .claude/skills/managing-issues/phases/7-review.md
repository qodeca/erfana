# Phase 7: Implementation Quality Review

**Goal:** Comprehensive code quality assessment.
**Agent:** `review-code`
**Quality Gate:** QG-7 (Checkpoint for T2, Automated for T1)

---

## INPUT CONDITIONS

**STOP if ANY condition is unchecked. Do not proceed.**

- [ ] QG-6 = PASS (Security scan completed)
- [ ] No critical/high security vulnerabilities
- [ ] All tests passing
- [ ] Typecheck passing

---

## Execution Steps

### Step 1: Invoke Code Reviewer

Use `review-code` agent:

1. Read all changed files
2. Check for security issues
3. Check performance
4. Verify best practices
5. Analyze code smells
6. Evaluate test quality
7. Assess readability
8. Compile findings

### Step 2: Code Smell Detection

| Smell | Detection | Threshold |
|-------|-----------|-----------|
| Long Method | Line count | >50 lines |
| Large Class | Total lines | >300 lines |
| Long Parameter List | Params | >5 params |
| Feature Envy | External refs | >3 deps |
| Data Clumps | Repeated groups | >2 occurrences |

### Step 3: Complexity Analysis

**Cyclomatic Complexity:**
| Score | Rating | Action |
|-------|--------|--------|
| 1-5 | Simple | OK |
| 6-10 | Moderate | Review |
| 11-20 | Complex | Justify |
| 21+ | Very Complex | Refactor |

**Target:** < 15 per function

### Step 4: Maintainability Scoring

```
Score = (readability + testability + modifiability) / 3
```

| Score | Rating | Action |
|-------|--------|--------|
| 80-100 | Excellent | Proceed |
| 60-79 | Good | Proceed with notes |
| 40-59 | Fair | Recommend improvements |
| 0-39 | Poor | Require improvements |

### Step 5: Test Quality Assessment

| Aspect | Check |
|--------|-------|
| Assertion Quality | Meaningful assertions? |
| Edge Cases | Boundaries tested? |
| Isolation | Tests independent? |
| Readability | Clear test names? |
| Determinism | Repeatable? |
| Speed | <100ms per unit? |

**Coverage requirements:**
- Line coverage: >80%
- Branch coverage: >70%

### Step 6: Address Findings

| Severity | Action |
|----------|--------|
| Critical | MUST fix |
| High | Should fix |
| Medium | Document if deferring |
| Low | Optional |

---

## OUTPUT ARTIFACTS

| Artifact | Description |
|----------|-------------|
| Quality Score | Overall score /100 |
| Code Smells | Detected smells with locations |
| Complexity Metrics | Per-function complexity |
| Test Quality Report | Coverage and quality assessment |
| Issue List | All findings by severity |

---

## OUTPUT CONDITIONS

**ALL must be checked before proceeding to Phase 8.**

- [ ] Code review completed
- [ ] All critical issues addressed
- [ ] High severity issues addressed (T2) or documented (T1)
- [ ] Medium issues fixed or documented
- [ ] Maintainability score >= 60 (or documented exception)
- [ ] Test coverage meets threshold (>80% line, >70% branch)
- [ ] Code smells addressed or documented

---

## QUALITY GATE: QG-7

**Gate Type:** Checkpoint (T2) | Automated (T1)
**Gate ID:** QG-7

### Pass Criteria

| Criterion | Tier 1 | Tier 2 |
|-----------|--------|--------|
| Critical issues | 0 | 0 |
| High issues | Document | Address |
| Maintainability | >= 50 | >= 60 |
| Coverage | >70% | >80% |
| Complexity | < 20 | < 15 |
| User checkpoint | Not required | Required |

### Tier 2 Checkpoint

Present to user:

```markdown
## Implementation Quality Review

**Overall Quality Score:** <X>/100

### Quality Metrics
| Metric | Score | Status |
|--------|-------|--------|
| Maintainability | <score>/100 | ✅/⚠️/❌ |
| Complexity | <score> (target: <15) | ✅/⚠️/❌ |
| Test Coverage | <X>% (target: >80%) | ✅/⚠️/❌ |
| Readability | <score>/100 | ✅/⚠️/❌ |

### Code Smells Detected
| Smell | Location | Severity | Recommendation |
|-------|----------|----------|----------------|
| <smell> | <file:line> | <sev> | <fix> |

### Issues by Severity
- **Critical:** <count>
- **High:** <count>
- **Medium:** <count>

### Test Quality Notes
- Coverage: <X>%
- <observations>

### Recommendations
- <suggestion 1>
- <suggestion 2>

**Proceed to Verification?** [Approve / Address Issues First]
```

### Result

**QG-7 Result:** [PASS | FAIL]

### On FAIL

1. Review findings
2. Fix critical/high issues
3. Re-run review
4. Max 3 retries, then ESCALATE

---

## NEXT PHASE

**QG-7 = PASS required to proceed to Phase 8: Verification**

**STOP if QG-7 ≠ PASS. Do not proceed.**
