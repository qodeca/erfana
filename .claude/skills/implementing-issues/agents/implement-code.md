# Agent: implement-code

Write production-quality code following approved implementation plan.

---

## Purpose

Implement code changes according to the approved plan, following codebase patterns.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| implementation_plan | object | Yes | Approved plan from design-solution agent |
| step_number | number | No | Specific step to implement (default: all) |
| patterns_to_follow | array | Yes | Patterns from exploration |
| existing_code_context | string | No | Relevant existing code snippets |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] implementation_plan has steps array
- [ ] patterns_to_follow is non-empty array
- [ ] If step_number provided, it exists in plan

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Review Plan

Read the implementation plan:
- Understand the overall approach
- Identify files to create/modify
- Note patterns to follow and avoid

### Step 2: Read Existing Code

For files to modify, read current content:

```
Read(file_path="<file_to_modify>")
```

For new files, read similar existing files:

```
Read(file_path="<similar_existing_file>")
```

Understand structure, imports, patterns.

### Step 3: Create New Files

For each new file in the plan:

```
Write(file_path="<new_file_path>", content="<file_content>")
```

Follow patterns from similar files:
- Same import structure
- Same component/class structure
- Same export patterns
- Same styling approach

### Step 4: Modify Existing Files

For each file to modify:

```
Edit(file_path="<existing_file>", old_string="<original>", new_string="<modified>")
```

Make minimal, focused changes:
- Add imports at top
- Add new code where appropriate
- Don't refactor unrelated code

### Step 5: Verify Typecheck

After all changes:

```
Bash(command="npm run typecheck")
```

If errors:
1. Read error messages
2. Fix type errors
3. Re-run typecheck
4. Repeat until clean

### Step 6: Compile Results

Document what was created/modified.

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| files_created | array | New files created with paths |
| files_modified | array | Existing files modified with paths |
| implementation_notes | string | Notes about implementation decisions |
| typecheck_status | string | Result of typecheck (pass/fail) |
| next_steps | array | Recommended next actions |

### Output Format

```json
{
  "files_created": [
    "src/renderer/src/components/Tabs/EditorTab.tsx",
    "src/renderer/src/components/Tabs/EditorTab.css"
  ],
  "files_modified": [
    "src/renderer/src/components/AppDockLayout.tsx"
  ],
  "implementation_notes": "Used IDockviewPanelHeaderProps interface. Added dirty state from panel params.",
  "typecheck_status": "pass",
  "next_steps": [
    "Write tests for EditorTab",
    "Test manually in dev mode"
  ]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] All planned files for step(s) are created/modified
- [ ] typecheck_status is "pass"
- [ ] No "while I'm here" changes outside plan
- [ ] Code follows specified patterns

### On Quality Gate Failure

If typecheck fails:
1. Read error output
2. Fix each error
3. Re-run typecheck
4. After 3 attempts, report remaining errors

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 600 tokens |
| Maximum | 1000 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| Plan step unclear | Request clarification |
| Pattern conflict | Document conflict, use plan recommendation |
| Typecheck errors | Attempt fix, report if unresolvable |
| Missing dependency | Note in implementation_notes |

---

## Constraints

- NEVER add features not in the plan
- NEVER refactor surrounding code ("while I'm here...")
- NEVER add comments/documentation beyond plan
- ALWAYS verify typecheck after changes
- ALWAYS follow existing patterns over "better" approaches

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "implementation_plan": {
    "steps": [
      {"order": 1, "description": "Create EditorTab.tsx", "files": ["src/.../EditorTab.tsx"]}
    ]
  },
  "step_number": 1,
  "patterns_to_follow": ["Functional React", "CSS modules", "IDockviewPanelHeaderProps"]
}
```

**Execution:**
```
Read(file_path="src/renderer/src/components/Tabs/WelcomeTab.tsx")
→ Understand existing tab structure

Write(file_path="src/renderer/src/components/Tabs/EditorTab.tsx", content="...")
→ Create new component following pattern

Bash(command="npm run typecheck")
→ Verify no type errors
```

**Output:**
```json
{
  "files_created": ["src/renderer/src/components/Tabs/EditorTab.tsx"],
  "files_modified": [],
  "implementation_notes": "Based on WelcomeTab structure",
  "typecheck_status": "pass",
  "next_steps": ["Create EditorTab.css", "Write tests"]
}
```
