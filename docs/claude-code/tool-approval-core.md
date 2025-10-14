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

**Opening Modal**:
- Click gear icon in Copilot header
- OR press Cmd/Ctrl+, when Copilot is active

**Default State**:
- "Enable all tools by default" checkbox: ✓ Checked
- All 17 individual checkboxes: ✓ Checked and disabled (grayed out)
- Counter: "17 of 17 selected"

**Selective Mode**:
1. Uncheck "Enable all tools by default"
2. Individual checkboxes become active
3. Customize specific tools
4. Counter updates (e.g., "15 of 17 selected")
5. Unsaved changes indicator appears

**Saving Changes**:
1. Click "Save" button
2. Session restarts with updated tool configuration
3. Modal closes automatically
4. Conversation history preserved via --continue
5. Control Panel updates to show new tool list

**Canceling**:
- Click "Cancel" button
- Press ESC key
- Click overlay background
- Confirmation if unsaved changes exist

**Reset to Defaults**:
1. Click "Reset to Defaults" button
2. Inline confirmation appears
3. Click "Yes" to confirm
4. All 17 tools re-enabled
5. "Enable all tools by default" re-checked

### Props

```typescript
interface ToolSettingsDialogProps {
  onClose: () => void
  onSave: (approvedTools: string[]) => Promise<void>
}
```

### Design

- **Dimensions**: 600px width, max-height 85vh, centered
- **Colors**: VS Code dark (#2d2d30 background, #007acc accent)
- **Icons**: Settings (gear), AlertCircle (error) from Lucide React
- **Animations**: fadeIn 0.2s (overlay), slideUp 0.3s (dialog)
- **Scrolling**: Internal scroll for tool list, fixed header/footer

### Usage Pattern

```typescript
const [showSettings, setShowSettings] = useState(false)

const handleSaveSettings = async (approvedTools: string[]) => {
  await window.api.settings.setApprovedTools(approvedTools)
  await window.api.claudeCode.stopSession()
  const projectPath = await window.api.file.getProjectPath()
  if (projectPath) {
    await window.api.claudeCode.startSession(projectPath, false)
  }
}

// In header
<span className="settings-button" onClick={() => setShowSettings(true)}>
  <Settings size={16} />
</span>

// In render
{showSettings && (
  <ToolSettingsDialog
    onClose={() => setShowSettings(false)}
    onSave={handleSaveSettings}
  />
)}
```

**Files**:
- `ToolSettingsDialog.tsx` (~270 lines) - Component logic
- `ToolSettingsDialog.css` (~300 lines) - Modal styling

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

**1. Tool Detection** (`ClaudeCliService.ts:654-683`)

Checks if tool is in `approvedTools` Set, if not:
- Emits `'tool-approval-needed'` event with tool details
- Returns `null` to suppress tool_use from UI
- System message shown to user

**2. Show Dialog** (`CopilotChat.tsx:104-111`)

Listens for `onToolApprovalNeeded` event, sets `pendingApproval` state to show ToolApprovalDialog.

**3. Approve Tool** (`CopilotChat.tsx:206-217`)

User approves → calls `window.api.claudeCode.approveTool(toolName, remember)` → closes dialog.

**4. Add to Approved List & Restart** (`ClaudeCliService.ts:300-313`)

```typescript
async approveTool(toolName: string, remember: boolean): Promise<void> {
  this.approvedTools.add(toolName)
  if (remember) {
    await settingsService.addApprovedTool(toolName)
  }
  await this.restartWithNewPermissions()
}
```

**5. Restart Session with --continue** (`ClaudeCliService.ts:329-405`)

```typescript
private async restartWithNewPermissions(): Promise<void> {
  const previousSessionId = this.sessionId
  this.claudeProcess.kill('SIGTERM')

  const args = [
    '-p', this.projectPath,
    '--continue',  // Preserve conversation
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--allowedTools', ...Array.from(this.approvedTools)  // Updated list
  ]

  this.claudeProcess = spawn('claude', args, { cwd: this.projectPath })
  this.emit('session-resumed', { projectPath, approvedTools: Array.from(this.approvedTools) })
}
```

**6. Auto-Retry** (`CopilotChat.tsx:119-140`)

Listens for `onSessionResumed` event, if `lastUserPrompt` exists:
- Shows system message with approved tools list
- Automatically re-sends last user prompt
- No manual intervention needed

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

**Store Prompt** (`CopilotChat.tsx:134-135`):
```typescript
const handleSend = () => {
  setLastUserPrompt(trimmedInput)  // Store for auto-retry
  window.api.claudeCode.sendMessage(trimmedInput, {}, sessionId)
}
```

**Auto-Retry on Resume** (`CopilotChat.tsx:119-140`):
```typescript
useEffect(() => {
  const unsubscribe = window.api.claudeCode.onSessionResumed((data) => {
    if (lastUserPrompt) {
      setMessages(prev => [...prev, {
        type: 'system',
        content: `🔄 Retrying with approved tools: ${data.approvedTools.join(', ')}`
      }])
      window.api.claudeCode.sendMessage(lastUserPrompt, {}, newSessionId)
    }
  })
  return unsubscribe
}, [lastUserPrompt])
```

### UX Comparison

**Before Auto-Retry**:
User → Dialog → Approve → Session Restarts → User types "proceed" → Executes

**With Auto-Retry**:
User → Dialog → Approve → Session Restarts → **Auto re-sends** → Executes

**Benefit**: Seamless UX, user doesn't need to know about session restart.

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

**Key Fact**: Claude CLI reads `--allowedTools` at process spawn and **cannot change permissions mid-session**.

**Why This Matters**:
```typescript
// ❌ This does NOT work
spawn('claude', ['--allowedTools', 'Read', 'Glob', 'Grep'])
// Later: Cannot dynamically add 'Edit' to running process

// ✅ This works
this.approvedTools.add('Edit')
this.claudeProcess.kill()
spawn('claude', [
  '--continue',  // Preserve conversation
  '--allowedTools', ...this.approvedTools  // Updated list
])
```

**Consequence**: To add new tool, must restart session.

**Why --continue Works**:
- Claude CLI stores session state client-side in `~/.claude/projects/`
- `--continue` loads previous conversation history from disk
- New `--allowedTools` list applied to resumed session
- Result: Conversation continues with new permissions

## Components

### ToolApprovalDialog.tsx

**Location**: `src/renderer/src/components/Dialogs/ToolApprovalDialog.tsx`

Modal dialog for approving or denying Claude Code tool execution.

**Features**:
- Tool name display (monospace font, blue color)
- Tool description explaining what the tool does
- Collapsible parameters section (JSON pretty-print)
- "Remember this choice" checkbox for persistent approval
- Approve/Deny action buttons with icons
- VS Code dark theme styling
- Overlay prevents interaction with app during approval
- Animations: fadeIn (overlay), slideUp (dialog)

**Props**:
```typescript
interface ToolApprovalRequest {
  toolName: string      // e.g., "Edit", "Write", "Bash", "Task"
  toolId: string        // UUID from Claude CLI
  input: any            // Tool parameters as JSON object
  description: string   // Human-readable tool description
}

interface ToolApprovalDialogProps {
  request: ToolApprovalRequest
  onApprove: (remember: boolean) => void
  onDeny: () => void
}
```

**Design**:
- **Dimensions**: 500px width, max-height 80vh, centered
- **Colors**: VS Code dark (#2d2d30 background, #007acc buttons)
- **Icons**: AlertTriangle (warning), Check (approve), X (deny) from Lucide React
- **Animations**: fadeIn 0.2s (overlay), slideUp 0.3s (dialog)
- **Parameters**: Collapsible with toggle button, JSON formatted with 2-space indent

**Usage Pattern**:
```typescript
const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)

// Listen for approval requests
useEffect(() => {
  const unsubscribe = window.api.claudeCode.onToolApprovalNeeded((request) => {
    setPendingApproval(request)
  })
  return unsubscribe
}, [])

// Render dialog conditionally
{pendingApproval && (
  <ToolApprovalDialog
    request={pendingApproval}
    onApprove={handleToolApprove}
    onDeny={handleToolDeny}
  />
)}
```

**Files**:
- `ToolApprovalDialog.tsx` (115 lines) - Component logic
- `ToolApprovalDialog.css` (240 lines) - VS Code-themed styling

### CopilotChat.tsx

**Location**: `src/renderer/src/components/Copilot/CopilotChat.tsx`

Chat interface with:
- Message history display
- `lastUserPrompt` tracking for auto-retry
- `onToolApprovalNeeded` listener → shows dialog
- `onSessionResumed` listener → auto-retries prompt
- ToolApprovalDialog integration

**Key State**:
```typescript
const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
const [lastUserPrompt, setLastUserPrompt] = useState('')
```

## Related Documentation

- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Tool Approval Advanced Guide](./tool-approval-advanced.md)** - IPC details, testing, troubleshooting
- **[Conversation Preservation](./conversation-preservation.md)** - Session preservation guide
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Tool approval and settings channels
