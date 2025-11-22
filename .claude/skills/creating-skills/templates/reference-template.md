# Reference File Template

Use this template for supporting reference files in your skill.

---

```markdown
# [Topic Name] Reference

<!--
  Reference files provide detailed information that SKILL.md links to.
  They are loaded only when Claude needs them (progressive disclosure).

  Keep focused on ONE topic per file.
  Aim for 100-300 lines. If longer, consider splitting.
-->

## Overview

[Brief introduction to what this reference covers - 2-3 sentences]

## [Main Section 1]

### [Subsection]

[Detailed content]

### [Subsection]

[Detailed content]

## [Main Section 2]

[Content organized logically]

## Quick Reference

<!--
  Optional: Include a summary table for quick lookup.
  Useful for frequently referenced information.
-->

| Item | Description |
|------|-------------|
| [Key 1] | [Value 1] |
| [Key 2] | [Value 2] |

## Further Reading

<!--
  Optional: Link to external resources.
  Only include highly relevant, stable links.
-->

- [Resource Name](https://example.com) - Brief description
```

---

## Guidelines for Reference Files

### When to Create a Reference File

Create a separate reference file when:
- Content is detailed and would make SKILL.md too long
- Information is used conditionally (not always needed)
- Topic is self-contained and reusable

### Naming Convention

Use descriptive, lowercase names with hyphens:
- `api-formats.md` - API request/response formats
- `error-codes.md` - Error handling reference
- `examples-advanced.md` - Advanced usage examples

### File Organization

```
your-skill/
├── SKILL.md              # Links to reference files
├── reference.md          # Single reference (simple skills)
└── references/           # Multiple references (complex skills)
    ├── api-formats.md
    ├── error-codes.md
    └── best-practices.md
```

### Linking from SKILL.md

Reference files from SKILL.md using relative paths:

```markdown
For detailed API formats, see `reference.md`.

For error handling, see `references/error-codes.md`.
```

### Important Rules

1. **One level deep only** - SKILL.md can reference files, but those files should NOT reference other files
2. **Self-contained** - Each reference file should be understandable on its own
3. **Focused** - One topic per file
4. **Forward slashes** - Always use `/` not `\` in paths
