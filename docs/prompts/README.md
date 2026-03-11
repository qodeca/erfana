# Prompt Templates

Dynamic, extensible AI prompts for context menu actions using YAML frontmatter + XML-structured content with Handlebars interpolation.

## Overview

**Location:** `src/renderer/src/prompts/`

The template system enables AI-powered text operations through right-click context menus in markdown preview and editor.

## Quick Start

1. Right-click selected text in preview or editor
2. Choose action: **Explain**, **Modify**, **Ask**, **Visualize**, or custom template
3. Prompt sent to Terminal panel
4. Review/edit before execution (unless auto-execute enabled)

## Documentation

- [Template Syntax](./template-syntax.md) - Variables, conditionals, helpers
- [Examples](./examples.md) - Template examples and use cases

### AutoExecute Implementation (v0.3.4)
- [Overview](./autoexecute-overview.md) - Feature overview and architecture
- [Technical Details](./autoexecute-technical.md) - Write pipeline and 200ms delay rationale
- [Testing](./autoexecute-testing.md) - Test coverage and mocking strategy
- [Reference](./autoexecute-reference.md) - Error handling and implementation files

## Architecture

```
prompts/
├── templates/       # Template markdown files (14 templates)
├── parser.ts        # YAML frontmatter parser
├── renderer.ts      # CSP-safe renderer
├── schema.ts        # Zod validation
├── registry.ts      # Dynamic loader
├── helpers.ts       # Template helpers
└── types.ts         # TypeScript types
```

## XML Structure (v0.6.3)

Templates use semantic XML tags to structure prompts for Claude Code:

```markdown
---
(YAML frontmatter)
---
<context>
{{#if fileRef}}{{fileRef}}
Source: {{basename filePath}} ({{formatLineRange startLine endLine}})
{{/if}}
</context>

<input>
{{selectedText}}
</input>

<task>
Primary instruction.
</task>

<instructions>
- Step-by-step guidance
</instructions>

<constraints>
- 200-300 words maximum
- No preamble
</constraints>

<output_format>
Expected response structure.
</output_format>
```

### XML Tags

| Tag | Purpose |
|-----|---------|
| `<context>` | File reference, location info |
| `<input>` | Selected text or user content |
| `<task>` | Primary instruction/objective |
| `<instructions>` | Step-by-step guidance |
| `<constraints>` | Limits and boundaries |
| `<output_format>` | Expected response structure |

## Thinking Triggers

Templates can include thinking triggers for Claude Code to enable deeper analysis:

| Trigger | Token Budget | Usage |
|---------|--------------|-------|
| "think" | ~4,000 | Baseline analysis |
| "think hard" | ~10,000 | Complex tasks |
| "ultrathink" | ~32,000 | Very complex problems |

**Applied in templates:**
- `explain.md`: "Think about the content..."
- `ask.md`: "Think about the question..."
- `visualize.md`: "Think hard about how to best represent..."

## Available Templates

### Preview context menu (area: markdown-preview)

| Template | Purpose | Input Required |
|----------|---------|----------------|
| `explain.md` | Explain selected text | No |
| `modify.md` | Apply modifications | Yes (instruction) |
| `ask.md` | Answer questions | Yes (question) |
| `visualize.md` | Generate Mermaid diagrams | Yes (diagram type dropdown) |
| `prompt.md` | Generic prompt | Yes (instruction) |
| `mermaid-chat.md` | Modify diagrams | No |
| `mermaid-bug-report.md` | Fix syntax errors | No |
| `mermaid-change-direction.md` | Change diagram direction | No |
| `organize-import.md` | Organize imported files | No |

### Editor context menu (area: code-editor) - v0.6.4-beta

| Template | Purpose | Input Required |
|----------|---------|----------------|
| `editor-explain.md` | Explain selected code/text | No |
| `editor-modify.md` | Apply modifications to code | Yes (instruction) |
| `editor-ask.md` | Answer questions about code | Yes (question) |
| `editor-visualize.md` | Generate diagrams from code | Yes (diagram type dropdown) |
| `editor-prompt.md` | Generic code prompt | Yes (instruction) |

### organize-import with AskUserQuestion (v0.6.3)

The organize-import template uses Claude Code's `AskUserQuestion` tool for interactive decision-making:

```markdown
<task>
Use the AskUserQuestion tool at each decision point for better UX.
</task>

<instructions>
## Phase 2: Location Decision
After analysis, use AskUserQuestion to present location options:
- Header: "File location"
- Question: "Where should this file be placed?"
</instructions>
```

This provides clickable UI buttons instead of text-based "Type 1/2/3" prompts.

## Available Variables

| Variable | Description |
|----------|-------------|
| `{{selectedText}}` | Selected markdown |
| `{{filePath}}` | Current file path |
| `{{startLine}}`, `{{endLine}}` | Line numbers |
| `{{fileRef}}` | File reference (@path:lines) |
| `{{userInput}}` | User input (if required) |
| `{{diagramType}}` | Mermaid diagram type (visualize) |
| `{{mermaidCode}}` | Existing diagram code |
| `{{importedFilePath}}` | Imported file path |

## Target Behavior

All templates target Terminal panel:
- `sendDirectly: false` - User can edit before running
- `autoExecute: true` - Auto-press Enter after paste
- **Auto-scroll (v0.5.4)** - Terminal scrolls to bottom 1 second after execution

## Implementation Files

- Context menu: `PreviewContextMenu.tsx`, `EditorContextMenu.tsx`
- Line tracking: `MarkdownPreview.tsx`
- Panel utilities: `panelUtils.ts`
- Templates: `templates/*.md`

## Related

- [Editor Documentation](../editor/README.md)
- [Terminal](../terminal/README.md)
