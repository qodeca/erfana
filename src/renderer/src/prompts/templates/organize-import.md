---
area: global
name: Organize Import
icon: file-import
targetPanel: terminal
autoExecute: true
enabled: true
---
<context>
Imported file: {{importedFilePath}}
</context>

<task>
Organize this imported file through a step-by-step conversation.
Use the AskUserQuestion tool at each decision point for better UX.
</task>

<instructions>
## Phase 1: Analysis (no user input needed)
1. Read the imported file content
2. Identify: document type, main topic, key concepts
3. Examine project folder organization and naming conventions
4. Find where similar content is located

## Phase 2: Location Decision
After analysis, use AskUserQuestion to present location options:
- Header: "File location"
- Question: "Where should this file be placed?"
- Options:
  - Primary recommendation with reasoning
  - Up to 2 alternatives (if applicable)

Wait for user response before proceeding.

## Phase 3: File Name Decision
After location is chosen, use AskUserQuestion for naming:
- Header: "File name"
- Question: "What should the file be named?"
- Options:
  - Recommended name matching project conventions
  - Up to 2 alternative names (if applicable)

Wait for user response before proceeding.

## Phase 4: Execute
1. Move and rename the file to chosen destination
2. Report the result with full path

## Phase 5: Cleanup
Use AskUserQuestion for cleanup decision:
- Header: "Cleanup"
- Question: "Delete the original file from import folder?"
- Options: "Yes, delete original" / "No, keep both"

If yes, delete and confirm.
</instructions>

<constraints>
- Analyze before asking - never ask without context
- Always use AskUserQuestion tool for decisions (not text prompts)
- Provide clear reasoning for recommendations
- Match project naming conventions
</constraints>
