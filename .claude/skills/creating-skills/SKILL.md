---
name: creating-skills
description: Create, review, and modify Claude Code skills following Anthropic best practices. Guides through need analysis, skill design, file creation, and validation with checkpoints. Use when user wants to create a skill, review an existing skill, modify or improve a skill, automate repeated prompts, capture reusable workflows, or asks "how do I make a skill".
---

# Creating Skills

This skill helps you create, review, and modify Claude Code skills following official Anthropic best practices.

## Quick Start

To create a basic skill:

1. Create the skill directory:
   ```bash
   mkdir -p .claude/skills/your-skill-name
   ```

2. Create `SKILL.md` with required frontmatter:
   ```yaml
   ---
   name: your-skill-name
   description: What it does + when to use it. Be specific.
   ---
   ```

3. Add workflow instructions in markdown below the frontmatter

4. Validate against `validation/pre-release-checklist.md`

For complex skills, continue with the full workflow below.

---

<details>
<summary><strong>📋 Full 5-Phase Workflow</strong></summary>

## Phase 1: Understand the Need

Before creating a skill, clarify:

1. **What task is being repeated?**
   - Is the same prompt typed across multiple conversations?
   - Is there a multi-step workflow that should be standardized?

2. **What should trigger this skill?**
   - Specific keywords users would mention
   - Types of requests that should activate it

3. **What tools/permissions are needed?**
   - File operations (Read, Write, Edit)
   - Bash commands
   - External APIs or MCP tools

### Phase 1 Checkpoint ✓
- [ ] Task is repeated across conversations (not one-time)
- [ ] Clear trigger conditions identified
- [ ] Required tools/permissions documented

❌ If any unchecked → reconsider if a skill is the right solution
✅ All checked → proceed to Phase 2

---

## Phase 2: Design the Skill

### Naming Convention
- **Format:** gerund form (verb + -ing), lowercase, hyphens only
- **Length:** max 64 characters
- **Avoid:** vague terms like "helper", "utils", "misc"

| Bad | Good |
|-----|------|
| `pdf-helper` | `processing-pdfs` |
| `code-utils` | `refactoring-typescript` |
| `my-skill` | `generating-api-tests` |

### Description (Critical for Discovery)
- **Max length:** 1024 characters
- **Voice:** Third person (not "I can help you...")
- **Content:** What it does + when to use it
- **Include:** Key terms users would mention

| Bad | Good |
|-----|------|
| "Helps with files" | "Extract text and tables from PDF files. Use when working with PDFs or document extraction." |
| "I can assist with testing" | "Generate and run API tests using curl. Use when testing REST endpoints or validating API responses." |

### Structure Decision
- **Simple:** Single SKILL.md (under 200 lines)
- **Medium:** SKILL.md + templates/ folder
- **Complex:** Full structure with validation/, examples, scripts/

### Phase 2 Checkpoint ✓
- [ ] Name follows convention (gerund, lowercase, hyphens, ≤64 chars)
- [ ] Description is specific with "what" + "when" (≤1024 chars)
- [ ] Description uses third person
- [ ] Complexity level decided (simple/medium/complex)
- [ ] Storage location decided: personal (`~/.claude/skills/`) or project (`.claude/skills/`)

❌ If any unchecked → refine design
✅ All checked → proceed to Phase 3

---

## Phase 3: Create Files

### Directory Structure

**Simple skill:**
```
your-skill-name/
└── SKILL.md
```

**Medium skill:**
```
your-skill-name/
├── SKILL.md
└── templates/
    └── output-template.md
```

**Complex skill:**
```
your-skill-name/
├── SKILL.md
├── templates/
├── validation/
├── examples.md
└── scripts/
```

### SKILL.md Structure

Use the template from `templates/skill-md-template.md`:

```markdown
---
name: your-skill-name
description: Specific description with what + when triggers.
---

# Skill Title

## When This Skill Applies
[List specific triggers]

## Workflow
[Numbered steps with checkpoints]

## Examples
[Input/output pairs]

## Anti-Patterns
[What NOT to do]
```

### Key Rules
- Keep SKILL.md **under 500 lines**
- Move detailed content to separate files
- Use **one-level-deep references** only (no nested file references)
- Use **forward slashes** in all paths (not backslashes)

### Phase 3 Checkpoint ✓
- [ ] SKILL.md created with proper frontmatter
- [ ] SKILL.md under 500 lines
- [ ] Supporting files created if needed
- [ ] All file references are one level deep
- [ ] Forward slashes used in all paths

❌ If any unchecked → fix file structure
✅ All checked → proceed to Phase 4

---

## Phase 4: Add Examples

Examples are critical for Claude to understand expected behavior.

### Example Format
```markdown
## Example: [Scenario Name]

**User says:** "[Typical user request]"

**Skill does:**
1. [Step 1]
2. [Step 2]

**Output:**
[What the user receives]
```

### Guidelines
- Include at least 2-3 examples
- Show different use cases
- Include edge cases if relevant
- Show both input and output

See `examples.md` for complete examples of skill creation.

### Phase 4 Checkpoint ✓
- [ ] At least 2 examples included
- [ ] Examples show input and output
- [ ] Different use cases covered

❌ If any unchecked → add more examples
✅ All checked → proceed to Phase 5

---

## Phase 5: Validate

Run through the complete validation:

1. **Pre-release checklist:** `validation/pre-release-checklist.md`
2. **Security checklist:** `validation/security-checklist.md`
3. **Cross-model test:** See `cross-model-guide.md`

### Quick Validation
- [ ] Description enables discovery (specific "what" + "when")
- [ ] SKILL.md demonstrates good structure
- [ ] Examples included
- [ ] No security issues (secrets, bad paths)
- [ ] Tested mentally with "what would Haiku do?"

### Phase 5 Checkpoint ✓
- [ ] All pre-release checklist items passed
- [ ] All security checklist items passed
- [ ] Cross-model considerations addressed

❌ If any unchecked → fix issues
✅ All checked → skill is ready!

</details>

---

<details>
<summary><strong>🎯 See Concrete Examples</strong></summary>

See `examples.md` for three complete examples:

1. **Simple:** `formatting-markdown` - Single SKILL.md
2. **Medium:** `testing-api` - With templates folder
3. **Complex:** `processing-documents` - Full structure

Each example shows the complete flow from user request to final skill.

</details>

---

<details>
<summary><strong>⚠️ Common Mistakes (Anti-Patterns)</strong></summary>

### Description Issues
- ❌ Too vague: "Helps with code"
- ❌ First person: "I can help you..."
- ❌ Missing triggers: No "when to use" guidance

### Structure Issues
- ❌ SKILL.md over 500 lines
- ❌ Nested file references (file A → file B → file C)
- ❌ Backslashes in paths (`templates\file.md`)

### Content Issues
- ❌ No examples
- ❌ Hardcoded secrets or API keys
- ❌ Magic numbers without explanation
- ❌ Missing error handling in scripts

### Testing Issues
- ❌ Only tested with Opus (may fail on Haiku)
- ❌ No validation before release

</details>

---

<details>
<summary><strong>🔗 Further Resources</strong></summary>

See `resources.md` for curated links:
- Official documentation
- Best practices guide
- Example skills repository
- Community resources

</details>

---

## Quick Reference

| Aspect | Requirement |
|--------|-------------|
| Name | Gerund, lowercase, hyphens, ≤64 chars |
| Description | Third-person, what+when, ≤1024 chars |
| SKILL.md size | Under 500 lines |
| File references | One level deep only |
| Path separators | Forward slashes only |
| Examples | At least 2-3 with input/output |
