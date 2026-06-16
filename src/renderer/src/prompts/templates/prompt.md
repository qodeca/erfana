---
area: markdown-preview
subArea: context-menu
name: Prompt
icon: sparkles
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: Enter your prompt
inputPlaceholder: e.g., summarize in bullet points, translate to Spanish, explain like I'm 5...
order: 3
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
{{userInput}}
</task>

<constraints>
- Respond directly without preamble
- Keep response focused and actionable
</constraints>
