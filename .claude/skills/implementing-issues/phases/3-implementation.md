# Phase 3: Implementation

**Goal:** Write code and tests following the approved plan.
**Agents:** `implement-code`, `write-tests`

## Steps

### 1. Implementation with implement-code

Follow the `implement-code` agent steps (see `agents/implement-code.md`):

1. Review implementation plan
2. Read existing code patterns
3. Create new files using Write()
4. Modify existing files using Edit()
5. Verify with Bash(command="npm run typecheck")

**Example inputs:**
- issue_number: 11
- implementation_plan: (from design-solution)
- step_number: 1
- patterns_to_follow: ["WelcomeTab.tsx", "useProjectStore"]

### 2. Write Tests (TDD-friendly)

- Write tests alongside or before implementation
- Use `write-tests` for complex test scenarios
- Target >80% coverage for new code

### 3. Incremental Verification

```bash
npm run typecheck    # After each major change
npm test             # Frequently
```

## Implementation Guidelines

- Follow existing patterns in codebase
- Keep changes focused on acceptance criteria
- NO scope creep ("while I'm here..." belongs in separate issue)
- Simple changes (<10 lines) don't need agent orchestration

## Agent Selection for Implementation

```
Issue Type → Agent
├── TypeScript code → implement-code
├── Complex tests → write-tests
├── Bug diagnosis → investigate-bug
└── Code cleanup → advise-refactor
```

## Modern Testing Approaches (Tier 2+)

Consider these 2025 testing practices where applicable:

### 1. Property-Based Testing
- For functions with complex input domains
- Generate random inputs to find edge cases
- Tools: fast-check (TypeScript)

### 2. Contract Testing
- For IPC handlers and API endpoints
- Verify interface contracts remain stable
- Catches breaking changes early

### 3. AI-Assisted Test Generation
- Use `write-tests` agent for edge case discovery
- Generate tests from acceptance criteria automatically
- Focus human effort on test strategy, not boilerplate

### 4. Mutation Testing (Optional, Tier 3)
- Verify test quality by introducing code mutations
- Ensure tests catch actual bugs, not just achieve coverage
- Run after implementation is stable

---

## Retry Logic

- **Max retries:** 3 per phase
- **On failure:**
  1. Review agent output and typecheck/test errors
  2. Retry with refined guidance or corrected patterns
  3. After 3 failures: Present issue to user with options
- **Escalation:** User decides: [Retry/Manual Implementation/Abort]

---

## Phase Validation

Before proceeding to next phase, ALL must be checked:

- [ ] All planned files created/modified
- [ ] Typecheck passes (npm run typecheck)
- [ ] Tests written for new code (>80% coverage target)
- [ ] All tests pass (npm test)
- [ ] Code follows existing codebase patterns
- [ ] No scope creep - only acceptance criteria addressed

**STOP if any item unchecked. Do not proceed.**
