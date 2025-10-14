# Tool Approval System

Complete guide to Erfana's tool approval system for Claude Code integration.

## Overview

**Problem**: Claude Code has access to dangerous tools (Write, Edit, Bash) that can modify files or execute commands without user knowledge.

**Solution**: User approval required before first execution of non-safe tools via modal dialog.

**Key Features**:
- Modal approval dialog with tool details
- Safe defaults (Read, Glob, Grep always approved)
- "Remember this choice" for persistent permissions
- Auto-retry after approval (seamless UX)
- Session restart with --resume to update permissions
- Persistent storage via electron-store

## Security Model

### Pre-Approved Tools (No Approval Needed)

These tools are pre-approved by default for seamless workflow (10 total):

- **Read** - Read file contents (safe, read-only)
- **Write** - Create or overwrite files (common operation)
- **Edit** - Modify existing files with search/replace (common operation)
- **Glob** - Find files by pattern (safe, read-only)
- **Grep** - Search file contents with regex (safe, read-only)
- **Bash** - Execute shell commands (essential for development)
- **LS** - List directory contents (safe, read-only)
- **WebSearch** - Search the web (read-only, network access)
- **TodoWrite** - Task management and tracking (safe, planning aid)
- **Task** - Launch agent tasks for complex operations (common, autonomous work)

**Rationale**: These 10 tools cover 95%+ of common Claude Code operations. Pre-approving them provides seamless UX while maintaining security through persistent session architecture and user visibility of all tool executions.

### Tools Requiring Approval

These tools require explicit user approval on first use (7 total):

- **MultiEdit** - Batch edit multiple files (complex, wide-reaching modifications)
- **WebFetch** - Fetch web content (network access, potential security risk)
- **SlashCommand** - Execute custom slash commands (user-defined, unpredictable)
- **TodoRead** - Read Claude's todo list (access to AI planning data)
- **NotebookRead** - Read Jupyter notebooks (file access)
- **NotebookEdit** - Edit Jupyter notebooks (file modifications)
- **ExitPlanMode** - Exit planning mode (permission escalation)

**Rationale**: These operations are less common, more complex, or have higher security implications requiring explicit user consent. Total tools: 10 pre-approved + 7 requiring approval = 17 Claude Code tools.

### Planning Mode

**Native Claude CLI feature** that restricts Claude to read-only tools for safe exploration and planning:

**Activation**: Toggle button in chat interface, uses `--permission-mode plan` flag

**Tool Restrictions in Planning Mode** (6 tools):
- Read, LS, Grep, Task, WebSearch, TodoWrite

**Blocked in Planning Mode**:
- All write operations: Write, Edit, MultiEdit, NotebookEdit
- Command execution: Bash
- Other tools requiring approval: WebFetch, SlashCommand, TodoRead, NotebookRead, ExitPlanMode

**Use Cases**: Code exploration, architecture planning, research, cost estimation, learning existing codebases

**Implementation**: ClaudeCliService.ts:85-95 defines tool set, session restart with `--permission-mode plan`, Control Panel shows restricted tools, system message confirms mode change

**Visual Indicators**: Toggle button (blue when active), system message, Control Panel displays only 6 tools

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
// Returns approved tools list, defaults to pre-approved tools:
// ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'LS', 'WebSearch', 'TodoWrite', 'Task']

async setApprovedTools(tools: string[]): Promise<void>
// Replaces entire approved tools list

async addApprovedTool(toolName: string): Promise<void>
// Adds single tool to list (idempotent)

async removeApprovedTool(toolName: string): Promise<void>
// Removes single tool from list

async resetApprovedTools(): Promise<void>
// Resets to pre-approved defaults
```

### Storage Location

**Path**: `~/.config/erfana/config.json` (electron-store default on macOS)

**Data Structure**:
```json
{
  "approvedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "LS", "WebSearch", "TodoWrite", "Task"],
  "lastProjectPath": "/Users/user/Projects/my-project"
}
```

**Note**: The 10 pre-approved tools (Read, Write, Edit, Glob, Grep, Bash, LS, WebSearch, TodoWrite, Task) are always included via merge logic in `ClaudeCliService.ts:148-153`, even if not in config file. User-approved tools (e.g., MultiEdit, WebFetch) are added to this list when approved with "Remember this choice".

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

**2. Decide if Pre-Approved by Default** (`SettingsService.ts:47`, `ClaudeCliService.ts:85`):

Add to pre-approved list if:
- Common operation (>80% of Claude Code sessions need it)
- Transparent to user (all executions logged in chat)
- Recoverable via git (file modifications can be reverted)

Current pre-approved tools reflect balance between UX and security.

### Testing Approval Flow

**1. Reset to Safe Defaults**:
```bash
rm ~/.config/erfana/config.json
```

**2. Send Message Requiring Unapproved Tool**:
- "Edit the file README.md" → Requires Edit
- "Run npm install" → Requires Bash
- "Create a new file test.js" → Requires Write

**3. Verify Dialog Appears**:
- Tool name correct
- Description helpful
- Parameters visible (collapsible)

**4. Approve with "Remember this choice"**:
- Click Approve
- Verify session restarts (console: "🔄 Restarting session")
- Verify auto-retry (console: "🔄 Retrying with approved tools")
- Verify tool executes successfully

**5. Verify Persistence**:
```bash
cat ~/.config/erfana/config.json
# Should show: {"approvedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "LS", "WebSearch", "TodoWrite", "Task", "<YourApprovedTool>"], ...}
# Note: The 10 pre-approved tools always appear, plus any additional user-approved tools
```

**6. Verify Survives Restart**:
- Close Erfana
- Reopen Erfana
- Send same message
- Should NOT show approval dialog

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
