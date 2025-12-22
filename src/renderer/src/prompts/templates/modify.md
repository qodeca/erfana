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
Apply the following modification: {{userInput}}
</task>

<instructions>
- Maintain the same format and style unless modification specifically requests otherwise
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- 200-300 words maximum
- Preserve original meaning unless change is requested
- No preamble or explanation
</constraints>

<output_format>
Modified text only. No commentary or meta-text.
</output_format>
