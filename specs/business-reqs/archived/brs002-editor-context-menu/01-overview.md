# Overview

## Summary

This BRS defines the requirements for adding a context menu to the Monaco markdown editor that provides AI-assisted prompts on text selection. The feature brings parity with the existing preview panel context menu, allowing users to access AI prompts directly while editing without switching to preview mode.

## Purpose

Users editing markdown in the Monaco editor currently lack quick access to AI-assisted prompts. They must switch to preview mode to use the context menu with AI prompts, disrupting their editing workflow. This feature eliminates that friction by providing the same prompt access directly in the editor.

## Scope

### In Scope

- Custom context menu for Monaco editor triggered on right-click with text selected
- Prompt filtering by `area: code-editor` and `subArea: context-menu`
- Integration with existing prompt execution infrastructure
- Editor-specific prompt templates (Elaborate, Modify, Ask)
- Copy selection action in context menu
- Menu positioning with viewport boundary detection

### Out of Scope

- Changes to existing preview context menu behavior
- New prompt execution mechanisms (reuses existing infrastructure)
- Monaco editor keybindings or shortcuts
- Non-markdown file type support

## Success Criteria

| Criterion | Measurement | Target |
|-----------|-------------|--------|
| Feature parity | All preview context menu capabilities available in editor | 100% |
| Code reuse | Shared infrastructure with preview context menu | >80% |
| Test coverage | Unit test coverage for EditorContextMenu | >80% |
| User workflow | Steps to access AI prompt from editor | 2 (select + right-click) |
