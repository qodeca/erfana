# Phase 3: Implementation

**Goal:** Write code and tests following the approved plan.
**Agents:** `code-implementer`, `test-writer`

## Steps

### 1. Implementation with code-implementer

Use the Task tool to spawn the code-implementer agent:

```
Task(subagent_type='code-implementer')

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

### 2. Write Tests (TDD-friendly)

- Write tests alongside or before implementation
- Use `test-writer` for complex test scenarios
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
├── TypeScript code → code-implementer
├── Complex tests → test-writer
├── Bug diagnosis → bug-investigator
└── Code cleanup → refactoring-advisor
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
- Use `test-writer` agent for edge case discovery
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
