---
id: browser-ask
area: browser
name: Ask…
icon: help-circle
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: What would you like to know about this element?
order: 1
enabled: true
mutatesDocument: false
browserCapture: true
---
<context>
Context file: {{contextRef}}
Screenshot: {{screenshotRef}}
{{#if cropRef}}Element crop: {{cropRef}}
{{/if}}</context>

<question>
{{userInput}}
</question>

<task>
Answer the user's question above about the element they picked on this web page. Do NOT edit any file.
</task>

<instructions>
- Read the context file first: it describes the picked element, the page and the capture, and may name the project file that renders the element
- Use the screenshot to see the element in place (it is outlined) and the crop to see it up close
- Answer in relation to the picked element; look at the project's source when that helps
</instructions>

<constraints>
- Clear, focused answer without preamble
- Do NOT edit, create or delete files – respond in the terminal only
</constraints>
