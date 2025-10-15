---
area: markdown-preview
subArea: context-menu
name: Elaborate
icon: maximize2
targetPanel: terminal
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}I selected this text:

---
{{selectedText}}
---

Please elaborate on this text with more detail, examples, and context. Review the file and the entire project if you need more context.
