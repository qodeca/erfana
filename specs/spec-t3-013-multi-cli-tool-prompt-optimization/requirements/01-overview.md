# Overview

## Summary

Multi-CLI tool prompt optimization enables users to select their preferred AI CLI tool (Claude Code, Codex, Gemini CLI) from a dropdown in the terminal toolbar, with prompts automatically optimized for the selected tool's expected format and capabilities.

## Purpose

Currently, the prompt template system is designed around a single CLI tool format. As the ecosystem of AI-powered CLI tools expands, users need flexibility to work with their tool of choice without manual prompt reformatting. This feature abstracts prompt generation behind tool-specific adapters, ensuring optimal results regardless of which CLI tool is active.

## Scope

### Included

- CLI tool selection dropdown in terminal toolbar UI
- Persistent default tool preference in global settings
- Dedicated prompt template versions for each supported CLI tool
- Tool registry with format definitions and template mappings
- Support for Claude Code, Codex, and Gemini CLI at launch

### Template inventory

Current templates requiring multi-tool versions:

**Markdown preview context menu** (5 templates):
- `explain.md` - Expand/explain on selected text
- `modify.md` - Apply user-specified modification
- `ask.md` - Answer questions about selection
- `visualize.md` - Generate Mermaid diagram (22 diagram types)
- `prompt.md` - Free-form prompt with context

**Monaco editor context menu** (5 templates):
- `editor-explain.md` - Explain on selected code
- `editor-modify.md` - Modify selected code
- `editor-ask.md` - Ask about selected code
- `editor-visualize.md` - Visualize code as diagram
- `editor-prompt.md` - Free-form prompt with code context

**Mermaid diagram viewer** (3 templates):
- `mermaid-chat.md` - Modify diagram via chat
- `mermaid-bug-report.md` - Report rendering errors
- `mermaid-change-direction.md` - Change diagram orientation

**Other** (1 template):
- `organize-import.md` - Handle file imports

**Scope**: 14 templates × 3 tools = **42 template files** for full multi-tool support

### Migration strategy

Existing templates will be migrated to the new structure as follows:

1. **Rename existing templates** to Claude Code versions in tool-specific subfolders:
   - `templates/explain.md` → `templates/claude-code/markdown-preview/explain.md`
   - `templates/editor-explain.md` → `templates/claude-code/monaco-editor/explain.md`
   - etc.

2. **Research prompting best practices** for each non-Claude tool:
   - **Codex**: Research OpenAI Codex CLI documentation and community best practices for:
     - Optimal prompt structure and formatting
     - Context window management
     - Code reference conventions
     - Instruction phrasing that yields best results
   - **Gemini CLI**: Research Google Gemini CLI documentation and prompting guides for:
     - Preferred input formatting (plain text vs structured)
     - File reference conventions
     - Context presentation patterns
     - Instruction style recommendations

3. **Create Codex and Gemini CLI versions** in their respective tool subfolders:
   - `templates/codex/markdown-preview/explain.md`
   - `templates/gemini-cli/markdown-preview/explain.md`
   - Apply research findings to optimize each template for its target tool
   - Convert XML blocks to markdown (Codex) or plain text (Gemini)
   - Update file reference format per tool conventions
   - Adjust instruction style to match tool expectations

4. **Template directory structure**:
   ```
   templates/
   ├── claude-code/
   │   ├── markdown-preview/
   │   ├── monaco-editor/
   │   ├── mermaid-viewer/
   │   └── other/
   ├── codex/
   │   ├── markdown-preview/
   │   ├── monaco-editor/
   │   ├── mermaid-viewer/
   │   └── other/
   └── gemini-cli/
       ├── markdown-preview/
       ├── monaco-editor/
       ├── mermaid-viewer/
       └── other/
   ```

5. **Update registry glob pattern** to discover templates from tool subdirectories:
   - Before: `./templates/*.md`
   - After: `./templates/{tool}/{area}/*.md`

6. **Backward compatibility**: Claude Code templates produce identical output to current system behavior (verified by 013-TC-007).

### Excluded

- Automatic tool detection or installation verification
- CLI tool version management
- Custom user-defined tool configurations (future enhancement)
- Tool-specific response parsing or result handling
- Integration with tool-specific authentication flows

## Success criteria

1. Users can select their preferred CLI tool from a dropdown without leaving the terminal view
2. Default tool preference persists across sessions via global settings
3. All existing prompts render correctly for each supported tool
4. Each supported tool has dedicated prompt template versions optimized for its specific conventions and capabilities
5. No regression in prompt execution latency (< 50ms overhead for tool adaptation)
