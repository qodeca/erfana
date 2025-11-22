# Skill Creation Examples

Three complete examples showing the skill creation process from start to finish.

---

## Example 1: Simple Skill - `formatting-markdown`

A minimal skill with just SKILL.md.

### User Request

> "I keep asking Claude to format my markdown the same way. Can I make a skill for this?"

### Questions Asked

1. **What formatting rules do you want?**
   - Headers: ATX style (#, ##, ###)
   - Lists: Consistent indentation (2 spaces)
   - Code blocks: Fenced with language identifier
   - Line length: Max 100 characters

2. **When should this activate?**
   - When user says "format this markdown"
   - When user mentions "clean up" or "standardize" markdown

3. **Any tools needed?**
   - Just Read and Edit tools (default)

### Final Structure

```
formatting-markdown/
└── SKILL.md
```

### SKILL.md Content

```markdown
---
name: formatting-markdown
description: Format markdown files following consistent style rules. Standardizes headers, lists, code blocks, and line length. Use when user asks to format, clean up, or standardize markdown files.
---

# Formatting Markdown

## When This Skill Applies

Activate when user:
- Asks to "format markdown" or "format this file"
- Mentions "clean up" or "standardize" markdown
- Wants consistent markdown styling

## Formatting Rules

### Headers
- Use ATX style: `# H1`, `## H2`, `### H3`
- One blank line before and after headers
- No trailing punctuation

### Lists
- Indent nested items with 2 spaces
- Use `-` for unordered lists
- Use `1.` for ordered lists (let markdown renumber)

### Code Blocks
- Use fenced blocks with triple backticks
- Always specify language: ```javascript, ```python, etc.
- Indent code blocks in lists by 4 spaces

### Line Length
- Maximum 100 characters
- Break long lines at logical points

## Workflow

1. Read the markdown file
2. Apply formatting rules section by section
3. Show diff of changes
4. Apply changes with user confirmation

## Example

**Input:**
```markdown
#My Header
- item 1
  - nested item
    code here
```

**Output:**
```markdown
# My Header

- item 1
  - nested item

    ```
    code here
    ```
```

## Anti-Patterns

- ❌ Don't change content, only formatting
- ❌ Don't reorder sections
- ❌ Don't remove intentional blank lines in code blocks
```

---

## Example 2: Medium Skill - `testing-api`

A skill with templates folder for test output formats.

### User Request

> "I test APIs a lot with curl. Can I have a skill that helps generate and run tests?"

### Questions Asked

1. **What types of API tests?**
   - GET, POST, PUT, DELETE endpoints
   - Authentication (Bearer tokens, API keys)
   - Response validation (status codes, JSON structure)

2. **What output format?**
   - Summary of test results
   - Details of failures
   - curl commands for reproduction

3. **When should this activate?**
   - "Test this API", "test endpoint"
   - "Check if API is working"
   - "Validate API response"

### Final Structure

```
testing-api/
├── SKILL.md
└── templates/
    ├── test-result.md
    └── curl-template.md
```

### SKILL.md Content

```markdown
---
name: testing-api
description: Generate and execute API tests using curl. Tests REST endpoints for status codes, response structure, and authentication. Use when user wants to test an API, validate endpoints, or check API responses.
---

# Testing API

## When This Skill Applies

Activate when user:
- Says "test this API" or "test endpoint"
- Wants to "validate" or "check" an API
- Needs to verify API responses

## Workflow

### Step 1: Gather Information

Ask for:
- Base URL of the API
- Endpoint to test
- HTTP method (GET/POST/PUT/DELETE)
- Authentication (if any)
- Expected response

### Step 2: Generate Test

Create curl command using `templates/curl-template.md` format.

### Step 3: Execute Test

Run the curl command and capture:
- HTTP status code
- Response headers
- Response body
- Timing information

### Step 4: Report Results

Format results using `templates/test-result.md`.

## Examples

### Example: Test GET Endpoint

**User says:** "Test GET https://api.example.com/users/1"

**Skill does:**
1. Generates curl command
2. Executes: `curl -s -w "\n%{http_code}" https://api.example.com/users/1`
3. Reports: Status 200, response body, timing

**Output:**
```
✅ GET /users/1 - PASSED
Status: 200 OK
Time: 145ms
Response: {"id": 1, "name": "John"}
```

### Example: Test with Authentication

**User says:** "Test POST /login with username and password"

**Skill does:**
1. Asks for credentials format
2. Generates authenticated request
3. Validates response contains token

## Anti-Patterns

- ❌ Don't store actual credentials in test files
- ❌ Don't run tests against production without confirmation
- ❌ Don't ignore SSL certificate errors silently
```

### templates/test-result.md

```markdown
## Test Result: [ENDPOINT]

| Aspect | Result |
|--------|--------|
| Status | [STATUS_CODE] [STATUS_TEXT] |
| Time | [RESPONSE_TIME]ms |
| Size | [RESPONSE_SIZE] bytes |

### Response Body
```json
[RESPONSE_BODY]
```

### Curl Command (for reproduction)
```bash
[CURL_COMMAND]
```
```

---

## Example 3: Complex Skill - `processing-documents`

A full-featured skill with validation, examples, and scripts.

### User Request

> "I need to process various document types - PDFs, Word docs, spreadsheets. Can you make a comprehensive skill?"

### Questions Asked

1. **What operations?**
   - Extract text from PDFs
   - Read Word documents
   - Parse Excel spreadsheets
   - Convert between formats

2. **What tools/dependencies?**
   - pdftotext (for PDFs)
   - python-docx (for Word)
   - openpyxl (for Excel)

3. **Error handling?**
   - Report unsupported formats
   - Handle corrupted files gracefully
   - Provide alternatives when tools missing

### Final Structure

```
processing-documents/
├── SKILL.md
├── templates/
│   └── extraction-result.md
├── validation/
│   └── format-checklist.md
├── examples.md
└── scripts/
    └── check-dependencies.sh
```

### SKILL.md Content (abbreviated)

```markdown
---
name: processing-documents
description: Extract text and data from PDF, Word, and Excel files. Handles text extraction, format conversion, and data parsing. Use when user needs to process documents, extract content, or convert file formats.
---

# Processing Documents

## When This Skill Applies

Activate when user:
- Needs to "extract text" from documents
- Wants to "read" or "parse" PDF/Word/Excel files
- Asks to "convert" document formats

## Supported Formats

| Format | Extension | Operations |
|--------|-----------|------------|
| PDF | .pdf | Extract text, extract images |
| Word | .docx | Extract text, extract tables |
| Excel | .xlsx | Read sheets, extract data |

## Prerequisites

Check dependencies with `scripts/check-dependencies.sh`:
- `pdftotext` - Part of poppler-utils
- Python packages: `python-docx`, `openpyxl`

## Workflow

### Step 1: Identify Format

Determine file type from extension or content.

### Step 2: Check Dependencies

Verify required tools are installed.
If missing, provide installation instructions.

### Step 3: Process Document

Use appropriate extraction method.
See `examples.md` for detailed examples.

### Step 4: Format Output

Use `templates/extraction-result.md` for consistent output.

## Quick Reference

| Task | Command/Method |
|------|----------------|
| PDF → Text | `pdftotext input.pdf -` |
| Word → Text | `python-docx` library |
| Excel → Data | `openpyxl` library |

## Error Handling

| Error | Solution |
|-------|----------|
| Tool not installed | Provide installation command |
| Corrupted file | Report error, suggest alternatives |
| Password protected | Ask user for password |
| Unsupported format | List supported formats |

## Further Reading

- See `examples.md` for detailed usage examples
- See `validation/format-checklist.md` for format-specific checks
```

---

## Key Takeaways

| Complexity | Files | When to Use |
|------------|-------|-------------|
| Simple | SKILL.md only | Single-purpose, straightforward workflow |
| Medium | SKILL.md + templates/ | Needs output formatting or reusable snippets |
| Complex | Full structure | Multiple operations, dependencies, error handling |

### Common Patterns

1. **Start simple** - You can always add files later
2. **Templates for output** - Keep output formats consistent
3. **Validation for quality** - Checklists prevent mistakes
4. **Scripts for automation** - Reduce manual steps
