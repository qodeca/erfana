# Prompt Template Examples

## Built-in Templates

These are copied verbatim from `src/renderer/src/prompts/templates/`; the template files are the source of truth.

### Explain
Explains selected text in the terminal without editing the file.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Explain
icon: maximize2
targetPanel: terminal
autoExecute: true
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
Explain and expand on the content below in 2-3 focused paragraphs. Do NOT edit or modify the source file.
</task>

<instructions>
- Cover relevant aspects: background, supporting details, examples, connections to related concepts, or practical implications
- Adapt explanation style to the content type
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- 200-300 words maximum
- Clear and concise language
- No preamble or meta-commentary
- Do NOT edit, modify, or rewrite the source file – respond in the terminal only
</constraints>

<output_format>
Respond in the terminal only. Direct explanation text. No headings or formatting unless content requires it.
</output_format>
```

### Modify
Replaces the selection in place, using the user's instruction from an input dialog. `mutatesDocument: true` adds the "apply to document" footer.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Modify
icon: edit-3
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: How should this be modified?
inputPlaceholder: e.g., make more concise, add examples, use simpler language...
order: 1
mutatesDocument: true
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
Replace the selected text in place with a modified version that applies: {{userInput}}
</task>

<instructions>
- Maintain the same format and style unless modification specifically requests otherwise
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- Keep the modified text roughly 200-300 words unless the change requires otherwise
- Preserve original meaning unless change is requested
</constraints>
```

### Mermaid Bug Report
Fixes a Mermaid syntax error by editing the diagram block in place.

```markdown
---
area: markdown-preview
subArea: mermaid-error
name: Mermaid Bug Report
icon: bug
targetPanel: terminal
autoExecute: true
mutatesDocument: true
---
<context>
{{#if fileRef}}{{fileRef}}
Location: {{lineRange}}
{{/if}}
</context>

<reference_input name="error">
{{mermaidError}}
</reference_input>

<reference_input name="code">
The diagram's current on-disk content (for locating and matching only):
{{mermaidCode}}
</reference_input>

<task>
Fix the Mermaid syntax error by editing the diagram block in the file in place.
</task>

<instructions>
- Correct only what is needed to resolve the error; keep all other content unchanged
- Produce valid Mermaid syntax
</instructions>
```

`icon: bug` is not in the icon registry, so this template shows the fallback `sparkles` icon (see [Icon selection](./template-syntax.md#icon-selection)).

## Custom Template Examples

### Summarize
Create concise summary.

```markdown
---
area: markdown-preview
subArea: context-menu
name: Summarize
icon: file-text
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
icon: message-circle
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
icon: file-text
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
4. **Icons**: Use a name from the icon registry – any other name falls back to `sparkles` (see [Icon selection](./template-syntax.md#icon-selection))
5. **Conditionals**: Use `{{#if}}` to handle optional variables

## File Locations

Templates stored in: `src/renderer/src/prompts/templates/`

Add new templates as `.md` files there; `registry.ts` discovers them automatically with `import.meta.glob`.