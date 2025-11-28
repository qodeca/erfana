---
area: markdown-preview
subArea: mermaid-direction
name: Change Mermaid Direction
icon: arrow-right
targetPanel: terminal
autoExecute: true
---
{{#if fileRef}}{{fileRef}}

{{/if}}Change this Mermaid diagram to **{{targetDirection}}** ({{directionLabel}}) layout:

```mermaid
{{mermaidCode}}
```

Update the direction declaration to `{{targetDirection}}`.
