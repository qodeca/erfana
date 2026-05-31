---
area: markdown-preview
subArea: mermaid-error
name: Mermaid Bug Report
icon: bug
targetPanel: terminal
autoExecute: true
mutatesDocument: true
---
<context>
{{#if fileRef}}{{fileRef}}
Location: {{lineRange}}
{{/if}}
</context>

<reference_input name="error">
{{mermaidError}}
</reference_input>

<reference_input name="code">
The diagram's current on-disk content (for locating and matching only):
{{mermaidCode}}
</reference_input>

<task>
Fix the Mermaid syntax error by editing the diagram block in the file in place.
</task>

<instructions>
- Correct only what is needed to resolve the error; keep all other content unchanged
- Produce valid Mermaid syntax
</instructions>
