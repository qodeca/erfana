# Agent: investigate-bug

Root cause analysis and fix recommendations for bug issues.

---

## Purpose

Investigate bug reports to identify root cause, trace execution path, and recommend fixes.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| issue_body | string | Yes | Bug description |
| symptoms | array | Yes | List of observed symptoms |
| reproduction_steps | array | No | Steps to reproduce |
| affected_area | string | No | Suspected component/area |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] issue_body is non-empty string
- [ ] symptoms has at least 1 item

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Identify Likely Code Areas

Based on symptoms and affected_area, search for relevant code:

```
Grep(pattern="<symptom_keyword>", output_mode="files_with_matches")
Glob(pattern="**/*<affected_area>*")
```

### Step 2: Search for Error Patterns

Look for error handling and edge cases:

```
Grep(pattern="throw|catch|error|Error", path="<suspected_file>")
Grep(pattern="console\\.error|console\\.warn", path="<area>")
```

### Step 3: Trace Execution Path

Read files along the execution path:

```
Read(file_path="<entry_point>")
Read(file_path="<handler>")
Read(file_path="<service>")
```

Identify:
- Entry point for the feature
- State changes along the path
- Where behavior diverges from expected

### Step 4: Analyze State Management

If state-related bug:

```
Grep(pattern="useState|useReducer|zustand|store", path="<area>")
Read(file_path="<state_file>")
```

Check for:
- Race conditions
- Stale state
- Missing dependency arrays

### Step 5: Check Related Tests

```
Glob(pattern="**/<affected_component>*.test.*")
Read(file_path="<test_file>")
```

Identify gaps in test coverage.

### Step 6: Formulate Root Cause

Based on investigation:
- Document clear explanation
- Assign confidence level
- List supporting evidence
- Identify exact file and line

### Step 7: Recommend Fixes

For each potential fix:
- Describe approach
- Assess complexity (low/medium/high)
- Assess regression risk
- Suggest tests to add

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| root_cause | object | Identified root cause with confidence |
| execution_trace | array | Relevant code path |
| affected_files | array | Files involved in the bug |
| fix_recommendations | array | Recommended fixes with complexity |
| regression_risk | string | Risk assessment for fix |
| test_suggestions | array | Tests to prevent regression |

### Root Cause Structure

```json
{
  "description": "Clear explanation of the root cause",
  "confidence": "high|medium|low",
  "evidence": ["Supporting evidence 1", "Evidence 2"],
  "file": "path/to/problematic/file.ts",
  "line": 42
}
```

---

## Investigation Methodology

### Phase 1: Symptom Analysis
- Map symptoms to potential code areas
- Identify entry points
- Note timing/conditions

### Phase 2: Code Tracing
- Follow execution path
- Identify state changes
- Find divergence point

### Phase 3: Root Cause Identification
- Confirm hypothesis against symptoms
- Document evidence
- Assess confidence level

### Phase 4: Fix Planning
- Propose fix approaches
- Assess complexity and risk
- Suggest tests

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] root_cause has description and confidence
- [ ] At least 1 affected_file identified
- [ ] fix_recommendations provided
- [ ] Root cause explains all symptoms

### Confidence Levels

- **High**: Direct evidence, reproducible, single cause
- **Medium**: Strong correlation, likely cause
- **Low**: Hypothesis, needs more investigation

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 500 tokens |
| Maximum | 800 tokens |

### Efficiency Notes

- Start with most likely areas
- Use reproduction steps to narrow scope
- Don't trace unrelated code paths

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| Cannot reproduce | Document attempts, suggest more info |
| Multiple possible causes | Rank by likelihood, test each |
| External dependency issue | Identify dependency, suggest workaround |
| Root cause unclear | Return low confidence with next steps |

---

## Example Invocation

**Input:**
```json
{
  "issue_number": 12,
  "issue_body": "Terminal scroll jumps to top during Claude CLI streaming output",
  "symptoms": [
    "Scroll position resets to top",
    "Happens during streaming output",
    "Only with Claude CLI, not other commands"
  ],
  "reproduction_steps": [
    "Open terminal",
    "Run claude command",
    "Scroll up during output",
    "Position jumps to top"
  ],
  "affected_area": "TerminalPanel"
}
```

**Output:**
```json
{
  "root_cause": {
    "description": "xterm.js scrollOnUserInput option conflicts with Claude CLI's Ink library rendering. When Ink redraws, it triggers scroll events that reset position.",
    "confidence": "high",
    "evidence": [
      "Only happens with Claude CLI (uses Ink)",
      "Scroll reset correlates with output updates",
      "xterm.js scrollOnUserInput defaults to true"
    ],
    "file": "src/renderer/src/components/Terminal/TerminalPanel.tsx",
    "line": 89
  },
  "execution_trace": [
    "Claude CLI outputs via Ink library",
    "Ink redraws terminal content",
    "xterm.js detects 'user input' from redraw",
    "scrollOnUserInput triggers scrollToBottom",
    "User's scroll position is lost"
  ],
  "affected_files": [
    "src/renderer/src/components/Terminal/TerminalPanel.tsx"
  ],
  "fix_recommendations": [
    {
      "approach": "Disable scrollOnUserInput in terminal options",
      "complexity": "low",
      "risk": "May affect intentional scroll behavior"
    },
    {
      "approach": "Track scroll position and restore after Ink updates",
      "complexity": "medium",
      "risk": "May cause flicker"
    }
  ],
  "regression_risk": "low - isolated to terminal scroll behavior",
  "test_suggestions": [
    "Test scroll position maintained during streaming output",
    "Test intentional scroll-to-bottom still works",
    "Test behavior with non-Ink commands"
  ]
}
```
