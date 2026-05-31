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
