---
area: markdown-preview
subArea: context-menu
name: Simplify
icon: minimize2
targetPanel: terminal
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}I selected this text:

---
{{selectedText}}
---

Please simplify this text for easier understanding while maintaining the key points. Review the file and the entire project if you need more context.
