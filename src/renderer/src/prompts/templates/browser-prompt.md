---
id: browser-prompt
area: browser
name: Prompt…
icon: sparkles
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: Enter your prompt
order: 3
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
{{userInput}}
</task>

<instructions>
- The task above is about the element the user picked on this web page
- Read the context file first: it describes the picked element, the page and the capture, and may name the project file that renders the element
- Use the screenshot to see the element in place (it is outlined) and the crop to see it up close
</instructions>
