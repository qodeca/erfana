---
area: markdown-preview
subArea: context-menu
name: Prompt
icon: sparkles
targetPanel: terminal
autoExecute: false
requiresInput: true
inputLabel: Enter your prompt
inputPlaceholder: e.g., summarize in bullet points, translate to Spanish, explain like I'm 5...
order: 3
---
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

{{userInput}}
