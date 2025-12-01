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
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Original text:
---
{{selectedText}}
---

Modification requested: {{userInput}}

Apply the requested modification to the text above. Maintain the same format and style unless the modification specifically requests otherwise. Keep response focused (200-300 words max). Reference surrounding context in {{basename filePath}} only if the selection is unclear.
