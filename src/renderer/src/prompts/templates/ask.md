---
area: markdown-preview
subArea: context-menu
name: Ask
icon: help-circle
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: What would you like to know about this text?
inputPlaceholder: e.g., What does this mean? Why is this important? How does this relate to...?
order: 2
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
- Answer in relation to the input text above
- Reference surrounding context if helpful for answering
- Provide clear, focused response
</instructions>

<constraints>
- 200-300 words maximum
- Direct answer without preamble
- No meta-commentary
</constraints>

<output_format>
Direct answer to the question.
</output_format>
