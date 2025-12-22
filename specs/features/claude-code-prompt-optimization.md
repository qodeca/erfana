# Claude Code prompt optimization

## Overview

Optimize Erfana's internal AI prompt templates for exceptional Claude Code terminal experience. This involves restructuring 9 existing prompts to use XML tags, incorporate Claude Code best practices, and leverage built-in agents where appropriate.

### Purpose

Transform plain markdown prompts into XML-structured prompts that Claude Code handles more efficiently, resulting in:
- Clearer instruction parsing
- More accurate responses
- Better terminal-friendly output
- Enhanced user experience

### Scope

**In scope:**
- 9 template files in `src/renderer/src/prompts/templates/`
- Content restructuring (XML tags in body)
- Terminal UX optimization (output length, formatting)
- Agent utilization instructions where beneficial

**Out of scope:**
- Infrastructure changes (parser, schema, renderer)
- YAML frontmatter format changes
- New prompt creation

---

## Requirements

### Functional requirements

#### FR-001: XML tag structure
All prompt template bodies MUST use XML tags to separate:
- `<context>` - Background information about the task
- `<task>` - Primary instruction/objective
- `<input>` - Selected text or user-provided content
- `<instructions>` - Step-by-step guidance
- `<constraints>` - Limits and boundaries
- `<output_format>` - Expected response structure

#### FR-002: Terminal-optimized output
Prompts MUST request terminal-friendly responses:
- Maximum 2000 characters unless task requires more
- Bullet points preferred over paragraphs
- No preamble or meta-commentary
- Direct, action-oriented language

#### FR-003: Agent utilization guidance
Where beneficial, prompts SHOULD include instructions for Claude Code to:
- Use the Explore subagent for codebase research tasks
- Use AskUserQuestion tool when clarification needed
- Delegate complex multi-step tasks appropriately

#### FR-004: Consistent tag naming
All prompts MUST use consistent XML tag names:
- Same tags across all templates
- Tags referenced in instructions (e.g., "Using the content in `<input>` tags...")
- Semantic naming that reflects content

#### FR-005: Example preservation
Prompts MAY include 1-2 brief examples using `<examples>` tag:
- Input/output pairs
- Simple to complex progression
- Concise (1-2 lines each)

#### FR-006: Thinking triggers
Complex prompts SHOULD use thinking trigger phrases:
- "think" for baseline analysis
- "think hard" for increased reasoning
- Reserved for Elaborate, Visualize, and Ask prompts

### Non-functional requirements

#### NFR-001: Backward compatibility
Modified prompts MUST work with existing:
- YAML frontmatter parser
- Handlebars-style variable interpolation (`{{variable}}`)
- PromptDialog component

#### NFR-002: Response quality
Optimized prompts SHOULD achieve:
- First-attempt success rate improvement
- Reduced need for follow-up clarification
- Consistent output formatting

#### NFR-003: Maintainability
XML structure MUST be:
- Human-readable
- Easy to modify
- Self-documenting through semantic tags

---

## Acceptance criteria

### AC-001: All templates converted
- [ ] All 9 templates use XML tag structure
- [ ] YAML frontmatter unchanged
- [ ] Variable interpolation preserved

### AC-002: Terminal UX verified
- [ ] Outputs fit terminal width (80-120 chars)
- [ ] No excessive verbosity
- [ ] Clear visual hierarchy

### AC-003: Claude Code compatibility
- [ ] Prompts work in Claude Code terminal
- [ ] Agent instructions are actionable
- [ ] AskUserQuestion guidance is relevant

### AC-004: Quality validation
- [ ] Manual testing of each prompt type
- [ ] Before/after comparison documented
- [ ] User feedback collected (optional)

---

## Implementation guidance

### Template transformation pattern

**Before (current):**
```markdown
---
(YAML frontmatter - unchanged)
---
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Selected text:
---
{{selectedText}}
---

Plain text instructions here...
```

**After (optimized):**
```markdown
---
(YAML frontmatter - unchanged)
---
<context>
{{#if fileRef}}Reference: {{fileRef}}
Source: {{filePath}} ({{formatLineRange startLine endLine}}){{/if}}
</context>

<input>
{{selectedText}}
</input>

<task>
Primary instruction here.
</task>

<instructions>
1. First step
2. Second step
</instructions>

<constraints>
- Max 2000 characters
- Terminal-friendly formatting
- No preamble
</constraints>

<output_format>
Bullet points or specific structure expected.
</output_format>
```

### Files to modify

| File | Priority | Complexity | Notes |
|------|----------|------------|-------|
| `elaborate.md` | High | Medium | Add thinking trigger |
| `modify.md` | High | Low | Straightforward conversion |
| `ask.md` | High | Medium | Add thinking trigger, AskUserQuestion guidance |
| `visualize.md` | High | Medium | Already structured, enhance with XML |
| `prompt.md` | Medium | Low | Generic prompt template |
| `mermaid-chat.md` | Medium | Medium | Complex Mermaid-specific instructions |
| `mermaid-bug-report.md` | Low | Low | Specialized template |
| `mermaid-change-direction.md` | Low | Low | Specialized template |
| `organize-import.md` | Low | Low | Import organization |

### Claude Code best practices to apply

Based on official Anthropic documentation:

1. **Be explicit**: "Create an analytics dashboard" → "Create an analytics dashboard. Include relevant features. Go beyond basics."

2. **Add context**: Explain why behavior is important, not just what to do

3. **Use XML for clarity**: Tags prevent mixing instructions with examples

4. **Parallel tool calls**: When multiple independent actions needed, batch them

5. **State tracking**: For complex tasks, suggest using structured formats

6. **Thinking triggers**: "think", "think hard", "think harder" for deeper analysis

7. **Proactive action**: Default to implementing rather than suggesting

### Agent utilization patterns

**When to suggest Explore subagent:**
```xml
<instructions>
If codebase context is needed, use the Explore subagent to search for related files before responding.
</instructions>
```

**When to suggest AskUserQuestion:**
```xml
<instructions>
If the request is ambiguous or has multiple valid interpretations, use AskUserQuestion to clarify before proceeding.
</instructions>
```

---

## Research sources

- [Claude Code: Best practices for agentic coding](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Prompting best practices - Claude 4.x](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices)
- [Use XML tags - Claude Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags)
- [Prompt engineering overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)

### Key findings from research

| Practice | Source | Impact |
|----------|--------|--------|
| XML tags for structure | Anthropic Docs | Prevents instruction/example mixing |
| Explicit instructions | Claude 4.x Guide | Better first-attempt success |
| Thinking triggers | Claude Code Guide | Deeper analysis for complex tasks |
| Terminal output limits | Best Practices | Better UX in CLI |
| Agent delegation | Claude Code Docs | Efficient multi-step tasks |
| Parallel tool calls | Claude 4.x Guide | ~100% success with proper prompting |

---

## Definition of done

1. All 9 templates converted to XML structure
2. YAML frontmatter and variable interpolation preserved
3. Each template manually tested in Claude Code terminal
4. Output quality verified (concise, formatted, accurate)
5. Documentation updated if needed
