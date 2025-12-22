---
area: markdown-preview
subArea: mermaid-error
name: Mermaid Bug Report
icon: bug
targetPanel: terminal
autoExecute: true
---
<context>
{{#if fileRef}}{{fileRef}}
Location: {{lineRange}}
{{/if}}
</context>

<input name="error">
{{mermaidError}}
</input>

<input name="code">
```mermaid
{{mermaidCode}}
```
</input>

<task>
Fix the Mermaid diagram syntax error.
</task>

<constraints>
- Brief explanation of the issue (1-2 sentences)
- Provide corrected diagram code
</constraints>

<output_format>
**Issue**: [Brief explanation]

```mermaid
... corrected diagram ...
```
</output_format>
