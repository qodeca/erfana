---
area: diagram-viewer
subArea: chat
name: Diagram Chat
icon: message-circle
targetPanel: terminal
autoExecute: true
---
<context>
{{#if fileRef}}{{fileRef}}
{{/if}}
Location: {{lineRange}}
</context>

<input>
```mermaid
{{mermaidCode}}
```
</input>

<task>
Modify the diagram according to this request: {{userInstruction}}
</task>

<constraints>
- Return only the complete modified Mermaid code
- No explanations or commentary
</constraints>

<output_format>
```mermaid
... modified diagram ...
```
</output_format>
