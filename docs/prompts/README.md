# Prompt Templates

Dynamic, extensible AI prompts for markdown preview context menu actions using YAML frontmatter + Handlebars-style syntax with CSP-compliant rendering.

## Overview

**Location:** `src/renderer/src/prompts/`

The template system enables AI-powered text operations through right-click context menus in markdown preview.

## Quick Start

1. Right-click selected text in preview
2. Choose action: **Elaborate**, **Modify**, or custom template
3. Prompt sent to Terminal panel
4. Review/edit before execution (unless auto-execute enabled)

## Documentation

- [Template Syntax](./template-syntax.md) - Variables, conditionals, helpers
- [Examples](./examples.md) - Template examples and use cases

## Architecture

```
prompts/
├── templates/       # Template markdown files
├── parser.ts       # YAML frontmatter parser
├── renderer.ts     # CSP-safe renderer
├── schema.ts       # Zod validation
├── registry.ts     # Dynamic loader
├── helpers.ts      # Template helpers
└── types.ts        # TypeScript types
```

## Creating Templates

### Basic Template

```markdown
---
area: markdown-preview
subArea: context-menu
name: Summarize
icon: list
targetPanel: terminal
---
Summarize this text:

{{selectedText}}
```

### With User Input

```markdown
---
name: Modify
requiresInput: true
inputLabel: How to modify?
---
Modify: {{userInput}}

Text: {{selectedText}}
```

## Available Variables

- `{{selectedText}}` - Selected markdown
- `{{filePath}}` - Current file path
- `{{startLine}}`, `{{endLine}}` - Line numbers
- `{{fileRef}}` - File reference (@path:lines)
- `{{userInput}}` - User input (if required)

## Target Behavior

All templates target Terminal panel:
- `sendDirectly: false` - User can edit before running
- `autoExecute: true` - Auto-press Enter after paste

## Implementation Files

- Context menu: `PreviewContextMenu.tsx`
- Line tracking: `MarkdownPreview.tsx`
- Panel utilities: `panelUtils.ts`
- Templates: `templates/*.md`

## Related
- [Editor Documentation](../editor/README.md)
- [Terminal](../terminal.md)