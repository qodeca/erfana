---
id: editor-modify
area: code-editor
subArea: context-menu
name: Modify
icon: edit-3
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: How should this be modified?
inputPlaceholder: e.g., refactor to use async/await, add error handling, simplify logic...
order: 1
enabled: true
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
Replace the selected code in place with a modified version that applies: {{userInput}}
</task>

<instructions>
- Maintain the same coding style and conventions unless modification specifically requests otherwise
- Preserve existing functionality unless change is explicitly requested
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- Keep changes minimal and focused on the requested modification
- Preserve original formatting and indentation style
</constraints>
