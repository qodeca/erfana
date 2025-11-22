---
area: global
name: Organize Import
icon: file-import
targetPanel: terminal
autoExecute: true
enabled: true
---
I've imported a PDF and converted it to markdown:

**File**: {{importedFilePath}}

Please help me organize this file:

## Step 1: Analyze the Document
Read and analyze the document content to understand:
- Main topic/subject
- Key terms and concepts
- Document type (guide, reference, notes, etc.)

## Step 2: Analyze Project Conventions
Examine the project structure to identify:
- Naming conventions used (kebab-case, snake_case, PascalCase, etc.)
- Folder organization patterns
- Where similar documents are located

## Step 3: Suggest File Names
Based on the document content and project naming conventions, provide **3-5 file name suggestions**. Format as a numbered list with brief reasoning.

Example format:
1. `suggested-name.md` - Based on [reason]
2. `alternative-name.md` - Based on [reason]

## Step 4: Suggest Locations
Provide **2-3 location suggestions** where this file could be moved. For each location, explain why it's appropriate based on:
- Document content/topic
- Existing project structure
- Similar files in the project

Example format:
1. `docs/topic/` - Contains related documentation about [topic]
2. `reference/` - Reference materials are stored here

## Step 5: Get User Choice
Ask me to:
- Choose a file name (or provide a custom one)
- Choose a location (or provide a custom path)

## Step 6: Move the File
Once I confirm my choices, rename and move the file to the selected location.

## Step 7: Cleanup
After successfully moving the file, ask if I want to **delete the original file from the import folder** to keep the import directory clean.

Ask: "Would you like me to delete the original file `{{importedFilePath}}` from the import folder? (Type **Yes** or **No**)"
