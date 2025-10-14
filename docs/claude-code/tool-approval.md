# Tool Approval System

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
- Session restart with --resume when changing tools
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

## Approval Flow

### Complete User Flow

1. **User sends message**: "Change the poem in asd.md"
2. **Claude plans**: Decides to use Edit tool (not approved)
3. **System detects**: Tool_use block with unapproved tool name
4. **Dialog shows**: ToolApprovalDialog appears with tool details
5. **User reviews**: Tool name, description, parameters
6. **User approves**: Clicks "Approve" with "Remember this choice" checked
7. **Session restarts**: Process killed, respawned with --resume + updated --allowedTools
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

**5. Restart Session with --resume** (`ClaudeCliService.ts:329-405`)

```typescript
private async restartWithNewPermissions(): Promise<void> {
  const previousSessionId = this.sessionId
  this.claudeProcess.kill('SIGTERM')

  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--replay-user-messages',
    '--resume', previousSessionId,  // Preserve context
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

### When --resume is Used

**Settings Changes**:
- User modifies tools in Copilot Configuration (Cmd/Ctrl+,)
- Clicks "Save"
- Session restarts with `--resume` flag
- Conversation history preserved
- New tool configuration active

**Planning Mode Toggles**:
- User toggles between planning mode (read-only) and implementation mode (full access)
- Session restarts with `--resume` flag
- Conversation history preserved
- Tool set updated (9 safe tools ↔ all approved tools)

**Tool Approvals**:
- User approves tool via approval dialog
- Session restarts with `--resume` flag
- Conversation history preserved
- Newly approved tool active
- Last prompt automatically re-sent

### Session ID Lifecycle

Session ID determines when conversation context is preserved:

```
Initial Project Open:
  └─> Fresh session ID → New conversation

Settings Change:
  └─> Reuse session ID + --resume → Conversation preserved

Planning Mode Toggle:
  └─> Reuse session ID + --resume → Conversation preserved

Tool Approval:
  └─> Reuse session ID + --resume → Conversation preserved

Manual Restart:
  └─> Fresh session ID → New conversation

Crash Recovery:
  └─> Attempt --resume → Fallback to fresh if failed
```

### Resume Failure Handling

If `--resume` fails (session not found, corrupted, etc.), Erfana automatically:
1. Detects failure from Claude CLI stderr (13 error patterns)
2. Generates fresh session ID
3. Restarts without `--resume`
4. Shows system message: "⚠️ Previous conversation unavailable. Starting fresh session."
5. Continues with fresh session

**Common Causes**:
- Session file deleted from `~/.claude/projects/`
- Session expired (>30 days old)
- Claude CLI version mismatch
- File system corruption
- Network interruption during server-side session fetch

**Error Patterns Detected** (13 total):
```
'session not found'
'resume failed'
'invalid session'
'session expired'
'failed to resume'
'could not resume'
'unable to resume'
'session file not found'
'session file corrupted'
'session file is corrupted'
'failed to load session'
'error loading session'
'session data invalid'
```

### Session Statistics

Track conversation metrics across configuration changes:
- **Message count**: Total user + assistant messages (preserved via --resume)
- **Tool executions**: Total tool invocations (preserved via --resume)
- **Session age**: Time since session creation (preserved via --resume)

**Access via IPC**:
```typescript
const stats = await window.api.claudeCode.getSessionStats()
// Returns: {
//   messageCount: 15,
//   toolExecutions: 7,
//   createdAt: Date
// }
```

**When Stats Reset**:
- App launch or project open
- Manual "Restart Session" button
- Resume failure (automatic fallback)

**When Stats Preserved**:
- Tool authorization changes (settings save, approval dialog)
- Planning mode toggles (exploration ↔ implementation)

### Technical Implementation

**ClaudeCliService.ts** - Session ID lifecycle management:

```typescript
/**
 * Session start reason - determines session ID lifecycle and --resume usage
 */
type SessionStartReason =
  | 'initial'         // App launch - fresh session ID
  | 'manual_restart'  // User explicit restart - fresh session ID
  | 'settings'        // Tool config change - reuse session ID + --resume
  | 'planning'        // Planning mode toggle - reuse session ID + --resume
  | 'recovery'        // Crash recovery - attempt --resume, fallback if needed

async startSession(
  projectPath: string,
  planningMode: boolean = false,
  reason: SessionStartReason = 'initial'
): Promise<void> {
  // Session ID lifecycle logic
  const previousSessionId = this.sessionId
  const shouldUseResume = (reason === 'settings' || reason === 'planning') && previousSessionId

  if (reason === 'initial' || reason === 'manual_restart' || reason === 'recovery') {
    this.sessionId = this.generateSessionId()  // Fresh conversation
  } else {
    // Reuse session ID for --resume
  }

  // Build args with --resume if applicable
  const args = ['--session-id', this.sessionId!]
  if (shouldUseResume) {
    args.push('--resume', previousSessionId!)  // Preserve conversation
  }
}
```

**Resume Timeout**: 10-second timeout prevents hanging. Falls back to fresh session if --resume hangs.

**Structured Logging**: All resume attempts logged with session metadata for debugging:
```typescript
private logResumeAttempt(sessionId: string, reason: SessionStartReason): void {
  console.log('📝 RESUME ATTEMPT', JSON.stringify({
    sessionId,
    reason,
    projectPath: this.projectPath,
    planningMode: this.isPlanningMode,
    messageCount: this.sessionStats.messageCount,
    toolExecutions: this.sessionStats.toolExecutions,
    sessionAge: /* calculated in seconds */,
    timestamp: new Date().toISOString()
  }, null, 2))
}
```

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
  '--resume', previousSessionId,  // Preserve context
  '--allowedTools', ...this.approvedTools  // Updated list
])
```

**Consequence**: To add new tool, must restart session.

**Why --resume Works**:
- Claude CLI stores session state server-side
- `--resume <sessionId>` loads previous conversation history
- New `--allowedTools` list applied to resumed session
- Result: Conversation continues with new permissions

## Development Patterns

### Adding New Tool Type

**1. Add Tool Description** (`ClaudeCliService.ts:719-741`):

```typescript
private getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    Read: 'Read file contents',
    Edit: 'Modify existing file with search/replace',
    MyNewTool: 'Clear description of what MyNewTool does'
  }
  return descriptions[toolName] || `Execute ${toolName} tool`
}
```

**2. Add to ToolSettingsDialog Categories** (`ToolSettingsDialog.tsx:20-60`):

Add tool to appropriate category:
```typescript
const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'File Operations',
    tools: [
      { id: 'MyNewTool', name: 'MyNewTool', description: 'Clear description' }
    ]
  }
]
```

All tools are enabled by default. Users configure via Settings modal (Cmd/Ctrl+,).

### Testing Settings Modal

**1. Open Settings Modal**:
- Click gear icon in Copilot header
- OR press Cmd/Ctrl+, when Copilot is active

**2. Verify Default State**:
- "Enable all tools by default" checked ✓
- All 17 individual checkboxes checked and disabled (grayed out)
- Counter shows "17 of 17 selected"

**3. Test Selective Mode**:
- Uncheck "Enable all tools by default"
- Individual checkboxes become active
- Uncheck specific tool (e.g., WebFetch)
- Counter updates (e.g., "16 of 17 selected")
- Verify unsaved changes indicator appears

**4. Test Save & Restart**:
- Click "Save" button
- Verify session restarts (console: "🔄 Restarting session")
- Verify modal closes
- Control Panel shows updated tool list

**5. Verify Persistence**:
```bash
cat ~/.config/erfana/config.json
# Should show: {"approvedTools": ["Read", "Write", ...", "NotebookEdit", "ExitPlanMode"], ...}
# Missing tools: Tools unchecked in settings
```

**6. Test Approval Dialog (when tool restricted)**:
- Send message requiring restricted tool
- ToolApprovalDialog appears
- Approve with "Remember this choice"
- Tool gets added back to approved list

**7. Test Reset to Defaults**:
- Click "Reset to Defaults"
- Inline confirmation appears
- Click "Yes"
- All 17 tools re-checked
- "Enable all tools" re-checked

### Debugging Common Issues

**Dialog doesn't show**:
- Check tool not already in approved list
- Check `convertEvent()` detecting tool_use blocks
- Check `tool-approval-needed` event emitted
- Check `onToolApprovalNeeded` listener registered

**Tool blocked even after approval**:
- Check `approvedTools` Set contains tool name
- Check `--allowedTools` in spawn args includes tool
- Check session restarted (logs: "🔄 Restarting session")
- Check no typos in tool name (case-sensitive)

**Context lost after restart**:
- Check `--resume <sessionId>` flag in restart args
- Check `sessionId` not regenerated (reuse previous UUID)
- Check Claude CLI version supports --resume
- Check network connectivity (session state stored server-side)

**Auto-retry doesn't work**:
- Check `lastUserPrompt` stored in state
- Check `onSessionResumed` listener registered
- Check system message shows
- Check `sendMessage` called with `lastUserPrompt`

**Persistence doesn't work**:
- Check `remember` parameter true in `approveTool()` call
- Check `addApprovedTool()` called
- Check `config.json` file exists and writable
- Check electron-store initialized (async import)

## IPC Channels

### Tool Approval

**claudeCode:approveTool(toolName, remember)**
- Approves tool, restarts session with updated permissions
- Returns: `{success, error?}`
- Handler: `claude-code-handlers.ts:135`

**claudeCode:denyTool(toolName)**
- Denies tool, restarts session (no permission added)
- Returns: `{success, error?}`
- Handler: `claude-code-handlers.ts:149`

**claudeCode:toolApprovalNeeded** (Event)
- Emitted when unapproved tool detected
- Payload: `{toolName, toolId, input, description}`

**claudeCode:sessionResumed** (Event)
- Emitted after session restarted with new tools
- Payload: `{projectPath, approvedTools[]}`

### Settings

**settings:getApprovedTools()**
- Returns: `{success, tools?, error?}`
- Handler: `settings-handlers.ts:6`

**settings:addApprovedTool(toolName)**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:24`

**settings:removeApprovedTool(toolName)**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:33`

**settings:resetApprovedTools()**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:42`

## Components

### ToolSettingsDialog.tsx

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

**Props**:
```typescript
interface ToolSettingsDialogProps {
  onClose: () => void
  onSave: (approvedTools: string[]) => Promise<void>
}
```

**Design**:
- **Dimensions**: 600px width, max-height 85vh, centered
- **Colors**: VS Code dark (#2d2d30 background, #007acc accent)
- **Icons**: Settings (gear), AlertCircle (error) from Lucide React
- **Animations**: fadeIn 0.2s (overlay), slideUp 0.3s (dialog)
- **Scrolling**: Internal scroll for tool list, fixed header/footer

**Usage Pattern**:
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

**Keyboard Shortcut**: Cmd/Ctrl+, opens settings when Copilot panel is active

**Files**:
- `ToolSettingsDialog.tsx` (~270 lines) - Component logic
- `ToolSettingsDialog.css` (~300 lines) - Modal styling

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

**Location**: `src/renderer/src/components/ClaudeCode/CopilotChat.tsx`

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
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode, ToolApprovalDialog
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Tool approval and settings channels
- **[Security](../security.md)** - Security principles and validation
