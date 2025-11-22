# SKILL.md Template

Copy and adapt this template when creating a new skill.

---

```markdown
---
# REQUIRED: Skill identifier
# Format: lowercase, hyphens only, gerund form (verb+-ing)
# Max: 64 characters
# Examples: processing-pdfs, generating-tests, formatting-code
name: your-skill-name

# REQUIRED: Discovery description
# Max: 1024 characters
# Voice: Third person (NOT "I can help you...")
# Content: What it does + when to use it
# Include: Key terms users would mention
#
# BAD:  "Helps with documents"
# BAD:  "I can process your files"
# GOOD: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."
description: |
  [What this skill does - be specific].
  Use when [specific triggers and scenarios].
---

# [Skill Name]

<!--
  IMPORTANT: Keep this file under 500 lines.
  Move detailed content to separate files and reference them.
  References should be ONE LEVEL DEEP only (no nested references).
-->

## When This Skill Applies

<!-- List specific triggers that should activate this skill -->

Activate this skill when the user:
- [Trigger 1 - specific action or keyword]
- [Trigger 2]
- [Trigger 3]

## Workflow

<!--
  Numbered steps with clear actions.
  Include validation checkpoints for complex workflows.
-->

### Step 1: [Action Name]

[Description of what to do]

### Step 2: [Action Name]

[Description of what to do]

#### Checkpoint ✓
<!-- Optional: Add checkpoints between major phases -->
- [ ] [Verification item 1]
- [ ] [Verification item 2]

### Step 3: [Action Name]

[Description of what to do]

## Examples

<!--
  CRITICAL: Include at least 2-3 examples.
  Show input (what user says) and output (what skill produces).
  Examples help Claude understand expected behavior.
-->

### Example 1: [Scenario Name]

**User says:** "[Typical user request]"

**Skill does:**
1. [Step 1]
2. [Step 2]

**Output:**
```
[What the user receives]
```

### Example 2: [Different Scenario]

**User says:** "[Different request]"

**Skill does:**
1. [Step 1]
2. [Step 2]

**Output:**
```
[Result]
```

## Anti-Patterns

<!-- What NOT to do - helps prevent common mistakes -->

- ❌ [Bad practice 1]
- ❌ [Bad practice 2]
- ❌ [Bad practice 3]

## Quick Reference

<!-- Optional: Summary table for quick lookup -->

| Aspect | Value |
|--------|-------|
| [Key 1] | [Value 1] |
| [Key 2] | [Value 2] |
```

---

## Template Usage Notes

### Sections to Always Include
1. **When This Skill Applies** - Critical for discovery
2. **Workflow** - The core instructions
3. **Examples** - At least 2-3 with input/output

### Sections to Add for Complex Skills
- **Checkpoints** - Validation gates between phases
- **Anti-Patterns** - Common mistakes to avoid
- **Quick Reference** - Summary tables
- **Further Reading** - Links to supporting files

### File References
When referencing other files, use relative paths with forward slashes:
```markdown
See `templates/output-format.md` for the expected format.
```

**Never** nest references (file A → file B → file C). Keep references one level deep.

### Progressive Disclosure
For long sections, use collapsible details:
```markdown
<details>
<summary><strong>Click to expand</strong></summary>

Detailed content here...

</details>
```
