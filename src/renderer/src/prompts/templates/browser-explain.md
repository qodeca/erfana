---
id: browser-explain
area: browser
name: Explain
icon: maximize2
targetPanel: terminal
autoExecute: true
order: 0
enabled: true
mutatesDocument: false
browserCapture: true
---
<context>
Context file: {{contextRef}}
Screenshot: {{screenshotRef}}
{{#if cropRef}}Element crop: {{cropRef}}
{{/if}}</context>

<task>
Explain the element the user picked on this web page: what it is, what it does and how it fits into the page. Do NOT edit any file.
</task>

<instructions>
- Read the context file first: it describes the picked element, the page and the capture, and may name the project file that renders the element
- Use the screenshot to see the element in place (it is outlined) and the crop to see it up close
- If a file in this project renders the element, name it
</instructions>

<constraints>
- 200-300 words maximum
- No preamble or meta-commentary
- Do NOT edit, create or delete files – respond in the terminal only
</constraints>
