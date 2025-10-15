---
area: markdown-preview
subArea: context-menu
name: Elaborate
icon: maximize2
targetPanel: terminal
---
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

Elaborate on this text in 2-3 focused paragraphs (200-300 words max).

Cover relevant aspects such as: background/context, supporting details, examples if helpful, connections to related concepts, or practical implications.

Adapt your elaboration to the content type. Be clear and concise. Reference surrounding context in {{basename filePath}} only if the selection is unclear.
