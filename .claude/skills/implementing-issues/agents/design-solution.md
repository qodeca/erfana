# Agent: design-solution

System design and implementation planning for issue implementation.

---

## Purpose

Design implementation approach and create detailed plan for the issue being implemented.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| issue_body | string | Yes | Full issue description |
| acceptance_criteria | array | Yes | List of acceptance criteria |
| affected_files | array | Yes | Output from explore-codebase agent |
| patterns_found | array | Yes | Patterns to follow from exploration |
| research_findings | object | No | Output from analyze-requirements agent |
| tier | number | Yes | Complexity tier (1, 2, or 3) |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] issue_body is non-empty string
- [ ] acceptance_criteria has at least 1 item
- [ ] affected_files is array
- [ ] tier is 1 or 2

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Analyze Requirements

Review issue details:
- Parse acceptance criteria into testable requirements
- Identify implicit requirements from issue body
- Note any constraints mentioned

### Step 2: Study Affected Code

For each file in affected_files:

```
Read(file_path="<affected_file>")
```

Understand:
- Current implementation approach
- Extension points available
- Dependencies and imports
- Test patterns used

### Step 3: Design Component Structure

Based on patterns_found, design:
- New files needed (components, hooks, utilities)
- Modifications to existing files
- State management approach
- Styling approach

### Step 4: Plan Implementation Steps

Create ordered list of implementation steps:
1. Each step should be atomic (one logical change)
2. Steps should have clear dependencies
3. Include file paths for each step

### Step 5: Define Test Strategy

Plan testing approach:
- Unit tests for new components/functions
- Integration tests for interactions
- Coverage target (>80% for new code)
- Test file locations

### Step 6: Identify Risks

List potential risks:
- Technical risks (API limitations, performance)
- Scope risks (edge cases, missing requirements)
- Integration risks (conflicts with existing code)

For each risk, define mitigation strategy.

### Step 7: Estimate Scope

Assess:
- Number of files affected
- Complexity (simple/medium/complex)
- New files to create
- Test files needed

### Step 8: Self-Verify Plan

Before finalizing, verify:
- [ ] All acceptance criteria addressed
- [ ] No conflicting steps
- [ ] Dependencies are satisfiable
- [ ] Patterns align with codebase
- [ ] Testing strategy covers changes

If verification fails: Revise plan and re-verify.

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| implementation_plan | object | Detailed plan with steps |
| file_changes | array | Files to create/modify with descriptions |
| test_strategy | object | Testing approach and coverage targets |
| risks | array | Identified risks with mitigations |
| estimates | object | Complexity and scope estimates |
| verification_criteria | array | Criteria for Phase 6 verification |

### Output Format

```json
{
  "implementation_plan": {
    "overview": "High-level approach summary",
    "steps": [
      {
        "order": 1,
        "description": "Create component file",
        "files": ["src/renderer/src/components/NewComponent.tsx"],
        "dependencies": []
      },
      {
        "order": 2,
        "description": "Add styling",
        "files": ["src/renderer/src/components/NewComponent.css"],
        "dependencies": [1]
      }
    ],
    "patterns_to_follow": ["Functional React", "CSS modules"],
    "patterns_to_avoid": ["Class components", "Inline styles"]
  },
  "file_changes": [
    {"path": "src/.../NewComponent.tsx", "action": "create", "description": "Main component"},
    {"path": "src/.../Existing.tsx", "action": "modify", "description": "Add import"}
  ],
  "test_strategy": {
    "coverage_target": 80,
    "test_types": ["unit", "integration"],
    "key_scenarios": ["rendering", "user interaction", "edge cases"]
  },
  "risks": [
    {
      "risk": "API may not support feature",
      "likelihood": "low",
      "impact": "medium",
      "mitigation": "Check API docs first, have fallback"
    }
  ],
  "estimates": {
    "complexity": "medium",
    "files_affected": 3,
    "new_files": 2
  },
  "verification_criteria": [
    "Component renders with all props",
    "User interactions work correctly",
    "Tests cover all acceptance criteria"
  ]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] implementation_plan has overview and at least 1 step
- [ ] file_changes lists all files mentioned in plan
- [ ] test_strategy defines coverage target
- [ ] risks array is populated (even if low risk)
- [ ] verification_criteria defined for Phase 6
- [ ] All acceptance criteria addressable by plan

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
| Acceptance criteria unclear | Note assumptions, flag for clarification |
| Conflicting requirements | Document conflict, request resolution |
| No clear implementation path | Present multiple options |
| Scope too large | Recommend splitting into multiple issues |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "issue_body": "Add Chrome-style dynamic tabs",
  "acceptance_criteria": [
    "Tabs resize dynamically",
    "Dirty indicator for unsaved files",
    "Context menu with Close, Close Others, Close All"
  ],
  "affected_files": ["src/renderer/src/components/AppDockLayout.tsx"],
  "patterns_found": ["Functional React", "CSS modules", "IDockviewPanelHeaderProps"],
  "tier": 2
}
```

**Output:**
```json
{
  "implementation_plan": {
    "overview": "Create EditorTab component using DockviewReact headerComponent API",
    "steps": [
      {"order": 1, "description": "Create EditorTab.tsx", "files": ["src/.../EditorTab.tsx"], "dependencies": []},
      {"order": 2, "description": "Create EditorTab.css", "files": ["src/.../EditorTab.css"], "dependencies": [1]},
      {"order": 3, "description": "Register in AppDockLayout", "files": ["src/.../AppDockLayout.tsx"], "dependencies": [1, 2]}
    ]
  },
  "file_changes": [
    {"path": "src/.../EditorTab.tsx", "action": "create"},
    {"path": "src/.../EditorTab.css", "action": "create"},
    {"path": "src/.../AppDockLayout.tsx", "action": "modify"}
  ],
  "test_strategy": {"coverage_target": 80, "test_types": ["unit"]},
  "risks": [{"risk": "DockviewReact API limitations", "likelihood": "low", "impact": "medium", "mitigation": "Check docs"}],
  "estimates": {"complexity": "medium", "files_affected": 3, "new_files": 2},
  "verification_criteria": ["EditorTab renders", "Dirty indicator works", "Context menu actions work"]
}
```
