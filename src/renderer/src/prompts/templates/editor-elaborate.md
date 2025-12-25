---
id: editor-elaborate
area: code-editor
subArea: context-menu
name: Elaborate
icon: maximize2
targetPanel: terminal
autoExecute: true
order: 0
enabled: true
---
<context>
{{#if fileRef}}{{fileRef}}
Source: {{basename filePath}} ({{formatLineRange startLine endLine}})
{{/if}}
</context>

<input>
{{selectedText}}
</input>

<task>
Think about the code or content, then elaborate on it in 2-3 focused paragraphs.
</task>

<instructions>
- Explain what the code does and why it works that way
- Cover relevant aspects: purpose, logic flow, design patterns, edge cases, or potential improvements
- Adapt elaboration style to the content type (code, comments, configuration)
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- 200-300 words maximum
- Clear and concise language
- No preamble or meta-commentary
</constraints>

<output_format>
Direct elaboration text. No headings or formatting unless content requires it.
</output_format>
