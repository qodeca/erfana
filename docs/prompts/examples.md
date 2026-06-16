# Prompt Template Examples

## Built-in Templates

### Explain
Explains selected text with detail and examples.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Explain
icon: maximize2
targetPanel: terminal
autoExecute: true
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}I selected this text:

---
{{selectedText}}
---

Please explain this text with more detail, examples, and context.
```

### Modify
Custom modification with user input dialog.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Modify
icon: refresh
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: How should this be modified?
inputPlaceholder: e.g., make more concise, add examples, change tone...
---
{{#if fileRef}}{{fileRef}}

{{/if}}Modify this text as requested:

User request: {{userInput}}

Original text:
---
{{selectedText}}
---
```

### Mermaid Bug Report
Reports Mermaid diagram errors.

```markdown
---
area: markdown-preview
subArea: mermaid-error
name: Mermaid Bug Report
icon: bug
targetPanel: terminal
autoExecute: true
---
I encountered an error with this Mermaid diagram:

{{#if fileRef}}Location: {{fileRef}}
{{/if}}
Error: {{errorMessage}}

Diagram code:
```mermaid
{{diagramCode}}
```

Please help me fix this diagram syntax.
```

## Custom Template Examples

### Summarize
Create concise summary.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Summarize
icon: list
order: 5
---
Summarize this text in 2-3 sentences:

{{selectedText}}
```

### Improve Writing
Enhance writing quality.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Improve Writing
icon: sparkles
autoExecute: true
---
Improve the clarity and flow of this text while maintaining its meaning:

{{selectedText}}
```

### Translate
Translate to another language.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Translate
icon: globe
requiresInput: true
inputLabel: Target language?
inputPlaceholder: e.g., Spanish, French, Japanese...
---
Translate to {{userInput}}:

{{selectedText}}
```

### Generate Tests
Create unit tests for code.

```markdown
---
area: code-editor
subArea: context-menu
name: Generate Tests
icon: check-square
---
{{#if fileRef}}{{fileRef}}

{{/if}}Generate comprehensive unit tests for:

```
{{selectedText}}
```
```

### Explain Code
Explain code functionality.

```markdown
---
area: code-editor
subArea: context-menu
name: Explain Code
icon: help-circle
---
{{#if fileRef}}From {{basename filePath}}:
{{/if}}
Explain what this code does in simple terms:

```
{{selectedText}}
```
```

## Advanced Examples

### With Multiple Conditions
```markdown
---
name: Smart Summary
---
{{#if fileRef}}
Source: {{fileRef}}
{{/if}}

{{#if userInput}}
Focus: {{userInput}}
{{/if}}

{{#if selectedText}}
Text: {{truncate selectedText 500}}
{{/if}}

Provide a summary.
```

### With All Variables
```markdown
---
name: Full Context
---
File: {{filePath}}
Location: {{lineRange}}
Reference: {{fileRef}}
Selected: {{selectedText}}
Document length: {{fullDocument}}
User input: {{userInput}}
```

## Usage Tips

1. **Auto-Execute**: Add `autoExecute: true` for commands that should run immediately
2. **User Input**: Use `requiresInput: true` for interactive prompts
3. **Order**: Control menu order with `order` field
4. **Icons**: Choose meaningful Lucide icons
5. **Conditionals**: Use `{{#if}}` to handle optional variables

## File Locations

Templates stored in: `src/renderer/src/prompts/templates/`

Add new templates as `.md` files and import in `registry.ts`.