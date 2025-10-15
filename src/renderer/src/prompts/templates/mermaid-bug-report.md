---
area: markdown-preview
subArea: mermaid-error
name: Mermaid Bug Report
icon: bug
targetPanel: terminal
autoExecute: true
---
{{#if fileRef}}{{fileRef}}

In {{filePath}} ({{lineRange}}):

{{/if}}I'm getting a Mermaid diagram rendering error.

**Error Message:**
```
{{mermaidError}}
```

**Diagram Code:**
```mermaid
{{mermaidCode}}
```

Please help me fix this Mermaid diagram syntax error.
