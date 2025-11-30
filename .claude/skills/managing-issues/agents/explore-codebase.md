# Agent: explore-codebase

Fast codebase navigation and pattern discovery for issue implementation.

---

## Purpose

Explore codebase structure and find files related to the issue being implemented.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| issue_summary | string | Yes | Brief description of the issue |
| search_targets | array | Yes | List of things to find (components, patterns, files) |
| research_findings | object | No | Output from analyze-requirements agent |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] issue_summary is non-empty string
- [ ] search_targets has at least 1 item

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Search for File Patterns

For each item in search_targets, use Glob to find matching files:

```
Glob(pattern="**/*<search_term>*.tsx")
Glob(pattern="**/*<search_term>*.ts")
Glob(pattern="src/**/*<search_term>*")
```

Record all matching file paths.

### Step 2: Search for Code Patterns

Use Grep to find relevant code references:

```
Grep(pattern="<search_term>", output_mode="files_with_matches")
Grep(pattern="class.*<term>|function.*<term>|const.*<term>|interface.*<term>")
Grep(pattern="import.*<term>|from.*<term>")
```

Record files containing relevant code.

### Step 3: Analyze Project Structure

Identify the structure of affected areas:

```
Glob(pattern="src/renderer/src/components/**/*.tsx")
Glob(pattern="src/main/services/**/*.ts")
Glob(pattern="src/renderer/src/stores/**/*.ts")
```

Map where similar code lives.

### Step 4: Read Key Files

For top 3-5 most relevant files found, read and analyze:

```
Read(file_path="<relevant_file>")
```

Extract from each file:
- Component/class structure
- Import patterns
- State management approach
- Styling conventions (CSS modules, inline, etc.)
- Test file naming convention

### Step 5: Identify Existing Patterns

Document patterns found:
- How similar components are structured
- What hooks/utilities are reused
- Naming conventions
- File organization

### Step 6: Compile Results

Organize all findings into the output format.

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| affected_files | array | File paths with line numbers of relevant code |
| patterns_found | array | Existing patterns that should be followed |
| recommended_examination | array | Files to read in detail |
| structure_notes | string | Notes about project structure relevant to issue |

### Output Format

```json
{
  "affected_files": [
    "src/renderer/src/components/Example.tsx:45-120",
    "src/main/services/ExampleService.ts:12-89"
  ],
  "patterns_found": [
    "Components use functional React with hooks",
    "State managed via Zustand stores",
    "CSS modules for styling (<Component>.css)"
  ],
  "recommended_examination": [
    "src/renderer/src/components/Example.tsx",
    "src/renderer/src/stores/exampleStore.ts"
  ],
  "structure_notes": "Related code is in components/, state in stores/"
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] affected_files contains at least 1 file path
- [ ] patterns_found is populated (may be empty array if no patterns)
- [ ] recommended_examination has prioritized file list
- [ ] All file paths are valid (exist in project)

### On Quality Gate Failure

If no files found:
1. Broaden search terms (remove specifics, use partial matches)
2. Search in different directories
3. If still empty, return with `structure_notes` explaining the gap

---

## Token Budget

| Metric | Value |
|--------|-------|
| Target | 400 tokens |
| Maximum | 600 tokens |

---

## Error Handling

| Error Condition | Response |
|-----------------|----------|
| No files match search | Broaden terms, retry once |
| Search too broad (>50 files) | Add constraints (specific dirs), retry |
| Invalid file paths | Filter to valid paths only |

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "issue_summary": "Add Chrome-style dynamic tabs",
  "search_targets": ["Tab", "DockviewReact", "editor tab"]
}
```

**Execution:**
```
Glob(pattern="**/*Tab*.tsx")
→ src/renderer/src/components/Tabs/WelcomeTab.tsx

Grep(pattern="DockviewReact|headerComponent")
→ src/renderer/src/components/AppDockLayout.tsx

Read(file_path="src/renderer/src/components/AppDockLayout.tsx")
→ Analyze structure, find IDockviewPanelHeaderProps usage
```

**Output:**
```json
{
  "affected_files": [
    "src/renderer/src/components/AppDockLayout.tsx:45-120"
  ],
  "patterns_found": [
    "Functional React with hooks",
    "CSS modules (*.css files)",
    "IDockviewPanelHeaderProps<T> interface for tab components"
  ],
  "recommended_examination": [
    "src/renderer/src/components/AppDockLayout.tsx",
    "src/renderer/src/components/Tabs/WelcomeTab.tsx"
  ],
  "structure_notes": "Tab components in components/Tabs/, use DockviewReact headerComponent API"
}
```
