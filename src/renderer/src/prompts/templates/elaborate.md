---
area: markdown-preview
subArea: context-menu
name: Elaborate
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
Think about the content, then elaborate on it in 2-3 focused paragraphs.
</task>

<instructions>
- Cover relevant aspects: background, supporting details, examples, connections to related concepts, or practical implications
- Adapt elaboration style to the content type
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
