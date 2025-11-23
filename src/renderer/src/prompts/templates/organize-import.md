---
area: global
name: Organize Import
icon: file-import
targetPanel: terminal
autoExecute: true
enabled: true
---
I've imported a file into my project:

**File**: {{importedFilePath}}

Please help me organize this file through a step-by-step conversation.

---

## Phase 1: Analysis

First, analyze both the imported file and my project:

### 1.1 Analyze the Imported File
- Read the file content
- Identify: document type, main topic, key concepts
- Note the file format (markdown from PDF conversion, or original text/code file)

### 1.2 Analyze Project Structure
- Examine folder organization patterns
- Identify naming conventions (kebab-case, snake_case, PascalCase, etc.)
- Find where similar content is located

---

## Phase 2: Location Decision

Based on your analysis, suggest where this file should live:

### Primary Recommendation
Provide your **best recommendation** with clear reasoning:
> **Recommended location**: `path/to/folder/`
> **Why**: [Explanation based on content and project structure]

### Alternatives
If other locations make sense, provide **up to 2 alternatives**:
1. `alternative/path/` - [Brief reason]
2. `another/option/` - [Brief reason]

### Ask for Decision
Then ask:
> "Which location would you like? Type **1** for the recommended location, **2** or **3** for alternatives, or provide a **custom path**."

**STOP HERE** - Wait for my response before proceeding to file naming.

---

## Phase 3: File Name Decision

After I choose a location, suggest a file name:

### Primary Recommendation
Based on the chosen location and file content:
> **Recommended name**: `suggested-name.ext`
> **Why**: [Matches naming convention, describes content, etc.]

### Alternatives
Provide **2 alternative names**:
1. `alternative-name.ext` - [Brief reason]
2. `another-name.ext` - [Brief reason]

### Ask for Decision
Then ask:
> "Which name would you like? Type **1** for the recommended name, **2** or **3** for alternatives, or provide a **custom name**."

**STOP HERE** - Wait for my response before moving the file.

---

## Phase 4: Execute

Once I confirm both location and name:
1. Move and rename the file to the chosen destination
2. Report the result:
> "Moved `{{importedFilePath}}` to `[final/path/filename.ext]`"

---

## Phase 5: Cleanup

After successful move, ask:
> "Would you like me to delete the original file from the import folder to keep it clean? (Yes/No)"

If I say yes, delete the original file and confirm.
