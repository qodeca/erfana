# Tool Approval System - Core Guide

Complete guide to Erfana's tool approval system for Claude Code integration.

## Overview

**Philosophy**: Opinionated IDE for consultants with full trust in Claude AI capabilities. All 17 Claude Code tools enabled by default for seamless, friction-free workflow.

**Configuration**: Settings modal (Cmd/Ctrl+,) provides per-tool authorization control for users who need custom restrictions.

**Key Features**:
- All 17 tools pre-authorized by default
- Settings modal for flexible per-tool configuration
- Global toggle: "Enable all tools by default"
- Planning mode: Restricts to 9 safe tools for exploration
- Persistent storage via electron-store
- Session restart with --continue when changing tools
- ToolApprovalDialog shown only if user manually restricts a tool

## Tool Authorization

### Pre-Authorized Tools (All 17 by Default)

All Claude Code tools are enabled by default for seamless consultant workflow:

**File Operations (7 tools)**:
- **Read** - Read file contents
- **Write** - Create or overwrite files
- **Edit** - Modify existing files
- **MultiEdit** - Batch file modifications
- **Glob** - Search files by pattern
- **Grep** - Search file contents
- **LS** - List directory contents

**System Operations (1 tool)**:
- **Bash** - Execute shell commands

**AI & Web (3 tools)**:
- **WebSearch** - Search the web
- **WebFetch** - Fetch web content
- **Task** - Delegate to specialized agent

**Workflow & Tasks (4 tools)**:
- **TodoRead** - Read to-do list
- **TodoWrite** - Manage task list
- **SlashCommand** - Execute custom commands
- **ExitPlanMode** - Exit planning phase

**Jupyter Notebooks (2 tools)**:
- **NotebookRead** - Read .ipynb files
- **NotebookEdit** - Edit notebook cells

**Rationale**: Erfana is designed for consultants who trust Claude AI as a coding partner. Pre-authorizing all tools eliminates approval friction while maintaining visibility through chat history and git version control.

### Tools Requiring Approval

**None by default**. All 17 tools are pre-authorized.

Users can manually restrict specific tools via Settings modal (Cmd/Ctrl+,) if security policies require it. ToolApprovalDialog will appear if Claude attempts to use a manually-restricted tool.

### Planning Mode

**Native Claude CLI feature** that restricts Claude to read-only and safe tools for exploration without modifications:

**Activation**: Toggle button in chat interface, uses `--permission-mode plan` flag

**Tool Restrictions in Planning Mode** (9 safe tools):
- **File Operations**: Read, LS, Glob, Grep
- **AI Operations**: Task, WebSearch
- **Task Management**: TodoRead, TodoWrite
- **Notebooks**: NotebookRead

**Blocked in Planning Mode**:
- **Write operations**: Write, Edit, MultiEdit, NotebookEdit
- **Command execution**: Bash
- **Network fetch**: WebFetch
- **Custom commands**: SlashCommand
- **Mode control**: ExitPlanMode

**Use Cases**: Code exploration, architecture planning, research, cost estimation, learning existing codebases

**Implementation**: ClaudeCliService.ts:270-277 defines tool set, session restart with `--permission-mode plan`, Control Panel shows restricted tools, system message confirms mode change

**Visual Indicators**: Toggle button (blue when active), system message, Control Panel displays only 9 safe tools

See: [UI Features - Planning Mode Toggle](./ui-features.md#planning-mode-toggle) for complete UI documentation

## Settings Modal (ToolSettingsDialog)

### Overview

**Location**: `src/renderer/src/components/Dialogs/ToolSettingsDialog.tsx`

Modal dialog for configuring Claude Code tool authorization. Accessed via gear icon in Copilot panel header or Cmd/Ctrl+, keyboard shortcut.

**Features**:
- Blocking modal overlay (prevents background interaction)
- Global toggle: "Enable all tools by default" (checked by default)
- Per-tool checkboxes organized into 5 categories
- Selective mode: Uncheck global toggle to customize individual tools
- Reset to defaults button with inline confirmation
- Save & restart session (triggers Claude CLI session restart)
- Cancel with unsaved changes confirmation
- ESC key and overlay click to close
- Loading state while fetching current settings
- Error display in footer if save fails

**Categories** (17 tools total):
1. **File Operations** (7): Read, Write, Edit, MultiEdit, Glob, Grep, LS
2. **System Operations** (1): Bash
3. **AI & Web** (3): WebSearch, WebFetch, Task
4. **Workflow & Tasks** (4): TodoRead, TodoWrite, SlashCommand, ExitPlanMode
5. **Jupyter Notebooks** (2): NotebookRead, NotebookEdit

### Usage

**Open**: Gear icon or `Cmd/Ctrl+,` when Copilot active

**Default State**: All 17 tools enabled, global toggle checked, counter shows "17 of 17"

**Selective Mode**: Uncheck global toggle → customize individual tools → counter updates → unsaved changes indicator

**Save**: Click Save → session restarts with --continue → modal closes → Control Panel updates

**Cancel**: Cancel button, ESC key, or overlay click → confirmation if unsaved changes

**Reset**: Click Reset → inline confirmation → all tools re-enabled

### Design & Implementation

**Dimensions**: 600px width, max-height 85vh, centered

**Styling**: VS Code dark theme, fadeIn/slideUp animations, internal scroll

**Files**: `ToolSettingsDialog.tsx` (~270 lines), `ToolSettingsDialog.css` (~300 lines)

## Approval Flow

### Complete User Flow

1. **User sends message**: "Change the poem in asd.md"
2. **Claude plans**: Decides to use Edit tool (not approved if user restricted it)
3. **System detects**: Tool_use block with unapproved tool name
4. **Dialog shows**: ToolApprovalDialog appears with tool details
5. **User reviews**: Tool name, description, parameters
6. **User approves**: Clicks "Approve" with "Remember this choice" checked
7. **Session restarts**: Process killed, respawned with --continue + updated --allowedTools
8. **System notifies**: Shows "🔄 Retrying with approved tools: Read, Glob, Grep, Write, Edit"
9. **Auto-retry**: System automatically re-sends "Change the poem in asd.md"
10. **Claude executes**: Uses Edit tool successfully with updated permissions
11. **User sees result**: File modified, operation complete

### Technical Flow

**1. Tool Detection**: `ClaudeCliService.ts` checks tool in `approvedTools` Set → emits `tool-approval-needed` event if not approved

**2. Show Dialog**: `CopilotChat.tsx` listens for event → sets `pendingApproval` state → ToolApprovalDialog appears

**3. Approve**: User clicks Approve → calls `approveTool(toolName, remember)` → closes dialog

**4. Restart**: `approveTool()` adds tool to Set → persists if remember=true → calls `restartWithNewPermissions()`

**5. Session Resume**: Process killed → respawned with `--continue` + updated `--allowedTools` → emits `session-resumed` event

**6. Auto-Retry**: Listens for `session-resumed` → shows system message → auto-sends `lastUserPrompt` if exists

## Conversation Preservation

### Overview
Erfana automatically preserves conversation history when you make configuration changes,
eliminating the frustration of losing context mid-workflow.

### When --continue is Used

**Settings Changes**:
- User modifies tools in Copilot Configuration (Cmd/Ctrl+,)
- Clicks "Save"
- Session restarts with `--continue` flag
- Conversation history preserved
- New tool configuration active

**Planning Mode Toggles**:
- User toggles between planning mode (read-only) and implementation mode (full access)
- Session restarts with `--continue` flag
- Conversation history preserved
- Tool set updated (9 safe tools ↔ all approved tools)

**Tool Approvals**:
- User approves tool via approval dialog
- Session restarts with `--continue` flag
- Conversation history preserved
- Newly approved tool active
- Last prompt automatically re-sent

### Technical Implementation

**Directory-Based Sessions**: Claude CLI stores conversation history in `~/.claude/projects/` organized by project directory path.

**Automatic Resume**: `--continue` flag finds and loads the latest conversation for the current directory without manual session ID management.

**Session Statistics**: Track conversation metrics (message count, tool executions, session age) across configuration changes. Stats reset on each session restart but conversation history is preserved.

See: [Conversation Preservation Guide](./conversation-preservation.md) for complete documentation

## Auto-Retry Feature

**Problem**: After approval and session restart, user had to manually re-send prompt.

**Solution**: System tracks `lastUserPrompt` and automatically re-sends after `sessionResumed` event.

### Implementation

**Store Prompt**: `handleSend()` stores `trimmedInput` in `lastUserPrompt` state before sending

**Auto-Retry**: `onSessionResumed` listener checks `lastUserPrompt` → shows system message → re-sends if exists

**UX Benefit**: User → Dialog → Approve → Auto re-sends (seamless, no manual "proceed" needed)

## Persistent Storage

### SettingsService Methods

**File**: `src/main/services/SettingsService.ts`

```typescript
async getApprovedTools(): Promise<string[]>
// Returns approved tools list, defaults to all 17 tools:
// ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'LS',
//  'WebSearch', 'WebFetch', 'SlashCommand', 'TodoRead', 'TodoWrite', 'Task',
//  'NotebookRead', 'NotebookEdit', 'ExitPlanMode']

async setApprovedTools(tools: string[]): Promise<void>
// Replaces entire approved tools list (used by Settings modal)

async addApprovedTool(toolName: string): Promise<void>
// Adds single tool to list (idempotent)

async removeApprovedTool(toolName: string): Promise<void>
// Removes single tool from list

async resetApprovedTools(): Promise<void>
// Resets to all 17 tools
```

### Storage Location

**Path**: `~/.config/erfana/config.json` (electron-store default on macOS)

**Data Structure** (default):
```json
{
  "approvedTools": [
    "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "Bash", "LS",
    "WebSearch", "WebFetch", "SlashCommand",
    "TodoRead", "TodoWrite", "Task",
    "NotebookRead", "NotebookEdit", "ExitPlanMode"
  ],
  "lastProjectPath": "/Users/user/Projects/my-project"
}
```

**Note**: All 17 tools are included by default via merge logic in `ClaudeCliService.ts:281-287`. Users can customize via Settings modal (Cmd/Ctrl+,).

### Persistence Behavior

**"Remember this choice" checked**:
- Tool persisted to config.json via `addApprovedTool()`
- Survives app restarts
- Next session auto-loads tool at startup

**"Remember this choice" unchecked**:
- Tool added to in-memory `approvedTools` Set only
- Lost on app restart
- Next session will prompt again

## Critical Architecture Decision

### --allowedTools is Immutable

**Key Fact**: Claude CLI reads `--allowedTools` at spawn, cannot change mid-session.

**Consequence**: Adding tool requires full restart (kill → spawn with `--continue` + updated `--allowedTools`)

**Why --continue Works**: Session stored in `~/.claude/projects/` → loads history → applies new permissions → conversation continues

## Components

### ToolApprovalDialog.tsx

**Location**: `src/renderer/src/components/Dialogs/ToolApprovalDialog.tsx`

Modal for approving/denying tool execution with tool name, description, collapsible parameters (JSON), "Remember" checkbox, Approve/Deny buttons.

**Design**: 500px width, VS Code dark theme, fadeIn/slideUp animations

**Files**: `ToolApprovalDialog.tsx` (115 lines), `ToolApprovalDialog.css` (240 lines)

### CopilotChat.tsx

**Location**: `src/renderer/src/components/Copilot/CopilotChat.tsx`

Chat interface with message history, `lastUserPrompt` tracking, `onToolApprovalNeeded`/`onSessionResumed` listeners, ToolApprovalDialog integration.

## Related Documentation

- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Tool Approval Advanced Guide](./tool-approval-advanced.md)** - IPC details, testing, troubleshooting
- **[Conversation Preservation](./conversation-preservation.md)** - Session preservation guide
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Tool approval and settings channels
