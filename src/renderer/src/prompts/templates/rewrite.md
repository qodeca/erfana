---
area: markdown-preview
subArea: context-menu
name: Rewrite
icon: refresh
targetPanel: terminal
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}I selected this text:

---
{{selectedText}}
---

Please rewrite this text to improve clarity, flow, and readability. Review the file and the entire project if you need more context.
