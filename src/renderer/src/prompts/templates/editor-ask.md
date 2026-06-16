---
id: editor-ask
area: code-editor
subArea: context-menu
name: Ask
icon: help-circle
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: What would you like to know?
inputPlaceholder: e.g., What does this function do? Why is this pattern used? How can I test this?
order: 2
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
Think about the question, then answer: {{userInput}}
</task>

<instructions>
- Answer in relation to the code or content above
- Reference surrounding context if helpful for answering
- Provide clear, focused response with code examples if appropriate
</instructions>

<constraints>
- 200-300 words maximum
- Direct answer without preamble
- No meta-commentary
</constraints>

<output_format>
Direct answer to the question.
</output_format>
