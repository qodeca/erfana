# Acceptance criteria

## Test cases

### 013-TC-001: CLI tool dropdown displays and functions

**Description**: Verify the CLI tool dropdown appears in the terminal toolbar and allows selection.

**Preconditions**: Application running with terminal panel visible.

**Steps**:
1. Locate the terminal toolbar
2. Find the CLI tool dropdown
3. Click to open the dropdown
4. Verify all supported tools are listed (Claude Code, Codex, Gemini CLI)
5. Select "Codex" from the list
6. Verify the dropdown displays "Codex" as selected

**Expected result**: Dropdown shows all tools, selection updates immediately, selected tool name displayed.

**Traces to**: 013-FR-001

---

### 013-TC-002: CLI tool preference persists across restarts

**Description**: Verify the selected CLI tool is saved and restored on application restart.

**Preconditions**: Application running, default tool is Claude Code.

**Steps**:
1. Open CLI tool dropdown
2. Select "Gemini CLI"
3. Close the application
4. Reopen the application
5. Check the CLI tool dropdown value

**Expected result**: Dropdown shows "Gemini CLI" after restart.

**Traces to**: 013-FR-002

---

### 013-TC-003: Correct template version selected per tool

**Description**: Verify the system selects the correct dedicated template version based on the active CLI tool.

**Preconditions**: Text selected in editor, terminal open, dedicated templates exist for all tools.

**Steps**:
1. Select "Claude Code" as CLI tool
2. Trigger "Explain" prompt from context menu
3. Verify output uses Claude Code template (XML blocks: `<context>`, `<task>`)
4. Change CLI tool to "Codex"
5. Trigger the same "Explain" prompt
6. Verify output uses Codex template (markdown with headers and code fences)
7. Change CLI tool to "Gemini CLI"
8. Trigger the same "Explain" prompt
9. Verify output uses Gemini CLI template (plain text with section headers)

**Expected result**: Each tool uses its dedicated template version; output format matches tool conventions.

**Traces to**: 013-FR-003, 013-FR-005

---

### 013-TC-004: All tool templates exist and produce valid output

**Description**: Verify dedicated template versions exist for all prompt types and all tools (42 files total), and each produces well-formed output.

**Preconditions**: Template directory accessible.

**Steps**:
1. Verify template directory structure exists (3 tools × 14 templates = 42 files):

   **Claude Code** (`templates/claude-code/`):
   - `markdown-preview/`: explain.md, modify.md, ask.md, visualize.md, prompt.md
   - `monaco-editor/`: explain.md, modify.md, ask.md, visualize.md, prompt.md
   - `mermaid-viewer/`: chat.md, bug-report.md, change-direction.md
   - `other/`: organize-import.md

   **Codex** (`templates/codex/`):
   - Same structure as claude-code (14 files)

   **Gemini CLI** (`templates/gemini-cli/`):
   - Same structure as claude-code (14 files)

2. For each CLI tool (Claude Code, Codex, Gemini CLI):
   a. Select the tool
   b. Execute each prompt type from all contexts (preview, editor, diagram viewer)
   c. Verify output matches the tool's expected format conventions
   d. Verify no rendering errors or malformed output

**Expected result**: All 42 template versions exist; all prompts render correctly with tool-appropriate formatting.

**Traces to**: 013-FR-003, 013-FR-006, 013-FR-008

---

### 013-TC-005: Tool registry contains all required metadata and template mappings

**Description**: Verify the tool registry provides complete definitions including template path patterns for all supported tools.

**Preconditions**: Access to tool registry (code inspection or API).

**Steps**:
1. Retrieve tool registry entries
2. For each tool, verify presence of:
   - Unique identifier (slug)
   - Display name
   - Context block format specification
   - Code reference format specification
   - Template path pattern
3. Verify no duplicate identifiers
4. Verify template path patterns resolve to existing template files

**Expected result**: All tools have complete, valid metadata with template mappings; no duplicates; all referenced templates exist.

**Traces to**: 013-FR-004

---

### 013-TC-006: No performance regression

**Description**: Verify prompt adaptation does not introduce noticeable latency compared to the pre-Spec #013 system.

**Preconditions**: Baseline prompt rendering time measured on pre-Spec #013 codebase (before multi-tool implementation).

**Steps**:
1. Record baseline: Measure prompt rendering time in current system (pre-Spec #013)
2. Implement Spec #013 changes
3. Select "Claude Code" as CLI tool (same as baseline behavior)
4. Measure prompt rendering time for 10 prompts of various types
5. Calculate average additional latency vs baseline

**Expected result**: Average additional latency is less than 50ms compared to baseline.

**Traces to**: 013-NFR-001

---

### 013-TC-007: Backward compatibility with existing templates

**Description**: Verify existing templates produce identical output when Claude Code is selected.

**Preconditions**: Archive of current prompt outputs for comparison.

**Steps**:
1. Select "Claude Code" as CLI tool
2. Generate prompts using existing templates
3. Compare output character-by-character with archived baseline
4. Repeat for all prompt types

**Expected result**: Output is identical to baseline for Claude Code selection.

**Traces to**: 013-NFR-003

---

### 013-TC-008: Template fallback behavior

**Description**: Verify the system gracefully falls back to Claude Code template when a tool-specific template is missing.

**Preconditions**: Temporarily remove or rename one Codex template file (e.g., `explain-codex.md`).

**Steps**:
1. Select "Codex" as CLI tool
2. Trigger "Explain" prompt (whose template was removed)
3. Observe console for warning message
4. Verify prompt executes successfully
5. Verify output uses Claude Code format (fallback)
6. Restore the removed template file

**Expected result**: Prompt executes without error; warning logged to console; output uses Claude Code fallback format.

**Traces to**: 013-FR-007

---

### 013-TC-009: Extensibility - adding new tool

**Description**: Verify a new CLI tool can be added by modifying only the specified files.

**Preconditions**: Access to source code.

**Steps**:
1. Add a mock tool "TestCLI" to the tool registry:
   - Add registry entry with format configuration
   - Add variable factory configuration for file reference format
   - Create one test template (e.g., `explain-test-cli.md`)
2. Verify no changes required to:
   - Core rendering logic (`renderer.ts`)
   - Existing tool templates
   - Template selection logic
3. Restart application
4. Verify "TestCLI" appears in dropdown
5. Select "TestCLI" and execute a prompt
6. Verify correct template is used

**Expected result**: New tool added with changes to ≤3 source files; existing functionality unaffected; new tool works correctly.

**Traces to**: 013-NFR-002

---

### 013-TC-010: Settings migration for existing users

**Description**: Verify existing users without CLI tool preference are migrated correctly.

**Preconditions**: GlobalSettings file exists without `cliTool` field (simulating pre-Spec #013 user).

**Steps**:
1. Create/modify GlobalSettings to remove `cliTool` field
2. Launch application with Spec #013 changes
3. Check CLI tool dropdown value
4. Check GlobalSettings file for `cliTool` field

**Expected result**: Dropdown shows "Claude Code" (default); GlobalSettings updated with `cliTool: "claude-code"`.

**Traces to**: 013-NFR-004

---

### 013-TC-011: Dropdown keyboard accessibility

**Description**: Verify CLI tool dropdown is fully keyboard accessible per WCAG 2.1.

**Preconditions**: Application running with terminal panel visible.

**Steps**:
1. Use Tab key to navigate to CLI tool dropdown
2. Verify dropdown receives focus (visible focus indicator)
3. Press Enter or Space to open dropdown
4. Use Arrow keys to navigate options
5. Press Enter to select an option
6. Verify selection updates
7. Press Escape to close dropdown without selecting

**Expected result**: All interactions work via keyboard; focus is visible throughout; selection updates correctly.

**Traces to**: 013-NFR-005

---

## Definition of done

- [ ] CLI tool dropdown implemented in terminal toolbar (keyboard accessible)
- [ ] All three CLI tools (Claude Code, Codex, Gemini CLI) available in dropdown
- [ ] Default tool selection persists in GlobalSettings (immediate persistence)
- [ ] GlobalSettings schema updated with `cliTool` field and migration for existing users
- [ ] Tool registry implemented with complete metadata and template mappings for all tools
- [ ] Template directory restructured to `templates/{area}/{prompt}-{tool}.md`
- [ ] Dedicated template versions created for all prompt types × all tools (42 files)
- [ ] Template selection logic routes to correct version based on active tool
- [ ] Template fallback to Claude Code when tool-specific template missing
- [ ] Tool-specific variable formatting implemented (`computeFileRef()` per tool)
- [ ] Terminal store exposes current tool selection
- [ ] Performance overhead under 50ms vs baseline
- [ ] Claude Code templates produce output identical to current system behavior
- [ ] UI follows design tokens and style guide
- [ ] Dropdown logs tool selection changes for debugging
- [ ] Unit tests cover template selection logic, registry, and fallback behavior
- [ ] Test coverage ≥ 80% for new code
- [ ] All test cases (013-TC-001 through 013-TC-011) pass
