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
Edit the source file to change the Mermaid diagram direction to {{targetDirection}}.
</task>

<instructions>
1. Use the Edit tool to modify the file at the provided file reference
2. Replace only the direction keyword (TD, TB, LR, RL, BT) with {{targetDirection}}
3. Keep all other diagram content unchanged
</instructions>

<constraints>
- Edit the file directly using the Edit tool
- Change only the direction keyword, preserve all other content
- No explanations or commentary
</constraints>
