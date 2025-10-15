# Prompt Templates

**Location:** `src/renderer/src/prompts/`

Erfana's prompt template system provides dynamic, extensible AI prompts for markdown preview context menu actions. Templates use YAML frontmatter + Handlebars-style syntax with CSP-compliant rendering.

## Architecture Overview

The template system consists of 6 core modules:

```
src/renderer/src/prompts/
├── templates/           # Template markdown files
│   ├── elaborate.md
│   ├── improve.md
│   ├── rewrite.md
│   └── simplify.md
├── parser.ts           # YAML frontmatter parser
├── renderer.ts         # CSP-safe template renderer
├── schema.ts           # Zod validation
├── registry.ts         # Dynamic template loader
├── helpers.ts          # Template helper functions
└── types.ts            # TypeScript interfaces
```

**Key Design Decisions:**
- **CSP Compliance**: Custom renderer (no `eval()` or `new Function()`)
- **Browser Compatible**: js-yaml instead of gray-matter (no Node.js Buffer API)
- **Type Safe**: Zod schema validation for frontmatter
- **Hot Reload**: Templates load dynamically via Vite's `import.meta.glob()`

## Template File Structure

Templates are markdown files with YAML frontmatter:

```markdown
---
area: markdown-preview
subArea: context-menu
name: Elaborate
icon: maximize2
targetPanel: terminal
sendDirectly: false
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}I selected this text:

---
{{selectedText}}
---

Please elaborate on this text with more detail, examples, and context.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `area` | string | ✅ | Context area (e.g., "markdown-preview") |
| `subArea` | string | ✅ | Specific location (e.g., "context-menu") |
| `name` | string | ✅ | Display name in UI |
| `icon` | string | ✅ | Lucide icon name (e.g., "maximize2") |
| `targetPanel` | string | ❌ | Target panel: "claude" or "terminal" (default: "claude") |
| `sendDirectly` | boolean | ❌ | Send immediately without user review (default: false) |

**Validation:** Schema enforced by `schema.ts` (lines 1-62)

### Template Body Syntax

Templates support Handlebars-style syntax:

**Variables:**
```handlebars
{{selectedText}}     # Selected markdown text
{{filePath}}         # File path
{{fullDocument}}     # Entire document content
{{startLine}}        # Selection start line (number)
{{endLine}}          # Selection end line (number)
{{lineRange}}        # Formatted range: "line 42" or "lines 42-58"
{{fileRef}}          # File reference: "@/path/file.md:42-58"
```

**Conditionals:**
```handlebars
{{#if fileRef}}
  Content shown only if fileRef exists
{{/if}}
```

**Helpers:**
```handlebars
{{formatLineRange startLine endLine}}  # "line 42" or "lines 42-58"
{{basename filePath}}                   # Filename only
{{truncate selectedText 100}}           # First 100 chars
```

## CSP-Safe Template Rendering

**Problem:** Handlebars uses `new Function()` which violates Content Security Policy (CSP).

**Solution:** Custom regex-based renderer with three phases:

### Phase 1: Process Conditionals

```typescript
// Handles: {{#if condition}}...{{/if}}
const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
template.replace(ifRegex, (_match, condition, content) => {
  return variables[condition] ? content : ''
})
```

### Phase 2: Process Helpers

```typescript
// Handles: {{formatLineRange startLine endLine}}
const helperRegex = /\{\{(\w+)(?:\s+(\w+)(?:\s+(\w+))?)?\}\}/g
template.replace(helperRegex, (match, helperName, arg1, arg2) => {
  const helper = helpers[helperName]
  if (typeof helper === 'function') {
    const val1 = arg1 ? variables[arg1] : undefined
    const val2 = arg2 ? variables[arg2] : undefined
    return String(helper(val1, val2))
  }
  return match
})
```

### Phase 3: Process Variables

```typescript
// Handles: {{variable}}
const varRegex = /\{\{(\w+)\}\}/g
template.replace(varRegex, (_match, varName) => {
  return variables[varName] !== undefined ? String(variables[varName]) : ''
})
```

**Files:**
- `renderer.ts:13-43` - PromptRenderer class
- `parser.ts:1-117` - YAML parsing + frontmatter extraction

## Helper Functions

Located in `helpers.ts`:

### `formatLineRange(start, end)`
```typescript
formatLineRange(42, 42)    // "line 42"
formatLineRange(10, 20)    // "lines 10-20"
formatLineRange()          // ""
```

### `basename(path)`
```typescript
basename("/path/to/file.md")  // "file.md"
```

### `truncate(text, length)`
```typescript
truncate("Long text...", 10)  // "Long text..."
```

### Other Helpers
- `dirname(path)` - Directory path
- `uppercase(str)` - UPPERCASE
- `lowercase(str)` - lowercase
- `pluralize(count, singular, plural)` - Pluralization

**Implementation:** All helpers are plain functions (not Handlebars helpers)

## Creating New Templates

### Step 1: Create Template File

Create `src/renderer/src/prompts/templates/your-template.md`:

```markdown
---
area: markdown-preview
subArea: context-menu
name: Summarize
icon: list
targetPanel: terminal
---
{{#if fileRef}}{{fileRef}}

{{/if}}Summarize this text in 2-3 sentences:

---
{{selectedText}}
---
```

### Step 2: Schema Validation

Template will be automatically validated against Zod schema:

```typescript
// schema.ts
export const PromptConfigSchema = z.object({
  area: z.string().min(1),
  subArea: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  targetPanel: z.enum(['claude', 'terminal']).optional(),
  sendDirectly: z.boolean().optional()
})
```

Invalid templates throw parsing errors at load time.

### Step 3: Dynamic Loading

Templates are loaded automatically via Vite:

```typescript
// registry.ts
const templateModules = import.meta.glob('./templates/*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
})
```

**Hot Reload:** Template changes trigger HMR in development.

### Step 4: Icon Selection

Use Lucide icon names. Common options:
- `maximize2` - Expand/elaborate
- `minimize2` - Simplify/reduce
- `refresh` - Rewrite
- `sparkles` - Improve/enhance
- `list` - Summarize
- `message-square` - Custom prompt

**Icon Mapping:** `PreviewContextMenu.tsx:26-41` (getIconComponent)

## Integration with Context Menu

### Template Registration

```typescript
// registry.ts
export const PROMPT_REGISTRY: Record<string, PromptConfig> = {}

export function getPromptsForArea(area: string, subArea: string) {
  return Object.values(PROMPT_REGISTRY).filter(
    (p) => p.area === area && p.subArea === subArea
  )
}
```

### Context Menu Rendering

```typescript
// PreviewContextMenu.tsx
const items: ContextMenuItem[] = [
  ...getPromptsForArea('markdown-preview', 'context-menu').map((prompt) => ({
    label: prompt.label,
    icon: getIconComponent(prompt.icon),
    action: () => handleAction(prompt.id)
  }))
]
```

### Template Rendering

```typescript
// PreviewContextMenu.tsx:81-144
const handleAction = async (promptId: string) => {
  const config = PROMPT_REGISTRY[promptId]

  // Read original source (not rendered HTML)
  const sourceText = await readSourceLines(filePath, startLine, endLine)

  // Prepare variables
  const variables: PromptVariables = {
    selectedText: sourceText,
    filePath,
    startLine,
    endLine,
    lineRange: formatLineRange(startLine, endLine),
    fileRef: `@${filePath}:${startLine}-${endLine}`
  }

  // Render template
  const prompt = promptRenderer.render(config.template, variables)

  // Send to panel
  await openPanelAndSendContent({
    panel: config.targetPanel || 'claude',
    location: 'right',
    content: prompt,
    sendImmediately: config.sendDirectly || false
  })
}
```

## Target Panel Behavior

### `targetPanel: "claude"` (Copilot)
- Opens Copilot panel (right sidebar)
- Sends prompt to Claude AI
- If `sendDirectly: true` - Sends immediately
- If `sendDirectly: false` - Populates input for user review

### `targetPanel: "terminal"`
- Opens Terminal panel (right sidebar)
- Pastes prompt as terminal input
- User can edit before running command
- Useful for shell commands or scripts

**Default:** If `targetPanel` omitted, defaults to `"claude"`

## Line Range Tracking

Templates receive accurate line numbers via enhanced tracking system:

### Data Attributes

All markdown preview elements have:
```html
<pre data-line-start="42" data-line-end="58" data-line="42">
  <!-- Code block spanning lines 42-58 -->
</pre>
```

### Source Line Reading

`readSourceLines()` reads original markdown source (not rendered HTML):

```typescript
// PreviewContextMenu.tsx:44-66
async function readSourceLines(
  filePath: string,
  startLine: number,
  endLine: number
): Promise<string | null> {
  const content = await window.api.file.readFile(filePath)
  const lines = content.split('\n')
  // Line numbers are 1-indexed
  return lines.slice(startLine - 1, endLine).join('\n')
}
```

**Why:** User selections in preview may span multiple rendered elements. Reading source ensures accurate text extraction.

### Selection Algorithm

```typescript
// MarkdownPreview.tsx:143-207
function getLineNumbersFromSelection(selection, containerRef) {
  // Walk DOM from selection start/end
  // Find nearest elements with data-line-start/end
  // Return {startLine, endLine} range
}
```

**Features:**
- Handles multi-line elements (tables, code blocks)
- Supports reverse selections
- Validates selection.rangeCount for safety
- No race conditions (reads fresh DOM on right-click)

## Files Reference

### Core Files

| File | Lines | Purpose |
|------|-------|---------|
| `parser.ts` | 117 | YAML frontmatter parsing with js-yaml |
| `renderer.ts` | 95 | CSP-safe template rendering (3 phases) |
| `schema.ts` | 62 | Zod validation for frontmatter |
| `registry.ts` | 104 | Dynamic template loading + registry |
| `helpers.ts` | 80 | Template helper functions |
| `types.ts` | 70 | TypeScript interfaces |

### Integration Files

| File | Purpose |
|------|---------|
| `PreviewContextMenu.tsx` | Context menu + template rendering |
| `MarkdownPreview.tsx` | Line range tracking + selection |
| `panelUtils.ts` | Panel opening utilities |

### Template Files

- `templates/elaborate.md` - Expand with detail
- `templates/improve.md` - Grammar/style/clarity
- `templates/rewrite.md` - Rephrase differently
- `templates/simplify.md` - Make clearer/simpler
- `templates/mermaid-bug-report.md` - Report Mermaid diagram errors to Terminal

## Architectural Decisions

### Template ID System (Current Limitation)

**Current Implementation:**
Templates are identified by slugified display names:
```typescript
// parser.ts
const id = slugify(result.data.name)  // "Mermaid Bug Report" → "mermaid-bug-report"
```

**Problem:**
- Fragile coupling between display name and programmatic identifier
- Changing template name breaks all code references
- Requires mental mapping between `name` and derived ID

**Example Issue:**
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // WRONG ID!
// Returns undefined because actual ID is "report-mermaid-error"
```

**Recommended Solution:**
Add explicit `id` field to frontmatter:
```yaml
---
id: mermaid-bug-report    # Explicit, stable identifier
name: Mermaid Bug Report  # Display name (can change freely)
---
```

**Implementation Steps:**
1. Add `id` field to `PromptFrontmatterSchema` (schema.ts)
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (elaborate, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Status:** Architecture review complete, implementation pending.

**See:** [Known Issues - Template ID System](./known-issues.md#template-id-system)

## Dependencies

### Added
- **js-yaml** (^4.1.0) - Browser-compatible YAML parser
- **@types/js-yaml** (^4.0.9) - TypeScript types

### Removed (CSP Violations)
- ~~handlebars~~ - Uses `new Function()`
- ~~gray-matter~~ - Uses Node.js `Buffer` API

## See Also

- [Markdown Editing](./markdown-editing.md) - User-facing markdown features
- [UI Components](./ui-components.md) - Context menu UI
- [Development Tasks](./development-tasks.md) - Adding new templates
