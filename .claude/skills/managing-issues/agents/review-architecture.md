# Agent: review-architecture

Architectural quality review for implemented code changes.

---

## Purpose

Evaluate the architectural quality of implementation against SOLID principles, design patterns, and software engineering best practices. This agent reviews the *actual code* produced, not just whether it matches the plan.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| files_changed | array | Yes | List of modified file paths |
| implementation_plan | object | Yes | Approved plan from design-solution |
| tier | number | Yes | Complexity tier (2 or 3) |
| codebase_patterns | object | No | Established patterns in the codebase |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] files_changed is non-empty array
- [ ] implementation_plan is object with steps
- [ ] tier is 2 (not used for tier 1)

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Read Changed Files

For each file in files_changed:

```
Read(file_path="<changed_file>")
```

Build mental model of:
- Component structure
- Dependencies between files
- Public interfaces exposed

### Step 2: Analyze Single Responsibility Principle

For each component/class/module:

**Questions to answer:**
- Does this have ONE clear purpose?
- Would changes to feature X affect unrelated feature Y?
- Can you describe its responsibility in one sentence without "and"?

**Detection patterns:**
```
Grep(pattern="class|function|const.*=.*=>|export default", path="<file>")
```

**Red flags:**
- Components > 300 lines
- Multiple unrelated imports (UI + API + Storage)
- Methods that don't use `this` / component state
- "Manager", "Handler", "Processor" in names (often do too much)

### Step 3: Analyze Open/Closed Principle

**Check for:**
- Can new behavior be added without modifying existing code?
- Are there switch statements on type/kind that grow with features?

**Red flags:**
```
Grep(pattern="switch.*type|if.*typeof|instanceof", path="<file>")
```

- Multiple `if/else if` chains on type discrimination
- Hardcoded lists that grow with features
- No extension points (no interfaces, no composition)

### Step 4: Analyze Liskov Substitution Principle

**Check for:**
- Do subclasses/implementations behave consistently with their base?
- Any type narrowing or `instanceof` checks?

**Red flags:**
- Methods that throw "not implemented"
- Overridden methods with different side effects
- Type guards immediately after interface usage

### Step 5: Analyze Interface Segregation Principle

**Check for:**
- Are interfaces focused and minimal?
- Do consumers use all methods of interfaces they depend on?

**Red flags:**
- Interfaces with > 7 methods
- Optional methods in interfaces (?)
- Implementations with empty method bodies

### Step 6: Analyze Dependency Inversion Principle

**Check for:**
- Do high-level modules depend on abstractions?
- Are dependencies injected rather than created?

**Detection:**
```
Grep(pattern="new [A-Z]|import.*from.*\\.\\./", path="<file>")
```

**Red flags:**
- Direct instantiation of dependencies (`new ConcreteClass()`)
- Imports crossing architectural boundaries
- Global singletons used directly

### Step 7: Evaluate Coupling

**Assess coupling levels:**

```
Grep(pattern="import.*from", path="<file>")
```

**Metrics to consider:**
- Number of imports from other modules
- Depth of import paths (../../../)
- Circular dependency potential

**Coupling Matrix:**
| Level | Characteristics | Action |
|-------|----------------|--------|
| Low | Interfaces, events, messages | Acceptable |
| Medium | Direct function calls, shared types | Review necessity |
| High | Shared mutable state, internal access | Flag for refactor |

### Step 8: Evaluate Cohesion

**Check each module for:**
- Do all functions/methods work toward same goal?
- Are related things grouped together?

**Red flags:**
- "Utility" files with unrelated functions
- Components mixing UI, data fetching, and business logic
- Files named *Helper, *Utils, *Common

### Step 9: Check Dependency Directions

**Verify layer boundaries:**

```
Correct:
  components → hooks → stores → services → utils

Violations:
  services → components (service importing React)
  utils → stores (utility depending on state)
```

**Detection:**
```
Grep(pattern="import.*from.*@/components", path="src/main/")
→ Should find nothing (main shouldn't import renderer components)
```

### Step 10: Anti-Pattern Detection

**Check for common anti-patterns:**

| Anti-Pattern | Detection | Impact |
|--------------|-----------|--------|
| God Object | Single file with many responsibilities | High |
| Feature Envy | Methods using more external state than own | Medium |
| Shotgun Surgery | Small change requires many file edits | High |
| Primitive Obsession | Strings/numbers instead of domain types | Medium |
| Data Clumps | Same group of fields repeated | Low |

### Step 11: Compile Findings

Categorize by severity:
- **Critical**: Fundamental architectural flaw
- **High**: Significant principle violation
- **Medium**: Minor concern, can defer
- **Low**: Suggestion for improvement

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| assessment | string | "SOUND" / "NEEDS_IMPROVEMENT" / "ARCHITECTURAL_ISSUES" |
| solid_analysis | object | Assessment of each SOLID principle |
| coupling_score | string | "low" / "medium" / "high" |
| cohesion_score | string | "high" / "medium" / "low" |
| findings | array | List of architectural issues found |
| critical_issues | array | Issues that MUST be addressed |
| recommendations | array | Improvement suggestions |
| technical_debt | array | Debt introduced (for documentation) |

### SOLID Analysis Structure

```json
{
  "single_responsibility": {
    "status": "pass|warn|fail",
    "notes": "Assessment details",
    "violations": []
  },
  "open_closed": { ... },
  "liskov_substitution": { ... },
  "interface_segregation": { ... },
  "dependency_inversion": { ... }
}
```

### Finding Structure

```json
{
  "severity": "critical|high|medium|low",
  "principle": "SRP|OCP|LSP|ISP|DIP|coupling|cohesion|pattern",
  "file": "path/to/file.ts",
  "line": 42,
  "issue": "Description of the architectural issue",
  "impact": "What problems this could cause",
  "recommendation": "How to fix"
}
```

### Output Format

```json
{
  "assessment": "NEEDS_IMPROVEMENT",
  "solid_analysis": {
    "single_responsibility": {
      "status": "warn",
      "notes": "Component handles both UI and data fetching",
      "violations": [{"file": "Component.tsx", "line": 45}]
    },
    "open_closed": {"status": "pass", "notes": "Uses composition appropriately"},
    "liskov_substitution": {"status": "pass", "notes": "N/A - no inheritance"},
    "interface_segregation": {"status": "pass", "notes": "Interfaces are focused"},
    "dependency_inversion": {"status": "fail", "notes": "Direct service instantiation"}
  },
  "coupling_score": "medium",
  "cohesion_score": "high",
  "findings": [
    {
      "severity": "high",
      "principle": "DIP",
      "file": "src/.../Component.tsx",
      "line": 12,
      "issue": "Direct instantiation of FileService",
      "impact": "Cannot mock in tests, tight coupling",
      "recommendation": "Inject service via context or props"
    }
  ],
  "critical_issues": [],
  "recommendations": [
    "Extract data fetching logic to custom hook",
    "Consider using factory pattern for service creation"
  ],
  "technical_debt": [
    "Mixed concerns in Component.tsx - tracked for future refactor"
  ]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All files_changed have been analyzed
- [ ] assessment status is determined
- [ ] All 5 SOLID principles evaluated
- [ ] coupling_score and cohesion_score assigned
- [ ] findings categorized by severity
- [ ] critical_issues extracted from findings

### Assessment Logic

- `SOUND`: No critical issues, max 2 high severity issues
- `NEEDS_IMPROVEMENT`: Has high severity issues OR multiple medium issues
- `ARCHITECTURAL_ISSUES`: Has critical issues

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 800 tokens |
| Maximum | 1200 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| File not found | Skip file, note in findings |
| Too many files (>15) | Focus on new/heavily modified files |
| Complex inheritance | Document, recommend expert review |
| Unclear architecture | Note ambiguity, recommend team discussion |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "files_changed": [
    "src/renderer/src/components/Tabs/EditorTab.tsx",
    "src/renderer/src/components/Tabs/EditorTab.css",
    "src/renderer/src/components/AppDockLayout.tsx"
  ],
  "implementation_plan": {"overview": "Chrome-style tabs"},
  "tier": 2
}
```

**Execution:**
```
Read(file_path="src/.../EditorTab.tsx")
→ Component handles rendering, state, context menu

Grep(pattern="import.*from", path="src/.../EditorTab.tsx")
→ 5 imports, all from same layer (renderer)

Grep(pattern="new [A-Z]", path="src/.../EditorTab.tsx")
→ No direct instantiation

→ Analyze SOLID, coupling, cohesion
```

**Output:**
```json
{
  "assessment": "SOUND",
  "solid_analysis": {
    "single_responsibility": {"status": "pass", "notes": "Tab rendering only"},
    "open_closed": {"status": "pass", "notes": "Props-based customization"},
    "liskov_substitution": {"status": "pass", "notes": "N/A"},
    "interface_segregation": {"status": "pass", "notes": "Minimal props interface"},
    "dependency_inversion": {"status": "pass", "notes": "Uses context for services"}
  },
  "coupling_score": "low",
  "cohesion_score": "high",
  "findings": [
    {
      "severity": "low",
      "principle": "SRP",
      "file": "EditorTab.tsx",
      "line": 85,
      "issue": "Context menu logic could be extracted",
      "impact": "Minor - component still focused",
      "recommendation": "Consider useContextMenu hook for reuse"
    }
  ],
  "critical_issues": [],
  "recommendations": ["Consider extracting context menu to reusable hook"],
  "technical_debt": []
}
```
