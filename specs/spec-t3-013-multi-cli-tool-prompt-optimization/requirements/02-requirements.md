# Requirements

## Functional requirements

### 013-FR-001: CLI tool dropdown in terminal toolbar

**Priority**: High
**Description**: Display a dropdown selector in the terminal toolbar that allows users to choose the active CLI tool from a list of supported tools. The dropdown should show the currently selected tool and update immediately upon selection.

**Acceptance**: Dropdown visible in toolbar, selection updates state, selected tool displayed.

**Traces to**: 013-TC-001

---

### 013-FR-002: Persist default CLI tool preference

**Priority**: High
**Description**: Store the user's CLI tool selection in GlobalSettings. Selection changes are persisted immediately (no explicit save action required). The selected tool persists across application restarts and is applied when the terminal initializes.

**State management**:
- **Source of truth**: GlobalSettings (persisted)
- **Runtime access**: TerminalStore reads from GlobalSettings and exposes current selection
- **Persistence trigger**: Immediate on dropdown change (like other settings)

**Acceptance**: Selection survives restart, new terminals use saved default, settings overlay shows current value, changes persist immediately without explicit save.

**Traces to**: 013-TC-002

---

### 013-FR-003: Dedicated prompt templates per tool

**Priority**: High
**Description**: Create dedicated prompt template versions for each supported CLI tool, organized by area in subdirectories. Each tool has its own set of optimized templates that use the tool's preferred conventions for context blocks, instructions, and code references.

**Template structure** (nested by tool, then area):
```
templates/
├── claude-code/
│   ├── markdown-preview/
│   │   ├── explain.md
│   │   ├── modify.md
│   │   └── ... (5 files)
│   ├── monaco-editor/ (5 files)
│   ├── mermaid-viewer/ (3 files)
│   └── other/ (1 file)
├── codex/
│   └── ... (same structure, 14 files)
└── gemini-cli/
    └── ... (same structure, 14 files)
```

**Acceptance**: Each prompt type has dedicated template versions for all supported tools; correct template selected based on active tool; templates organized in tool subfolders.

**Traces to**: 013-TC-003, 013-TC-004

---

### 013-FR-004: CLI tool registry with template mappings

**Priority**: Medium
**Description**: Implement a tool registry that defines supported CLI tools with their metadata, format configurations, and template mappings. The registry serves as the single source of truth for tool definitions. Adding a new tool requires: (1) a registry entry, and (2) dedicated template versions for all prompt types.

**Registry entry includes**:
- Tool identifier (slug)
- Display name
- Context block format (e.g., XML tags, markdown headers, plain text)
- Code reference format (e.g., `@file:line` vs `file#L10`)
- Supported features (e.g., file references, image input)
- Template path pattern (e.g., `templates/{tool}/{area}/{prompt}.md`)

**Traces to**: 013-TC-005

---

### 013-FR-005: CLI tool selection state accessibility

**Priority**: Medium
**Description**: Make the current CLI tool selection accessible throughout the prompt execution flow. The terminal store should expose the selected tool so that prompt rendering, variable factories, and any tool-specific logic can access it.

**Traces to**: 013-TC-003

---

### 013-FR-006: Tool-optimized template implementations

**Priority**: High
**Description**: Create dedicated template files for each supported CLI tool, optimized for the tool's specific conventions and capabilities. Each template version is hand-crafted to produce optimal results for its target tool.

**Template conventions by tool**:
1. **Claude Code**: XML-style blocks (`<context>`, `<task>`, `<constraints>`), `@file:line` references, structured output instructions
2. **Codex**: Markdown-style with headers and code fences, standard file paths, concise instructions
3. **Gemini CLI**: Plain text with clear section headers, standard file references, natural language formatting

**Template organization**: `templates/{tool-slug}/{area}/{prompt}.md` (e.g., `templates/claude-code/markdown-preview/explain.md`)

**Traces to**: 013-TC-004

---

### 013-FR-007: Template fallback behavior

**Priority**: Medium
**Description**: Define graceful fallback behavior when a tool-specific template is missing. If the selected tool's template does not exist, fall back to the Claude Code version of that template with a console warning logged for debugging.

**Fallback chain**:
1. Try: `{area}/{prompt}-{selected-tool}.md`
2. Fallback: `{area}/{prompt}-claude-code.md`
3. Error: If Claude Code template also missing, show user-facing error

**Acceptance**: Missing tool template falls back to Claude Code version; warning logged to console; user sees prompt execute (not fail); error shown only if all fallbacks exhausted.

**Traces to**: 013-TC-008

---

### 013-FR-008: Tool-specific variable formatting

**Priority**: High
**Description**: Implement tool-aware variable formatting in the variable factory. Each tool may have different conventions for file references, line numbers, and code blocks. The variable factory must generate tool-appropriate values.

**Format variations by tool**:
| Variable | Claude Code | Codex | Gemini CLI |
|----------|-------------|-------|------------|
| File reference | `@/path/file.md:10-15` | `/path/file.md#L10-L15` | `/path/file.md (lines 10-15)` |
| Code block | XML tags | Markdown fences | Plain indentation |

**Acceptance**: `computeFileRef()` and related functions accept tool parameter; output format matches tool conventions; existing Claude Code behavior unchanged when Claude Code selected.

**Traces to**: 013-TC-003, 013-TC-004

---

## Non-functional requirements

### 013-NFR-001: Prompt adaptation performance

**Priority**: High
**Description**: Tool-specific prompt adaptation must add no more than 50ms latency to the prompt rendering pipeline. Users should not perceive any delay when executing prompts.

**Metric**: Measured from template input to formatted output.

---

### 013-NFR-002: Extensibility for future tools

**Priority**: Medium
**Description**: The architecture must support adding new CLI tools with a well-defined process. Adding a new tool requires:
1. A registry entry with format configuration and template path pattern
2. Dedicated template versions for all prompt types (can use existing templates as starting point)
3. Tool-specific variable factory configuration (for file reference format)

**Quantitative metric**: Adding a new CLI tool must require modifications to no more than 3 source files (registry, variable factory config, templates directory). No changes to core rendering logic or existing tool templates should be required.

**Traces to**: 013-TC-009

---

### 013-NFR-003: Backward compatibility

**Priority**: High
**Description**: Existing prompt templates must work without modification. The default tool (Claude Code) must produce output identical to the current system behavior. No existing user workflows should break.

---

### 013-NFR-004: Settings migration

**Priority**: Low
**Description**: If GlobalSettings schema changes, provide migration for existing users. Default to Claude Code for users without a prior selection.

**Traces to**: 013-TC-010

---

### 013-NFR-005: UI consistency

**Priority**: Medium
**Description**: The CLI tool dropdown must follow the existing UI style guide and design tokens. Use standard dropdown component patterns consistent with other toolbar controls. Dropdown must be keyboard accessible (Tab, Enter, Arrow keys per WCAG 2.1).

**Traces to**: 013-TC-011

---

### 013-NFR-006: Template maintainability

**Priority**: Medium
**Description**: The template organization must balance tool-specific optimization with long-term maintainability. While 42 separate template files provide maximum flexibility, shared logic should be extracted where possible to reduce duplication and drift risk.

**Guidelines**:
1. Common instructions that apply to all tools should be documented in a shared reference
2. Tool-specific templates may import or reference shared content where appropriate
3. Template linting should verify consistent structure across tool variants
4. Changes to prompt logic should be reviewed for impact across all tool versions

**Metric**: Core prompt logic duplication across tool variants should not exceed 60%. Tool-specific customizations (context format, references) account for the remaining variance.

---

### 013-NFR-007: Error handling

**Priority**: Medium
**Description**: The system must handle errors gracefully throughout the prompt flow. Template loading failures, registry lookup errors, and variable factory exceptions should be caught and reported without crashing the application.

**Error scenarios**:
- Missing template file → fallback per 013-FR-007
- Invalid registry entry → log error, exclude tool from dropdown
- Variable factory error → log error, use raw values

---

### 013-NFR-008: Observability

**Priority**: Low
**Description**: Log tool selection and prompt execution for debugging. When a user reports prompt issues, logs should indicate which tool was selected and which template was used.

**Log entries**:
- Tool selection change: `[TerminalStore] CLI tool changed: claude-code → codex`
- Template resolution: `[PromptRegistry] Resolved: explain → markdown-preview/explain-codex.md`
- Fallback triggered: `[PromptRegistry] WARN: Template not found, falling back to claude-code`
