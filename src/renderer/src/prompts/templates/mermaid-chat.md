---
area: diagram-viewer
subArea: chat
name: Diagram Chat
icon: message-circle
targetPanel: terminal
autoExecute: true
---
{{#if fileRef}}{{fileRef}}

{{/if}}**Mermaid Diagram Context:**
- Location: {{lineRange}}
- Current code:

```mermaid
{{mermaidCode}}
```

**User Request:**
{{userInstruction}}

Please modify the diagram according to the user's request.
