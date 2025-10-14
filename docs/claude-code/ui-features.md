# Claude Code UI Features

Complete UI documentation for Erfana's Copilot panel and related Claude Code interface components.

## Copilot Panel

**Location**: `src/renderer/src/components/Panels/CopilotPanel.tsx`, `Copilot/CopilotChat.tsx`

Right sidebar panel for Claude Code integration via persistent CLI session. The panel header shows "Copilot" with a status indicator dot on the left.

### Header Design

- **Status Dot**: Color-coded indicator (left-most position)
  - 🟢 Green: Session ready
  - 🟡 Yellow: Session starting
  - 🔴 Red: Session error
- **Bot Icon**: 16px Robot icon with 8px spacing from status dot
- **Label**: "Copilot" (displayed in panel header)

**Layout**: `[● ] 🤖 Copilot` (status dot, spacing, icon, label)

### Core Features

- **Installation Check**: Detects Claude CLI presence, shows install guide if missing
- **Authentication**: OAuth token setup with visual flow
- **Persistent Session**: Long-running Claude CLI process maintains conversation context
- **Session State Indicators**: Visual dots communicate session health
- **Chat Interface**: Message history with user/assistant/tool_use/tool_result messages
- **Planning Mode Toggle**: Button to switch between full access and read-only planning mode
- **Control Panel**: Collapsible panel showing session stats and tool approval status
- **Stop Generation**: Stop button during active generation (Escape key)
- **Auto-restart**: Exponential backoff recovery (max 3 attempts) on crashes

### Session Lifecycle

1. User authenticates via OAuth token
2. Session starts automatically when authenticated
3. Claude CLI spawns in project directory context
4. Process runs until project closes or user stops session
5. Messages exchanged via JSONL stdin/stdout streaming

### UI States

**Loading**:
- Spinner with "Checking Claude CLI status..."
- Shown during initial installation check

**Not Installed**:
- Download icon with installation guide
- Homebrew command for macOS: `brew install anthropics/tap/claude`
- Link to official installation docs
- "Check Again" button to re-verify installation

**Not Authenticated**:
- Login icon with OAuth token input form
- Masked password field for token entry
- "Connect" button to authenticate
- Instructions: Run `claude setup-token` in terminal
- Note about Claude MAX subscription requirement

**Starting**:
- Spinner with "Starting Claude session..."
- Shows restart attempt count if recovering from crash
- Yellow status dot in header

**Ready**:
- Full chat interface visible
- Green status dot in header
- Input field enabled
- Planning mode toggle available

**Error**:
- Error icon with error message
- "Restart Session" button
- Red status dot in header
- Suggestions for common fixes

### Components

**CopilotPanel.tsx** (330 lines):
- Session lifecycle management
- Installation and authentication flows
- State indicators and UI state switching
- Hosts CopilotChat component when ready

**CopilotChat.tsx** (689 lines):
- Chat interface with message history display
- Input textarea with auto-resize
- Planning mode toggle button
- Control Panel component
- Tool approval dialog integration
- Message streaming and partial updates
- Auto-retry after tool approval

**TerminalMessage.tsx** (435 lines):
- Individual message rendering for all message types
- Tool execution display with formatted parameters
- Collapsible tool results for long outputs
- Session lifecycle event styling
- Streaming indicators and typing cursor
- React.memo optimization

### Implementation

**Service**: `src/main/services/ClaudeCliService.ts` - Persistent session architecture with planning mode support

**IPC**: `src/main/ipc/claude-code-handlers.ts` - Session lifecycle and tool approval handlers

See: [IPC Patterns](../ipc-patterns.md) | [Architecture](../architecture.md) | [Claude Code Integration](./README.md)

## Control Panel

**Location**: Within `CopilotChat.tsx`

Collapsible panel at the top of the chat interface showing session statistics and tool approval status.

### Features

- **Collapsed by Default**: Saves vertical space, user can expand when needed
- **Session Statistics** (always visible when expanded):
  - **Messages**: Count of user + assistant messages (shows 0 when empty)
  - **Tools Used**: Count of tool executions (shows 0 when empty)
  - **Duration**: Session runtime in minutes (only shown after session starts)
- **Available Tools Section**:
  - Lists all 17 Claude Code tools
  - Color coding: Blue (approved), Gray (not approved)
  - Hover tooltips explain approval status
  - Updates dynamically when tools are approved

### Design

**Header**:
- "Control Panel" text (left-aligned)
- Chevron icon (right-aligned, points down when expanded, left when collapsed)
- Click anywhere on header to toggle expansion
- Hover effect: slight background color change

**Content** (when expanded):
- Session stats grid (responsive, 120px min column width)
- Tools section with wrapping chip layout
- Separator line between sections
- Compact spacing optimized for information density

**Styling**:
- Background: `#252525`
- Border: 1px solid `rgba(255, 255, 255, 0.1)`
- Chips: 11px font, 4px/8px padding, border-radius 0
- Approved tool chips: Blue (`#4fc1ff`) background and border
- Not-approved chips: Gray (`#858585`) text, subtle border

### Tool Approval Status Display

**All 17 Claude Code Tools**:

**File Operations**: Read, Write, Edit, MultiEdit, NotebookRead, NotebookEdit
**Search & Navigation**: Glob, Grep, LS
**Command Execution**: Bash
**Web & Planning**: WebSearch, WebFetch, SlashCommand
**Task Management**: TodoRead, TodoWrite, Task
**Special**: ExitPlanMode

**Pre-Approved Tools** (shown in blue by default):
Read, Write, Edit, Glob, Grep, Bash, LS, WebSearch, TodoWrite, Task

**Requires Approval** (shown in gray until user approves):
MultiEdit, WebFetch, SlashCommand, TodoRead, NotebookRead, NotebookEdit, ExitPlanMode

**Note**: In planning mode, only read-only tools (Read, LS, Grep, Task, WebSearch, TodoWrite) are available regardless of approval status.

### User Interaction

**Expand/Collapse**:
- Click header to toggle
- Smooth slide-down animation (200ms)
- State not persisted (resets to collapsed on panel reopen)

**Tool Chips**:
- Hover shows approval status tooltip
- Not interactive (approval happens via tool approval dialog)
- Real-time updates when new tools approved

## Planning Mode Toggle

**Location**: Message input toolbar in `CopilotChat.tsx`

Toggle button that switches Claude CLI between full access mode and read-only planning mode.

### Features

- **Icon**: ListChecks icon from Lucide React (14px)
- **States**:
  - **Inactive** (black button): Full access to approved tools
  - **Active** (blue button): Planning mode enabled (read-only tools only)
- **Behavior**: Restarts Claude CLI session with `--permission-mode plan` flag
- **Disabled During**: Active message generation
- **Keyboard**: No dedicated shortcut (click only)

### Tool Restrictions in Planning Mode

When planning mode is enabled:
- **Allowed**: Read, LS, Grep, Task, WebSearch, TodoWrite
- **Blocked**: Write, Edit, Bash, and all other modification tools
- **Purpose**: Safe exploration, analysis, and planning without file modifications

### System Messages

When toggling planning mode, system message appears in chat:
- **Enabled**: "📋 Planning mode enabled: Claude will use read-only tools..."
- **Disabled**: "🔧 Planning mode disabled: Claude has full access to approved tools"

### Implementation

**Toggle Handler** (`CopilotChat.tsx:425-473`):
```typescript
const handlePlanningModeToggle = async () => {
  const newPlanningMode = !isPlanningMode
  setIsPlanningMode(newPlanningMode)

  await window.api.claudeCode.stopSession()
  await window.api.claudeCode.startSession(projectPath, newPlanningMode)
}
```

**Session Restart**:
- Stops current session
- Starts new session with planning mode flag
- Preserves conversation context (future enhancement)
- Updates Control Panel to show restricted tool set

## Tool Approval Dialog

**Location**: `src/renderer/src/components/Dialogs/ToolApprovalDialog.tsx`

Modal dialog for approving or denying Claude Code tool execution. Appears when Claude attempts to use a tool requiring user approval.

### Features

- **Tool Information**:
  - Tool name (monospace font, blue color)
  - Human-readable description
  - Collapsible parameters section (JSON pretty-print)
- **User Actions**:
  - Approve button (green, Check icon)
  - Deny button (red, X icon)
  - "Remember this choice" checkbox for persistent approval
- **Design**:
  - 500px width, centered modal
  - VS Code dark theme styling
  - Semi-transparent overlay prevents interaction with app
  - Animations: fadeIn (overlay), slideUp (dialog)

### Approval Flow

1. Claude attempts to use unapproved tool (e.g., Task, WebFetch, SlashCommand)
2. ClaudeCliService detects tool in message stream
3. Dialog appears with tool details
4. User reviews parameters and description
5. User approves (optionally with "remember")
6. Session restarts with updated `--allowedTools` flag
7. System auto-retries last user prompt
8. Tool executes successfully

### Design Specifications

**Dimensions**:
- Width: 500px
- Max height: 80vh
- Centered horizontally and vertically

**Colors** (VS Code Dark Theme):
- Background: `#2d2d30`
- Tool name: `#4fc1ff`
- Text: `#cccccc`
- Buttons: Green (`#5cb85c`), Red (`#f48771`)
- Overlay: `rgba(0, 0, 0, 0.6)`

**Icons** (Lucide React):
- AlertTriangle (warning, yellow)
- Check (approve action)
- X (deny action)

**Animations**:
- Overlay fadeIn: 200ms ease
- Dialog slideUp: 300ms ease-out
- Parameter collapse: 200ms ease

### Props Interface

```typescript
interface ToolApprovalRequest {
  toolName: string      // e.g., "Task", "WebFetch", "SlashCommand"
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

### Implementation

**Component Files**:
- `ToolApprovalDialog.tsx` (110 lines) - Component logic
- `ToolApprovalDialog.css` (239 lines) - VS Code-themed styling

**Usage Pattern** (`CopilotChat.tsx`):
```typescript
const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)

useEffect(() => {
  const unsubscribe = window.api.claudeCode.onToolApprovalNeeded((request) => {
    setPendingApproval(request)
  })
  return unsubscribe
}, [])

{pendingApproval && (
  <ToolApprovalDialog
    request={pendingApproval}
    onApprove={handleToolApprove}
    onDeny={handleToolDeny}
  />
)}
```

See: [Tool Approval System](./tool-approval.md) for complete documentation including security model, auto-retry, persistence, and debugging. Also see: [Conversation Preservation](./conversation-preservation.md) for details on how conversation context is maintained across tool approvals.

## Related Documentation

- **[Tool Approval System](./tool-approval.md)** - Complete approval system documentation
- **[Conversation Preservation](./conversation-preservation.md)** - Session preservation and resume handling
- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[IPC Patterns](../ipc-patterns.md)** - Session management and tool approval channels
- **[UI Components](../ui-components.md)** - Activity bars, keyboard shortcuts, panel system
- **[Architecture](../architecture.md)** - Three-process model, service classes
