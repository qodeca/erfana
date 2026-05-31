---
area: markdown-preview
subArea: mermaid-direction
name: Change Mermaid Direction
icon: arrow-right
targetPanel: terminal
autoExecute: true
mutatesDocument: true
---
<context>
{{#if fileRef}}{{fileRef}}
{{/if}}
Target direction: {{targetDirection}} ({{directionLabel}})
</context>

<reference_input>
The diagram's current on-disk content (for locating and matching only):
{{mermaidCode}}
</reference_input>

<task>
Change the Mermaid diagram direction to {{targetDirection}} by editing the diagram block in place.
</task>

<instructions>
- Replace only the direction keyword (TD, TB, LR, RL, BT) with {{targetDirection}}
- Keep all other diagram content unchanged
</instructions>
