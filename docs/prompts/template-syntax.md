# Template Syntax Guide

## Frontmatter Configuration

Templates use YAML frontmatter for configuration:

```yaml
---
area: markdown-preview        # Required: Where template appears
subArea: context-menu         # Optional: Specific location
name: Template Name           # Required: Display name
icon: icon-name              # Required: Lucide icon
targetPanel: terminal        # Optional: Target panel (default: terminal)
sendDirectly: false         # Optional: Send without review
autoExecute: false          # Optional: Auto-press Enter
order: 0                    # Optional: Sort order in menu
enabled: true               # Optional: Show in UI
requiresInput: false        # Optional: Show input dialog
inputLabel: Enter details   # Optional: Input dialog label
inputPlaceholder: e.g...    # Optional: Input placeholder
---
```

### Field Reference

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `area` | enum | ✅ | `markdown-preview`, `code-editor`, `global` |
| `subArea` | enum | ❌ | `context-menu`, `toolbar`, `command-palette`, `mermaid-error` |
| `name` | string | ✅ | Display name |
| `icon` | string | ✅ | Lucide icon name |
| `targetPanel` | enum | ❌ | `terminal` |
| `sendDirectly` | bool | ❌ | Send immediately |
| `autoExecute` | bool | ❌ | Auto-execute command |
| `requiresInput` | bool | ❌ | Show input dialog |

## Template Variables

### Selection Variables
- `{{selectedText}}` - Selected markdown text
- `{{filePath}}` - Full file path
- `{{fullDocument}}` - Entire document content

### Line Variables
- `{{startLine}}` - Selection start line number
- `{{endLine}}` - Selection end line number
- `{{lineRange}}` - Formatted: "line 42" or "lines 42-58"
- `{{fileRef}}` - Reference: "@/path/file.md:42-58"

### User Input
- `{{userInput}}` - Input from dialog (when `requiresInput: true`)

## Conditionals

Use `{{#if}}` blocks for conditional content:

```handlebars
{{#if fileRef}}
File: {{fileRef}}
{{/if}}

{{#if userInput}}
User requested: {{userInput}}
{{/if}}
```

## Helper Functions

### formatLineRange
Format line range display:
```handlebars
{{formatLineRange startLine endLine}}
# Output: "line 42" or "lines 42-58"
```

### basename
Extract filename from path:
```handlebars
{{basename filePath}}
# Input: /path/to/file.md
# Output: file.md
```

### truncate
Truncate long text:
```handlebars
{{truncate selectedText 100}}
# Limits to 100 characters
```

### Other Helpers
- `{{dirname path}}` - Directory path
- `{{uppercase str}}` - UPPERCASE
- `{{lowercase str}}` - lowercase
- `{{pluralize count singular plural}}` - Pluralization

## CSP-Safe Rendering

Templates use custom regex-based rendering (no eval):

1. **Process conditionals** - `{{#if}}...{{/if}}`
2. **Process helpers** - `{{helper arg1 arg2}}`
3. **Process variables** - `{{variable}}`

## Icon Selection

Common Lucide icons:
- `maximize2` - Expand/explain
- `minimize2` - Simplify
- `refresh` - Rewrite
- `sparkles` - Improve
- `list` - Summarize
- `message-square` - Custom
- `bug` - Report issue

## Advanced Features

### Auto-Execute
```yaml
autoExecute: true
```
Automatically executes command in terminal (simulates Enter key).

### User Input Dialog
```yaml
requiresInput: true
inputLabel: How should this be modified?
inputPlaceholder: e.g., make more concise...
```
Shows dialog before execution, input available as `{{userInput}}`.

### Order Control
```yaml
order: 10
```
Controls menu item order (lower numbers first).

## Implementation
- Parser: `parser.ts` (YAML parsing)
- Renderer: `renderer.ts` (CSP-safe)
- Schema: `schema.ts` (Zod validation)
- Helpers: `helpers.ts` (Functions)