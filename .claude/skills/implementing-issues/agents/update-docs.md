# Agent: update-docs

Update project documentation after feature implementation.

---

## Purpose

Maintain CLAUDE.md, architecture docs, version history, and changelog entries.

---

## Input Contract

| Input | Type | Required | Validation |
|-------|------|----------|------------|
| issue_number | number | Yes | Valid GitHub issue number |
| issue_summary | string | Yes | Brief description of changes |
| files_changed | array | Yes | List of modified file paths |
| test_count | number | Yes | Current total test count |
| test_files | number | Yes | Current total test files |
| acceptance_criteria | array | Yes | What was implemented |
| is_user_facing | boolean | No | Whether change affects users |

### Input Validation

BEFORE execution, verify:
- [ ] issue_number is positive integer
- [ ] issue_summary is non-empty string
- [ ] files_changed is non-empty array
- [ ] test_count is positive integer

**If ANY validation fails: STOP, return error with details.**

---

## Execution Steps

### Step 1: Read Current CLAUDE.md

```
Read(file_path="CLAUDE.md")
```

Identify:
- Current version
- Location of "Recent Changes" section
- Test count format
- Documentation style

### Step 2: Prepare Change Entry

Format entry following existing style:

```markdown
## Changes in v0.X.Y
- **Feature Name** (Date):
  - Bullet point describing change
  - Another bullet point
  - Architecture: notes if significant
  - X new tests for feature
  - Files: `src/path/to/files/`
  - Closes #N
```

### Step 3: Update CLAUDE.md

Add entry to Recent Changes:

```
Edit(file_path="CLAUDE.md", old_string="## Changes in v...", new_string="## Changes in v...\n<new entry>\n\n## Changes in v...")
```

Update test count:

```
Edit(file_path="CLAUDE.md", old_string="**Total: X tests passing (Y test files)**", new_string="**Total: [test_count] tests passing ([test_files] test files)**")
```

### Step 4: Update Feature Docs (if user-facing)

If is_user_facing and feature docs exist:

```
Glob(pattern="docs/**/*.md")
Read(file_path="<relevant_doc>")
Edit(file_path="<relevant_doc>", ...)
```

### Step 5: Add JSDoc (if new public APIs)

For any new exported functions/classes:

```
Read(file_path="<file_with_exports>")
```

If missing JSDoc, add:
```typescript
/**
 * Brief description.
 * @param paramName - Parameter description
 * @returns Return description
 */
```

### Step 6: Verify Updates

Re-read CLAUDE.md to confirm:
- Entry added correctly
- Test count updated
- No formatting issues

---

## Output Contract

| Output | Type | Description |
|--------|------|-------------|
| files_updated | array | Documentation files modified |
| claude_md_section | string | Content added to CLAUDE.md |
| test_count_updated | boolean | Whether test count was updated |
| additional_docs | array | Other docs that may need updates |

### Output Format

```json
{
  "files_updated": ["CLAUDE.md"],
  "claude_md_section": "## Changes in v0.4.2\n- **Feature Name** (Nov 22, 2025):\n  - Description\n  - Closes #11",
  "test_count_updated": true,
  "additional_docs": ["docs/editor/README.md - may need update"]
}
```

---

## Quality Gate

Before returning output, ALL must be true:

- [ ] CLAUDE.md updated with new entry
- [ ] Test count matches current count
- [ ] Entry follows existing format
- [ ] Issue number referenced correctly

### On Quality Gate Failure

If format doesn't match:
1. Read more existing entries
2. Adjust to match format
3. Re-apply changes

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
| CLAUDE.md not found | Create minimal entry, flag for review |
| Format changed | Adapt to current format |
| Test count mismatch | Use provided count, note discrepancy |

---

## Documentation Format

### CLAUDE.md Entry Template

```markdown
## Changes in v0.X.Y
- **Feature Name** (Month DD, YYYY):
  - Bullet describing what changed
  - Another bullet with detail
  - Architecture: brief note (if architectural change)
  - X new tests for feature name
  - Files: `src/relevant/path/`
  - Closes #N
```

### Test Count Format

```markdown
- **Test Coverage**: **X tests passing (Y test files)**
```

---

## Example

**Input:**
```json
{
  "issue_number": 11,
  "issue_summary": "Add Chrome-style dynamic tabs",
  "files_changed": ["src/.../EditorTab.tsx", "src/.../EditorTab.css"],
  "test_count": 1392,
  "test_files": 62,
  "acceptance_criteria": ["Dynamic sizing", "Dirty indicator", "Context menu"],
  "is_user_facing": true
}
```

**Execution:**
```
Read(file_path="CLAUDE.md")
→ Find Recent Changes section

Edit(file_path="CLAUDE.md", old_string="## Changes in v0.4.1", new_string="## Changes in v0.4.2\n- **Chrome-style Dynamic Tabs** (Nov 22, 2025):\n  - EditorTab component with dynamic sizing\n  - Dirty indicator for unsaved changes\n  - Context menu: Close, Close Others, Close All\n  - 62 new tests\n  - Files: `src/renderer/src/components/Tabs/`\n  - Closes #11\n\n## Changes in v0.4.1")

Edit(file_path="CLAUDE.md", old_string="**1330 tests passing**", new_string="**1392 tests passing (62 test files)**")
```

**Output:**
```json
{
  "files_updated": ["CLAUDE.md"],
  "claude_md_section": "## Changes in v0.4.2\n- **Chrome-style Dynamic Tabs**...",
  "test_count_updated": true,
  "additional_docs": []
}
```
