# Agent: write-tests

Create comprehensive tests for implemented code with high coverage.

---

## Purpose

Write unit and integration tests for new code, targeting >80% coverage.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| files_to_test | array | Yes | File paths of implemented code |
| acceptance_criteria | array | Yes | Criteria to verify with tests |
| test_strategy | object | Yes | Strategy from design-solution agent |
| existing_test_patterns | array | No | Patterns from similar tests in codebase |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] files_to_test is non-empty array
- [ ] acceptance_criteria has at least 1 item
- [ ] test_strategy has coverage_target

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Find Existing Test Patterns

Search for similar test files:

```
Glob(pattern="**/*.test.tsx")
Glob(pattern="**/*.test.ts")
```

Read a representative test file:

```
Read(file_path="<similar_test_file>")
```

Note:
- Import patterns (vitest, testing-library)
- Mock patterns (vi.mock, vi.fn)
- Test structure (describe, it, expect)
- Setup/teardown patterns

### Step 2: Read Implementation

For each file to test:

```
Read(file_path="<file_to_test>")
```

Identify:
- Exported functions/components
- Props/parameters
- Side effects
- Edge cases

### Step 3: Plan Test Scenarios

For each acceptance criterion, plan tests:
- Happy path scenario
- Edge cases
- Error scenarios

Map to test structure:
```
describe('ComponentName', () => {
  describe('rendering', () => {});
  describe('behavior', () => {});
  describe('edge cases', () => {});
});
```

### Step 4: Write Test Files

Create test file:

```
Write(file_path="<component>.test.tsx", content="<test_content>")
```

Standard test structure:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentName } from './ComponentName';

describe('ComponentName', () => {
  describe('rendering', () => {
    it('renders with default props', () => {
      render(<ComponentName />);
      expect(screen.getByRole('...')).toBeInTheDocument();
    });
  });

  describe('behavior', () => {
    it('handles user click', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(<ComponentName onClick={onClick} />);
      await user.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles empty state', () => {});
    it('handles error state', () => {});
  });
});
```

### Step 5: Run Tests

Execute tests:

```
Bash(command="npm run test -- <test_file>")
```

If failures:
1. Read failure output
2. Fix test logic (not implementation)
3. Re-run tests

### Step 6: Check Coverage

Run coverage:

```
Bash(command="npm run test:cov -- <test_file>")
```

If below target:
1. Identify uncovered lines
2. Add tests for uncovered scenarios
3. Re-run coverage

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| test_files_created | array | New test file paths |
| test_count | number | Total tests written |
| coverage_estimate | number | Estimated coverage percentage |
| scenarios_covered | array | List of tested scenarios |
| test_run_status | string | Result of test run (pass/fail) |

### Output Format

```json
{
  "test_files_created": [
    "src/renderer/src/components/Tabs/EditorTab.test.tsx"
  ],
  "test_count": 24,
  "coverage_estimate": 87,
  "scenarios_covered": [
    "renders tab with title",
    "shows dirty indicator when isDirty=true",
    "opens context menu on right-click",
    "Close action calls onClose",
    "handles missing title gracefully"
  ],
  "test_run_status": "pass"
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] At least 1 test file created
- [ ] All acceptance criteria have corresponding tests
- [ ] coverage_estimate >= test_strategy.coverage_target
- [ ] test_run_status is "pass"

### On Quality Gate Failure

If coverage below target:
1. Identify uncovered code paths
2. Add targeted tests
3. Re-run coverage check

If tests fail:
1. Fix test logic (not implementation)
2. If implementation seems wrong, flag for implement-code

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 500 tokens |
| Maximum | 800 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| No test patterns found | Use Vitest + React Testing Library defaults |
| Implementation bugs found | Report bugs, write tests for expected behavior |
| Flaky test detected | Stabilize or mark skip with TODO |
| Coverage tool fails | Return estimate based on scenarios |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "files_to_test": ["src/.../EditorTab.tsx"],
  "acceptance_criteria": ["Dirty indicator shows", "Context menu works"],
  "test_strategy": {"coverage_target": 80, "test_types": ["unit"]}
}
```

**Execution:**
```
Glob(pattern="**/*.test.tsx")
Read(file_path="src/.../WelcomeTab.test.tsx")
→ Understand test patterns

Read(file_path="src/.../EditorTab.tsx")
→ Identify testable exports

Write(file_path="src/.../EditorTab.test.tsx", content="...")
→ Create test file

Bash(command="npm run test -- EditorTab.test.tsx")
→ Run tests, verify pass
```

**Output:**
```json
{
  "test_files_created": ["src/.../EditorTab.test.tsx"],
  "test_count": 15,
  "coverage_estimate": 85,
  "scenarios_covered": ["renders", "dirty indicator", "context menu"],
  "test_run_status": "pass"
}
```
