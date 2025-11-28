# Phase 5: Architectural Review

**Goal:** Validate the architectural quality of implemented code against design principles.
**Agent:** `review-architecture`
**Skip for:** Tier 1 (trivial changes)

This phase ensures the implementation follows sound architectural principles, not just that it "works."

## Why This Phase Matters

Phase 8 (Verification) checks if implementation matches the *plan*. But a bad plan executed perfectly is still bad architecture. This phase catches:

- SOLID violations introduced during implementation
- Accidental coupling between components
- Design pattern misuse or anti-patterns
- Technical debt accumulated during implementation
- Abstraction leaks or layer violations

## Steps

### 1. Invoke Architecture Reviewer

Follow the `review-architecture` agent steps (see `agents/review-architecture.md`):

1. Identify all files changed in implementation
2. Analyze component boundaries and responsibilities
3. Check SOLID principles adherence
4. Evaluate design pattern usage
5. Assess coupling and cohesion
6. Check dependency directions
7. Report findings by severity

**Example inputs:**
- issue_number: 11
- files_changed: ["EditorTab.tsx", "EditorTab.css", "AppDockLayout.tsx"]
- implementation_plan: (from design-solution)
- tier: 2

### 2. SOLID Principles Check

For each changed file, evaluate:

| Principle | Question | Red Flags |
|-----------|----------|-----------|
| **S**ingle Responsibility | Does each class/component have ONE reason to change? | >300 line components, mixed concerns |
| **O**pen/Closed | Is code open for extension, closed for modification? | Switch statements on types, hardcoded conditionals |
| **L**iskov Substitution | Can subtypes replace their base types? | Type checks (instanceof), overridden methods with different behavior |
| **I**nterface Segregation | Are interfaces minimal and focused? | Large interfaces with unused methods |
| **D**ependency Inversion | Do high-level modules depend on abstractions? | Direct imports of concrete implementations |

### 3. Design Pattern Evaluation

Check pattern usage:

**Correct Usage:**
- [ ] Pattern solves actual problem (not over-engineering)
- [ ] Pattern implemented completely (not half-patterns)
- [ ] Pattern follows established conventions

**Anti-Patterns to Flag:**
- God objects (classes that know/do too much)
- Feature envy (methods more interested in other classes)
- Shotgun surgery (changes requiring edits across many files)
- Parallel inheritance hierarchies

### 4. Coupling and Cohesion Analysis

**Coupling Assessment:**
```
Low Coupling (Good):
- Components communicate via interfaces
- No circular dependencies
- Changes localize to single module

High Coupling (Bad):
- Components directly reference each other's internals
- Circular imports
- Changes cascade across multiple modules
```

**Cohesion Assessment:**
```
High Cohesion (Good):
- Related functionality grouped together
- Clear module boundaries
- Intuitive code organization

Low Cohesion (Bad):
- Unrelated functionality mixed together
- "Utility" classes with random methods
- Feature scattered across modules
```

### 5. Dependency Direction Check

Verify dependencies flow in the correct direction:

```
Renderer Layer
    ↓ depends on
Store/State Layer
    ↓ depends on
Service/Logic Layer
    ↓ depends on
Infrastructure Layer
```

**Violations to flag:**
- Service layer importing React components
- Infrastructure importing business logic
- Circular dependencies between layers

## Architectural Review Checkpoint (Tier 2)

Present findings to user:

```markdown
## Architectural Review Results

**Overall Assessment:** [SOUND / NEEDS IMPROVEMENT / ARCHITECTURAL ISSUES]

### SOLID Analysis
| Principle | Status | Notes |
|-----------|--------|-------|
| Single Responsibility | ✅/⚠️/❌ | <assessment> |
| Open/Closed | ✅/⚠️/❌ | <assessment> |
| Liskov Substitution | ✅/⚠️/❌ | <assessment> |
| Interface Segregation | ✅/⚠️/❌ | <assessment> |
| Dependency Inversion | ✅/⚠️/❌ | <assessment> |

### Design Quality
- **Coupling:** [Low/Medium/High] - <explanation>
- **Cohesion:** [High/Medium/Low] - <explanation>
- **Patterns:** [Appropriate/Over-engineered/Missing]

### Issues Found
| Severity | Issue | Location | Recommendation |
|----------|-------|----------|----------------|
| High | <issue> | <file:line> | <fix> |

### Recommendations
- <architectural improvement suggestions>

[Proceed / Address Issues First]
```

## Severity Levels

| Severity | Definition | Action Required |
|----------|------------|-----------------|
| **Critical** | Architectural flaw that will cause problems | MUST fix before proceeding |
| **High** | Significant deviation from principles | Should fix before proceeding |
| **Medium** | Minor architectural concern | Document, can fix in follow-up |
| **Low** | Suggestion for improvement | Optional |

## Tier-Specific Depth

### Tier 2: Standard Review
- SOLID principles check (high-level)
- Basic coupling analysis
- Pattern misuse detection
- Dependency direction verification

### Tier 2: Deep Architectural Review
- Full SOLID analysis with specific violations
- Detailed coupling metrics
- Anti-pattern detection
- Layer boundary verification
- Technical debt assessment
- Extensibility evaluation

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review architect feedback, understand issues
  2. Re-invoke implement-code to address architectural issues
  3. Re-run architectural review
  4. After 3 failures: Present to user with options
- **Escalation:** User decides: [Retry/Accept (document technical debt)/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] Architectural review completed
- [ ] No critical architectural issues
- [ ] High severity issues addressed OR documented with justification
- [ ] SOLID principles assessment completed
- [ ] Coupling/cohesion acceptable for the change scope

**STOP if any item unchecked. Do not proceed.**
