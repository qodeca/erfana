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
| `area` | enum | ✅ | `markdown-preview`, `code-editor`, `global`, `diagram-viewer` |
| `subArea` | enum | ❌ | `context-menu`, `toolbar`, `command-palette`, `mermaid-error`, `mermaid-direction`, `chat` |
| `id` | string | ❌ | Unique identifier; generated from `name` when omitted |
| `name` | string | ✅ | Display name |
| `icon` | string | ✅ | One of the names in [Icon selection](#icon-selection); any other name falls back to `sparkles` |
| `targetPanel` | enum | ❌ | `terminal` |
| `sendDirectly` | bool | ❌ | Send immediately |
| `autoExecute` | bool | ❌ | Auto-execute command |
| `order` | number | ❌ | Sort order in menus (lower first, decimals allowed); default `0` |
| `enabled` | bool | ❌ | Show in UI; default `true` |
| `requiresInput` | bool | ❌ | Show input dialog |
| `inputLabel` | string | ❌ | Input field label |
| `inputPlaceholder` | string | ❌ | Input field placeholder |
| `dropdown` | object | ❌ | Dropdown configuration for selection-based prompts |
| `textareaOptional` | bool | ❌ | Allow submitting an empty text field when a dropdown is present |
| `mutatesDocument` | bool | ❌ | Add the "apply to document" footer so the agent edits the file in place; default `false` |

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

Only the 16 names in `src/renderer/src/utils/iconRegistry.tsx` render their own icon; any other name silently falls back to `sparkles`:

`maximize2`, `minimize2`, `refresh`, `sparkles`, `copy`, `edit-3`, `help-circle`, `message-circle`, `file-text`, `alert-circle`, `alert-triangle`, `arrow-right`, `arrow-down`, `arrow-up`, `arrow-left`, `mouse-pointer-click`

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