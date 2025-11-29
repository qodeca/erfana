---
area: markdown-preview
subArea: context-menu
name: Ask
icon: help-circle
targetPanel: terminal
autoExecute: false
requiresInput: true
inputLabel: What would you like to know about this text?
inputPlaceholder: e.g., What does this mean? Why is this important? How does this relate to...?
order: 2
---
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

Question: {{userInput}}

Please answer this question in relation to the selected text above. Provide a clear, focused response (200-300 words max). Reference surrounding context in {{basename filePath}} if helpful for answering the question.
