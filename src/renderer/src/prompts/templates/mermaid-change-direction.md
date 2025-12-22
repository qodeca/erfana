---
area: markdown-preview
subArea: mermaid-direction
name: Change Mermaid Direction
icon: arrow-right
targetPanel: terminal
autoExecute: true
---
<context>
{{#if fileRef}}{{fileRef}}
{{/if}}
Target direction: {{targetDirection}} ({{directionLabel}})
</context>

<input>
```mermaid
{{mermaidCode}}
```
</input>

<task>
Update the diagram direction to {{targetDirection}}.
</task>

<constraints>
- Return only the complete diagram with new direction
- No explanations
</constraints>

<output_format>
```mermaid
... diagram with {{targetDirection}} direction ...
```
</output_format>
