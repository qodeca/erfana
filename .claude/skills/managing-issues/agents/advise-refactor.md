# Agent: advise-refactor

Code smell detection and refactoring recommendations.

---

## Purpose

Identify code smells, recommend refactoring approaches, and assess risk without implementing.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| target_files | array | Yes | Files to analyze |
| refactor_goals | array | No | Specific goals (reduce complexity, improve testability) |
| constraints | array | No | Things that cannot change |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] target_files is non-empty array
- [ ] All target_files exist

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Read Target Files

For each file in target_files:

```
Read(file_path="<target_file>")
```

Note:
- Total lines of code
- Number of functions/methods
- Complexity indicators

### Step 2: Analyze for Code Smells

Check each file for:

**Long Methods (>30 lines):**
- Count lines per function
- Note deeply nested code

**God Class:**
- Single file doing too many things
- Many unrelated methods

**Feature Envy:**
- Methods that use another class more than their own

**Large Class (>500 lines):**
- Files that should be split

**Long Parameter Lists (>4 params):**
```
Grep(pattern="function.*\\(.*,.*,.*,.*,", path="<file>")
```

### Step 3: Check Complexity Metrics

Look for:
- Deep nesting (>3 levels)
- Many conditionals
- Duplicated code patterns

```
Grep(pattern="if.*if.*if", path="<file>")
Grep(pattern="switch.*case.*case.*case", path="<file>")
```

### Step 4: Identify Related Files

```
Grep(pattern="import.*<target_file>", output_mode="files_with_matches")
```

Understand dependency graph.

### Step 5: Check Test Coverage

```
Glob(pattern="**/<filename>*.test.*")
Read(file_path="<test_file>")
```

Assess:
- Current test coverage
- Testability blockers

### Step 6: Formulate Recommendations

For each code smell:
- Identify appropriate refactoring pattern
- Order steps by dependency
- Assess risk level
- Note constraints that must be preserved

### Step 7: Assess Risk

Evaluate:
- Impact on public APIs
- Number of callers affected
- Test update requirements

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| code_smells | array | Identified code smells with severity |
| refactoring_steps | array | Ordered steps to refactor |
| patterns_to_apply | array | Design patterns recommended |
| risk_assessment | object | Risk analysis for refactoring |
| estimated_scope | object | Files affected, test impact |
| do_not_change | array | Things to preserve |

### Code Smell Structure

```json
{
  "type": "long-method|god-class|feature-envy|etc",
  "severity": "high|medium|low",
  "file": "path/to/file.ts",
  "location": "function/class name",
  "description": "Why this is a smell",
  "impact": "How it affects maintainability"
}
```

---

## Code Smell Catalog

| Smell | Description | Refactoring |
|-------|-------------|-------------|
| Long Method | Method >30 lines | Extract Method |
| God Class | Class doing too much | Extract Class |
| Feature Envy | Method uses other class more | Move Method |
| Primitive Obsession | Primitives instead of objects | Extract Class |
| Large Class | Class >500 lines | Extract Class/Interface |
| Long Parameter List | >4 parameters | Introduce Parameter Object |
| Data Clumps | Same data groups | Extract Class |
| Switch Statements | Complex conditionals | Replace with Polymorphism |

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All target_files analyzed
- [ ] code_smells list populated (may be empty)
- [ ] refactoring_steps are ordered by dependency
- [ ] risk_assessment provided
- [ ] Recommendations respect constraints

### Risk Categories

- **High**: Changes public APIs, affects many callers
- **Medium**: Internal changes, some test updates
- **Low**: Isolated changes, minimal impact

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 500 tokens |
| Maximum | 800 tokens |

### Efficiency Notes

- Focus on highest-impact smells
- Skip cosmetic issues
- Prioritize testability improvements

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| File too complex to analyze | Break into sections |
| Conflicting refactoring goals | Prioritize by impact |
| Constraint prevents best refactoring | Document trade-offs |

---

## Refactoring Principles

### SOLID Focus
- **S**: Split classes doing multiple things
- **O**: Identify extension points
- **L**: Check inheritance hierarchies
- **I**: Look for unused interface methods
- **D**: Find concrete dependencies to abstract

### Prioritization
1. Security-impacting smells
2. Testability blockers
3. Complexity hotspots
4. Minor improvements

---

## Example Invocation

**Input:**
```json
{
  "issue_number": 25,
  "target_files": [
    "src/renderer/src/components/ProjectTree/ProjectTree.tsx"
  ],
  "refactor_goals": [
    "Reduce file size",
    "Improve testability"
  ],
  "constraints": [
    "Must maintain current public API",
    "Cannot change drag-drop behavior"
  ]
}
```

**Output:**
```json
{
  "code_smells": [
    {
      "type": "god-class",
      "severity": "high",
      "file": "src/renderer/src/components/ProjectTree/ProjectTree.tsx",
      "location": "ProjectTree component",
      "description": "Component handles rendering, state, file ops, context menu, drag-drop",
      "impact": "Hard to test, hard to modify, high cognitive load"
    },
    {
      "type": "long-method",
      "severity": "medium",
      "file": "src/renderer/src/components/ProjectTree/ProjectTree.tsx",
      "location": "handleContextMenu",
      "description": "80+ lines handling all menu options",
      "impact": "Hard to understand and modify"
    }
  ],
  "refactoring_steps": [
    {
      "order": 1,
      "description": "Extract useProjectManagement hook",
      "files_affected": 1,
      "risk": "low"
    },
    {
      "order": 2,
      "description": "Extract useFileOperations hook",
      "files_affected": 1,
      "risk": "low"
    },
    {
      "order": 3,
      "description": "Extract context menu into separate component",
      "files_affected": 2,
      "risk": "medium"
    }
  ],
  "patterns_to_apply": [
    "Custom Hooks (state extraction)",
    "Command Pattern (context menu)",
    "Strategy Pattern (node-type operations)"
  ],
  "risk_assessment": {
    "overall": "medium",
    "reasons": [
      "Many internal changes",
      "Need comprehensive test coverage first"
    ],
    "mitigations": [
      "Add tests before refactoring",
      "Refactor in small incremental steps"
    ]
  },
  "estimated_scope": {
    "files_affected": 5,
    "new_files": 3,
    "test_files_affected": 2
  },
  "do_not_change": [
    "Public component props",
    "Drag-drop behavior (per constraint)",
    "File system operations API"
  ]
}
```
