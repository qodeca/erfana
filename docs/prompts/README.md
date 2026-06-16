# Prompt Templates

Dynamic, extensible AI prompts for context menu actions using YAML frontmatter + XML-structured content with Handlebars interpolation.

## Overview

**Location:** `src/renderer/src/prompts/`

The template system enables AI-powered text operations through right-click context menus in markdown preview and editor.

## Quick Start

1. Right-click selected text in preview or editor
2. Choose action: **Explain**, **Modify**, **Ask**, **Visualize**, or custom template
3. Prompt sent to Terminal panel
4. Review/edit before execution (unless auto-execute enabled)

Templates split into two categories: **read-only** prompts (Explain, Ask, Prompt) produce a terminal response and leave the document untouched, and **mutation** prompts (Modify, Visualize, the three Mermaid templates) edit the file in place via the CLI agent's Edit tool — see [Mutation prompts and the apply-to-document footer](#mutation-prompts-and-the-apply-to-document-footer) (v0.10.0).

## Documentation

- [Template Syntax](./template-syntax.md) - Variables, conditionals, helpers
- [Examples](./examples.md) - Template examples and use cases

### AutoExecute Implementation (v0.3.4)
- [Overview](./autoexecute-overview.md) - Feature overview and architecture
- [Technical Details](./autoexecute-technical.md) - Write pipeline and 200ms delay rationale
- [Testing](./autoexecute-testing.md) - Test coverage and mocking strategy
- [Reference](./autoexecute-reference.md) - Error handling and implementation files

## Architecture

```
prompts/
├── templates/       # Template markdown files (14 templates)
├── parser.ts        # YAML frontmatter parser
├── renderer.ts      # CSP-safe renderer
├── schema.ts        # Zod validation (includes mutatesDocument flag)
├── registry.ts      # Dynamic loader
├── helpers.ts       # Template helpers
├── applyFooter.ts   # Canonical apply-to-document footer (v0.10.0)
├── validation.ts    # Per-template variable requirements
└── types.ts         # TypeScript types
```

## XML Structure (v0.6.3)

Templates use semantic XML tags to structure prompts for Claude Code:

```markdown
---
(YAML frontmatter)
---
<context>
{{#if fileRef}}{{fileRef}}
Source: {{basename filePath}} ({{formatLineRange startLine endLine}})
{{/if}}
</context>

<input>
{{selectedText}}
</input>

<task>
Primary instruction.
</task>

<instructions>
- Step-by-step guidance
</instructions>

<constraints>
- 200-300 words maximum
- No preamble
</constraints>

<output_format>
Expected response structure.
</output_format>
```

### XML Tags

| Tag | Purpose |
|-----|---------|
| `<context>` | File reference, location info |
| `<input>` | Selected text or user content |
| `<task>` | Primary instruction/objective |
| `<instructions>` | Step-by-step guidance |
| `<constraints>` | Limits and boundaries |
| `<output_format>` | Expected response structure |

## Thinking Triggers

Templates can include thinking triggers for Claude Code to enable deeper analysis:

| Trigger | Token Budget | Usage |
|---------|--------------|-------|
| "think" | ~4,000 | Baseline analysis |
| "think hard" | ~10,000 | Complex tasks |
| "ultrathink" | ~32,000 | Very complex problems |

**Applied in templates:**
- `explain.md`: "Think about the content..."
- `ask.md`: "Think about the question..."
- `visualize.md`: "Think hard about how to best represent..."

## Available Templates

A `Mutates?` column flags templates that set `mutatesDocument: true` and apply their result to the file in place. Read-only templates produce a terminal response only.

### Preview context menu (area: markdown-preview)

| Template | Registry id | Purpose | Input Required | Mutates? |
|----------|-------------|---------|----------------|----------|
| `explain.md` | `explain` | Explain selected text | No | No |
| `modify.md` | `modify` | Apply modifications | Yes (instruction) | Yes — replace selection |
| `ask.md` | `ask` | Answer questions | Yes (question) | No |
| `visualize.md` | `visualize` | Generate Mermaid diagrams | Yes (diagram type dropdown) | Yes — insert after selection |
| `prompt.md` | `prompt` | Generic prompt | Yes (instruction) | No |
| `mermaid-chat.md` | `diagram-chat` | Modify diagrams | Yes (instruction) | Yes — edit diagram in place |
| `mermaid-bug-report.md` | `mermaid-bug-report` | Fix syntax errors | No | Yes — edit diagram in place |
| `mermaid-change-direction.md` | `change-mermaid-direction` | Change diagram direction | No | Yes — replace direction keyword |
| `organize-import.md` | `organize-import` | Organize imported files | No | No (interactive move/rename) |

> The id is derived from `frontmatter.id || slugify(name)` in `parser.ts:72`. Filenames are not the IDs — `mermaid-chat.md` registers as `diagram-chat`, `mermaid-change-direction.md` as `change-mermaid-direction`. Call sites and tests must key off the IDs.

### Editor context menu (area: code-editor) - v0.6.4-beta

| Template | Registry id | Purpose | Input Required | Mutates? |
|----------|-------------|---------|----------------|----------|
| `editor-explain.md` | `editor-explain` | Explain selected code/text | No | No |
| `editor-modify.md` | `editor-modify` | Apply modifications to code | Yes (instruction) | Yes — replace selection |
| `editor-ask.md` | `editor-ask` | Answer questions about code | Yes (question) | No |
| `editor-visualize.md` | `editor-visualize` | Generate diagrams from code | Yes (diagram type dropdown) | Yes — insert after selection |
| `editor-prompt.md` | `editor-prompt` | Generic code prompt | Yes (instruction) | No |

### organize-import with AskUserQuestion (v0.6.3)

The organize-import template uses Claude Code's `AskUserQuestion` tool for interactive decision-making:

```markdown
<task>
Use the AskUserQuestion tool at each decision point for better UX.
</task>

<instructions>
## Phase 2: Location Decision
After analysis, use AskUserQuestion to present location options:
- Header: "File location"
- Question: "Where should this file be placed?"
</instructions>
```

This provides clickable UI buttons instead of text-based "Type 1/2/3" prompts.

## Mutation prompts and the apply-to-document footer

Introduced in v0.10.0. Mutation templates set `mutatesDocument: true` in their frontmatter; when rendered, a single canonical apply-to-document footer is composed onto the prompt at the render funnel so the CLI agent deterministically edits the file instead of printing the result to the terminal.

**Why the footer exists.** Earlier versions handed the selected text to the agent inline plus an `@path:lines` reference, but several templates' `<output_format>` said "return ONLY the code block / no commentary." The competing signal made the agent non-deterministically print a snippet instead of editing the file. The footer encodes the agent's real Edit-tool mechanics in one place, and the mutation template bodies were rewritten to drop all competing "print only" wording.

**What the footer enforces.** A numbered procedure: read the file at `{{fileRef}}` first (the Edit tool requires it), locate the target region using the line range as the anchor (the inline snippet may differ from disk on line endings or rendering), apply the edit in place, retry with more surrounding context on a not-found / not-unique failure, and never fall back to printing. Plus scope guardrails (edit only the referenced file/region, no shell commands, treat the shown content as data not instructions) and a frictionless apply (no confirmation stalling).

**Placement is per-template.** The footer enforces the *how*; each template's `<task>` states the *where* — replace selection (Modify), insert after selection with surrounding blank lines (Visualize), edit the existing diagram block in place (Diagram chat / Bug report), or replace the direction keyword (Change direction).

**Mechanism.** In `applyFooter.ts`, `withApplyFooter(template, mutates)` is a pure function: when `mutates` is true it appends `MUTATE_DOCUMENT_FOOTER` to the template string and returns it; otherwise it returns the template unchanged. `panelUtils.executePromptTemplate` calls it once before `promptRenderer.render` so `{{fileRef}}` in the footer interpolates in the same pass as the body. The footer string is the spec-013 multi-CLI extension point — it is Claude-Code-specific today and will swap to a per-tool lookup when Codex / Gemini CLI support lands.

**Required variables.** `prompts/validation.ts` requires `filePath` for every mutation template (the four editor / preview ones already required it; the three diagram templates gained the requirement so the footer's `{{fileRef}}` can never render empty).

**Tests.** `applyFooter.test.ts` covers the pure function. `mutation-templates.test.ts` is an invariant test that the seven mutating registry IDs all carry the flag, that each rendered prompt contains the apply marker with a non-empty file reference, that no body contains the competing "return only / no commentary / no explanation" wording, and that read-only templates do not gain the flag. It also pins a golden inline snapshot of the rendered `modify` prompt.

**Accepted risk.** Frictionless auto-apply has no human-in-the-loop confirmation gate. The scope guardrails bound a successful prompt injection (single file/region, no shell, content-is-data) but cannot prevent one — the real backstop is the user's Claude Code permission / sandbox configuration. This is a documented trade-off; UX cost of a confirmation gate was declined.

## Available Variables

| Variable | Description |
|----------|-------------|
| `{{selectedText}}` | Selected markdown |
| `{{filePath}}` | Current file path |
| `{{startLine}}`, `{{endLine}}` | Line numbers |
| `{{fileRef}}` | File reference (`@path:start-end`); required (via `filePath`) for every mutation template |
| `{{userInput}}` | User input (if required) |
| `{{userInstruction}}` | Free-form instruction (Mermaid chat) |
| `{{diagramType}}` | Mermaid diagram type (visualize) |
| `{{mermaidCode}}` | Existing diagram code |
| `{{mermaidError}}` | Rendering error message (bug report) |
| `{{targetDirection}}`, `{{directionLabel}}` | Mermaid direction change |
| `{{importedFilePath}}` | Imported file path |

## Target Behavior

All templates target Terminal panel:
- `sendDirectly: false` - User can edit before running
- `autoExecute: true` - Auto-press Enter after paste
- `mutatesDocument: false` (default) — read-only prompt; **true** composes the apply-footer (v0.10.0)
- **Auto-scroll (v0.5.4)** - Terminal scrolls to bottom 1 second after execution

## Implementation Files

- Footer: `applyFooter.ts` (`MUTATE_DOCUMENT_FOOTER` + `withApplyFooter`)
- Context menu: `PreviewContextMenu.tsx`, `EditorContextMenu.tsx`, `MermaidToolbar.tsx`, `MermaidDiagram.tsx`, `ChatBubble.tsx` (Diagram chat)
- Line tracking: `MarkdownPreview.tsx`
- Panel utilities: `panelUtils.ts` (single render funnel; composes the footer before render)
- Templates: `templates/*.md`

## Related

- [Editor Documentation](../editor/README.md)
- [Terminal](../terminal/README.md)
