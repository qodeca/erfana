---
area: diagram-viewer
subArea: chat
name: Diagram Chat
icon: message-circle
targetPanel: terminal
autoExecute: true
mutatesDocument: true
---
<context>
{{#if fileRef}}{{fileRef}}
{{/if}}
Location: {{lineRange}}
</context>

<reference_input>
The diagram's current on-disk content (for locating and matching only):
{{mermaidCode}}
</reference_input>

<task>
Apply this change to the existing Mermaid diagram block in place: {{userInstruction}}
</task>

<instructions>
- Modify only the existing diagram block; keep all other content unchanged
- Produce valid Mermaid syntax
</instructions>
