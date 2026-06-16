---
area: markdown-preview
subArea: context-menu
name: Explain
icon: maximize2
targetPanel: terminal
autoExecute: true
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
Explain and expand on the content below in 2-3 focused paragraphs. Do NOT edit or modify the source file.
</task>

<instructions>
- Cover relevant aspects: background, supporting details, examples, connections to related concepts, or practical implications
- Adapt explanation style to the content type
- Reference surrounding context only if the selection is unclear
</instructions>

<constraints>
- 200-300 words maximum
- Clear and concise language
- No preamble or meta-commentary
- Do NOT edit, modify, or rewrite the source file – respond in the terminal only
</constraints>

<output_format>
Respond in the terminal only. Direct explanation text. No headings or formatting unless content requires it.
</output_format>
