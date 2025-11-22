# Pre-Release Checklist

Run through this checklist before releasing your skill.

---

## Required ✓

These items must pass before release.

### Metadata

- [ ] **Name format:** Gerund form (verb+-ing), lowercase, hyphens only
  - ✅ `processing-pdfs`, `generating-tests`
  - ❌ `pdf-helper`, `mySkill`, `process_files`

- [ ] **Name length:** 64 characters or fewer

- [ ] **Description present:** Non-empty description in frontmatter

- [ ] **Description length:** 1024 characters or fewer

- [ ] **Description voice:** Third person
  - ✅ "Extracts text from PDF files..."
  - ❌ "I can help you extract text..."

- [ ] **Description content:** Includes both "what it does" AND "when to use it"
  - ✅ "Extract text from PDFs. Use when working with PDF files or document extraction."
  - ❌ "Helps with PDFs" (too vague, no triggers)

### Structure

- [ ] **SKILL.md size:** Under 500 lines

- [ ] **File references:** One level deep only (SKILL.md → file, not SKILL.md → file → file)

- [ ] **Path separators:** Forward slashes only (`templates/file.md`, not `templates\file.md`)

### Content

- [ ] **Examples included:** At least 2 examples with input and output

- [ ] **Workflow present:** Clear steps or instructions for Claude to follow

---

## Recommended ✓

These items improve quality and reliability.

### Testing

- [ ] **Haiku test:** Mentally simulate - would this work with the simplest model?

- [ ] **Edge cases:** Examples cover unusual scenarios, not just happy path

- [ ] **Error guidance:** Instructions for what to do when things go wrong

### Documentation

- [ ] **Anti-patterns:** Common mistakes documented

- [ ] **Quick reference:** Summary table for frequently needed info

- [ ] **Progressive disclosure:** Long content hidden in `<details>` sections

### Maintenance

- [ ] **Dependencies listed:** Any required tools, packages, or MCP servers documented

- [ ] **Version noted:** If breaking changes expected, version your skill

---

## Final Verification

Before releasing, verify:

- [ ] **Skill loads correctly:** No YAML syntax errors in frontmatter

- [ ] **Discovery works:** Description contains terms users would actually say

- [ ] **Instructions are clear:** Claude can follow the workflow without ambiguity

- [ ] **No placeholder content:** All `[TODO]` or `[PLACEHOLDER]` text replaced

---

## Checklist Usage

### For Simple Skills
Focus on the **Required** section. A simple skill that passes all required items is ready for use.

### For Team/Shared Skills
Complete both **Required** and **Recommended** sections. Team skills should be more robust.

### For Public Skills
Complete everything. Add thorough testing and consider edge cases carefully.

---

## Common Issues

| Issue | Solution |
|-------|----------|
| "Skill not activating" | Description lacks trigger terms users would say |
| "Claude ignores instructions" | Workflow too vague, add specific steps |
| "Works on Opus, fails on Haiku" | Instructions need more detail for simpler models |
| "YAML parse error" | Check frontmatter syntax, especially quotes and colons |
