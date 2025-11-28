# Phase 7: Implementation Quality Review

**Goal:** Comprehensive code quality assessment covering correctness, maintainability, and craftsmanship.
**Agent:** `review-code`
**Applies to:** Tier 2+ (skip for Tier 1 trivial changes)

This phase ensures the implementation is not just functional, but maintainable, readable, and follows best practices.

## Why This Phase Expanded to Tier 2

Previously Tier 3 only. Now Tier 2+ because:
- Code quality issues compound over time
- Earlier detection = cheaper fixes
- Tier 2 issues are often the "foundation" for future features
- Maintainability matters even for medium complexity changes

## Steps

### 1. Invoke Code Reviewer

Follow the `review-code` agent steps (see `agents/review-code.md`):

1. Read all changed files
2. Check for security issues (secrets, injection, XSS)
3. Check performance (re-renders, memory leaks)
4. Verify best practices (TypeScript types, error handling)
5. Analyze code smells and complexity
6. Evaluate test quality (not just coverage)
7. Assess readability and maintainability
8. Compile findings by severity

**Example inputs:**
- issue_number: 11
- files_changed: ["EditorTab.tsx", "EditorTab.css"]
- acceptance_criteria: ["Dynamic sizing", "Context menu"]
- tier: 2

### 2. Review Categories (Expanded)

| Category | Tier 2 | Tier 3 |
|----------|--------|--------|
| Security vulnerabilities | Basic | Deep |
| Performance issues | Standard | Profiled |
| Best practices compliance | Yes | Yes |
| Test coverage adequacy | Yes | Yes |
| **Code smell detection** | Standard | Deep |
| **Complexity analysis** | Basic | Detailed |
| **Maintainability scoring** | Yes | Yes |
| **Test quality assessment** | Basic | Deep |
| **Readability evaluation** | Yes | Yes |
| Documentation completeness | Basic | Full |

### 3. Code Smell Detection (NEW)

**Tier 2 - Standard Detection:**

| Smell | Detection | Threshold |
|-------|-----------|-----------|
| Long Method | Line count | >50 lines |
| Large Class | Total lines | >300 lines |
| Long Parameter List | Parameter count | >5 params |
| Feature Envy | External references | >3 external deps |
| Data Clumps | Repeated field groups | >2 occurrences |

**Tier 3 - Deep Detection (Additional):**

| Smell | Detection | Action |
|-------|-----------|--------|
| Shotgun Surgery | Change impact analysis | Flag for refactor |
| Divergent Change | Multiple change reasons | Split responsibilities |
| Parallel Inheritance | Hierarchy duplication | Consider composition |
| Lazy Class | Minimal functionality | Consider merging |
| Speculative Generality | Unused abstractions | Remove premature |
| Temporary Field | Conditionally used fields | Extract to params |

### 4. Complexity Analysis (NEW)

**Cyclomatic Complexity Assessment:**

| Complexity | Score | Action |
|------------|-------|--------|
| Simple | 1-5 | Acceptable |
| Moderate | 6-10 | Review necessity |
| Complex | 11-20 | Requires justification |
| Very Complex | 21+ | Must refactor |

**Detection approach:**
- Count decision points (if, else, case, &&, ||, ?)
- Each function analyzed independently
- Flag functions exceeding threshold for tier

**Cognitive Complexity:**
- Measure mental effort to understand code
- Penalize nesting, breaks in flow, recursion
- Target: < 15 for any single function

### 5. Maintainability Scoring (NEW)

**Maintainability Index (simplified):**

```
Score = (readability + testability + modifiability) / 3

Where:
- readability: naming + formatting + documentation (0-100)
- testability: pure functions + dependency injection + isolation (0-100)
- modifiability: coupling + cohesion + complexity (0-100)
```

| Score | Rating | Action |
|-------|--------|--------|
| 80-100 | Excellent | Proceed |
| 60-79 | Good | Proceed with notes |
| 40-59 | Fair | Recommend improvements |
| 0-39 | Poor | Require improvements |

### 6. Test Quality Assessment (NEW)

**Beyond Coverage - Evaluate:**

| Aspect | Question | Red Flags |
|--------|----------|-----------|
| **Assertion Quality** | Are assertions meaningful? | `expect(true).toBe(true)` |
| **Edge Cases** | Are boundaries tested? | Only happy path |
| **Isolation** | Are tests independent? | Shared mutable state |
| **Readability** | Can you understand what's tested? | No test descriptions |
| **Determinism** | Are tests repeatable? | Time/random dependencies |
| **Speed** | Do tests run quickly? | >100ms per unit test |

**Test Coverage Requirements:**
- Tier 2: >70% line coverage for new code
- Tier 3: >80% line coverage, >70% branch coverage

**Test Quality Checklist:**
- [ ] Each acceptance criterion has corresponding test(s)
- [ ] Edge cases covered (null, empty, boundary values)
- [ ] Error paths tested
- [ ] Tests are isolated (no order dependency)
- [ ] Test names describe behavior, not implementation

### 7. Readability Evaluation (NEW)

**Naming Assessment:**
- [ ] Variables describe content, not type (`users` not `arr`)
- [ ] Functions describe action (`calculateTotal` not `calc`)
- [ ] Classes describe entity (`UserRepository` not `UserMgr`)
- [ ] No single-letter variables (except loop indices)
- [ ] No abbreviations without context

**Formatting Assessment:**
- [ ] Consistent indentation (enforced by linter)
- [ ] Reasonable line lengths (<120 chars)
- [ ] Logical grouping of related code
- [ ] Blank lines separate logical sections

**Comprehension Assessment:**
- [ ] Code flow is linear (no jumping around)
- [ ] Early returns reduce nesting
- [ ] Complex expressions broken into named variables
- [ ] Magic numbers replaced with named constants

### 8. Address Findings

| Severity | Definition | Action Required |
|----------|------------|-----------------|
| **Critical** | Breaks functionality or security | MUST fix before proceeding |
| **High** | Significant quality issue | Should fix before proceeding |
| **Medium** | Notable concern | Document if deferring |
| **Low** | Suggestion | Optional improvement |

## Review Checkpoint (Tier 2+)

Present findings to user:

```markdown
## Implementation Quality Review

**Overall Quality Score:** <X>/100

### Quality Metrics
| Metric | Score | Status |
|--------|-------|--------|
| Maintainability | <score>/100 | ✅/⚠️/❌ |
| Complexity | <score> (target: <15) | ✅/⚠️/❌ |
| Test Quality | <assessment> | ✅/⚠️/❌ |
| Readability | <score>/100 | ✅/⚠️/❌ |

### Code Smells Detected
| Smell | Location | Severity | Recommendation |
|-------|----------|----------|----------------|
| <smell> | <file:line> | <sev> | <fix> |

### Issues by Severity

**Critical Issues:** <count>
- <issue 1>

**High Issues:** <count>
- <issue 1>

**Medium Issues:** <count>
- <issue 1>

### Test Quality Notes
- Coverage: <X>% (target: <Y>%)
- <quality observations>

### Recommendations
- <suggestion 1>
- <suggestion 2>

[Proceed / Address Issues First]
```

## Security Review (Tier 3 Enhanced)

For security-sensitive changes, verify:
- [ ] No path traversal vulnerabilities
- [ ] IPC handlers validate all input
- [ ] No secrets in code
- [ ] CSP not weakened
- [ ] Dangerous protocols still blocked
- [ ] Authentication/authorization checks in place
- [ ] Input sanitization at boundaries
- [ ] Output encoding where needed

## Tier-Specific Depth

### Tier 2: Standard Review
- Basic code smell detection (5 core smells)
- Cyclomatic complexity check
- Coverage verification (>70%)
- Naming and formatting review
- Security basics

### Tier 3: Deep Review (All of Tier 2 plus)
- Full code smell catalog (12+ smells)
- Cognitive complexity analysis
- Branch coverage verification (>70%)
- Test mutation quality hints
- Full security review
- Maintainability index calculation
- Technical debt assessment

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review review-code output, understand issues
  2. Fix identified issues using implement-code
  3. Re-run review
  4. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Accept (with documented risks)/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Code review completed successfully
- [ ] All critical issues addressed
- [ ] All high severity issues addressed (Tier 3) or documented (Tier 2)
- [ ] Medium issues fixed or documented with justification
- [ ] Maintainability score >= 60 (or documented exception)
- [ ] Test coverage meets tier threshold
- [ ] Security review completed (Tier 3)
- [ ] Code smells addressed or documented

**STOP if any item unchecked. Do not proceed.**
