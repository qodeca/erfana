---
id: browser-change
area: browser
name: Change…
icon: edit-3
targetPanel: terminal
autoExecute: true
requiresInput: true
inputLabel: What should change – a fix, a style change or new text?
order: 2
enabled: true
mutatesDocument: false
browserCapture: true
---
<context>
Context file: {{contextRef}}
Screenshot: {{screenshotRef}}
{{#if cropRef}}Element crop: {{cropRef}}
{{/if}}</context>

<change>
{{userInput}}
</change>

<task>
Locate the source in this project that renders the element the user picked on this web page, and edit it to make the change above.
</task>

<instructions>
- Read the context file first: it describes the picked element, the page and the capture, and may name the project file that renders the element
- When the context file names a resolved source file, start there; otherwise search the project for the component, markup or styles that produce the element
- Use the screenshot to see the element in place (it is outlined) and the crop to see it up close
- Keep the change minimal and follow the project's existing conventions
- When done, say in one or two sentences which files you changed
</instructions>
