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
You MUST edit the source file directly to apply the following modification: {{userInput}}
</task>

<instructions>
- Maintain the same coding style and conventions unless modification specifically requests otherwise
- Preserve existing functionality unless change is explicitly requested
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- Keep changes minimal and focused on the requested modification
- Preserve original formatting and indentation style
- No preamble or explanation
</constraints>

<output_format>
You MUST edit the file directly using the file reference above. Replace the selected code with the modified version. No commentary.
</output_format>
