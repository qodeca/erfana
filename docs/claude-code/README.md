# Claude Code Integration - Documentation Index

Complete documentation for Erfana's Claude Code integration with persistent session architecture and tool approval system.

## Quick Reference

**Status**: ✅ Fully implemented

**Location**: Right sidebar Copilot panel

**Key Features**:
- Persistent Claude CLI sessions (long-running process)
- Tool approval dialog for security-sensitive operations
- Auto-retry after approval (seamless UX)
- All 17 Claude Code tools enabled by default (opinionated approach for consultant workflows)
- Planning mode for safe exploration (restricts to 9 read-only tools)
- Control Panel showing all 17 tools with color-coded approval status
- Persistent permissions via electron-store

## Documentation Structure

### Core Documentation

**[Tool Approval System - Core Guide](./tool-approval-core.md)**
- Overview and philosophy (all 17 tools enabled by default)
- Tool authorization and categories
- Settings modal (ToolSettingsDialog) usage
- Approval flow and technical implementation
- Conversation preservation with --continue
- Auto-retry feature
- Persistent storage
- Critical architecture decisions

**[Tool Approval System - Advanced Guide](./tool-approval-advanced.md)**
- IPC channels and handlers
- Development patterns (adding new tools)
- Testing procedures (settings modal, approval flow, planning mode)
- Debugging common issues
- Advanced troubleshooting
- Performance optimization

**[Conversation Preservation](./conversation-preservation.md)**
- Directory-based session management
- When conversation is preserved vs reset
- Clear button functionality
- Session statistics tracking
- Technical implementation details
- Troubleshooting guide
- Migration from --resume to --continue

**[UI Features](./ui-features.md)**
- Copilot Panel
- Control Panel with tool approval status
- Planning Mode toggle
- Tool Approval Dialog
- Session indicators and UI states

### Related Documentation

**[Architecture](../architecture.md)**
- ClaudeCliService overview
- Persistent session architecture
- Service classes and OOP patterns

**[IPC Patterns](../ipc-patterns.md)**
- Session management channels
- Tool approval channels
- Settings channels
- Event-based communication

**[UI Features](./ui-features.md)** (see above)

## Quick Start

### User Flow

1. Open Copilot panel (right sidebar, labeled "Copilot")
2. Authenticate with OAuth token
3. Session starts automatically
4. Optional: Enable planning mode for read-only exploration
5. Send message to Claude Code
6. If unapproved tool needed → dialog appears
7. Approve tool (optional: remember choice)
8. System auto-retries prompt with new permissions
9. View tool usage in Control Panel

### Developer Flow

**Add New Tool Type**:
```typescript
// ClaudeCliService.ts
private getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    // ... existing tools ...
    MyNewTool: 'Description of what it does'
  }
  return descriptions[toolName] || `Execute ${toolName} tool`
}
```

**Test Approval Flow**:
```bash
# Reset to defaults
rm ~/.config/erfana/config.json

# Send message requiring unapproved tool
"Edit the file README.md"  # Requires Edit tool

# Verify dialog shows, approve, check persistence
cat ~/.config/erfana/config.json
```

## Architecture Summary

### Persistent Session Architecture

**Why Persistent?**
- Context preservation (conversation history)
- Performance (no spawn overhead per message)
- Session resumption via --continue flag

**Lifecycle**:
1. Project opens → session starts
2. User authenticated → session ready
3. Messages exchanged via JSONL stdin/stdout
4. Tool approval → session restarts with --continue + updated --allowedTools
5. Project closes → session stops

### Critical Design Decision

**--allowedTools is immutable**: Claude CLI reads tool permissions at spawn and cannot change mid-session.

**Consequence**: Must restart session to add tools, use --continue to preserve context.

**Code Pattern**:
```typescript
// Initial start
spawn('claude', ['-p', projectPath, '--allowedTools', ...approved])

// After approval: Must restart
spawn('claude', ['-p', projectPath, '--continue', '--allowedTools', ...updatedApproved])
```

## Key Components

### Main Process

**ClaudeCliService.ts** (`src/main/services/ClaudeCliService.ts`)
- Manages persistent CLI sessions
- Detects unapproved tools in message stream
- Handles session restart with --continue
- EventEmitter for lifecycle events

**SettingsService.ts** (`src/main/services/SettingsService.ts`)
- Persists approved tools via electron-store
- Methods: get, set, add, remove, reset

### IPC Handlers

**claude-code-handlers.ts** (`src/main/ipc/claude-code-handlers.ts`)
- Session management: start, stop, sendMessage
- Tool approval: approveTool, denyTool
- Events: sessionStarted, sessionResumed, toolApprovalNeeded

**settings-handlers.ts** (`src/main/ipc/settings-handlers.ts`)
- Settings management: getApprovedTools, setApprovedTools, etc.

### Renderer Components

**CopilotPanel.tsx** (`src/renderer/src/components/Panels/CopilotPanel.tsx`)
- Right sidebar panel
- Installation check and auth flow
- Session state indicators
- Hosts CopilotChat

**CopilotChat.tsx** (`src/renderer/src/components/Copilot/CopilotChat.tsx`)
- Chat interface with message history
- Tracks lastUserPrompt for auto-retry
- Listens for tool approval requests
- Auto-retries after session resumed

**ToolApprovalDialog.tsx** (`src/renderer/src/components/Dialogs/ToolApprovalDialog.tsx`)
- Modal dialog for tool approval
- Shows tool name, description, parameters
- "Remember this choice" checkbox
- Approve/Deny actions

## Common Tasks

### Check Approved Tools

```typescript
// Via settings service
const tools = await settingsService.getApprovedTools()
console.log(tools)  // All 17 tools by default: Read, Write, Edit, MultiEdit, Glob, Grep, Bash, LS, WebSearch, WebFetch, SlashCommand, TodoRead, TodoWrite, Task, NotebookRead, NotebookEdit, ExitPlanMode

// Via IPC
const result = await window.api.settings.getApprovedTools()
console.log(result.tools)  // All 17 Claude Code tools (enabled by default)
```

### Reset to Safe Defaults

```bash
rm ~/.config/erfana/config.json
# Or programmatically:
await settingsService.resetApprovedTools()
```

### Debug Session Issues

**Main process output** (terminal):
```
🚀 Starting persistent Claude CLI session
🔧 Approved tools: Read, Glob, Grep, Write
📨 Message: user Hello
⚠️ Tool Edit requires approval
🔄 Restarting session with updated permissions
```

**Renderer output** (DevTools):
```
📨 Received message: user Hello...
⚠️ Tool approval needed: Edit
✅ Session resumed with tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit']
```

**Claude CLI logs**:
```bash
ls ~/.claude/logs/
cat ~/.claude/logs/claude-cli-<date>.log
```

## Known Issues

- **Session restart timing**: Brief delay after approval (intentional, allows initialization)
- **Stop generation**: Not supported in persistent mode (would require full restart)
- **Network file systems**: Claude CLI may have issues with NFS/SMB projects (use local only)

## Related Documentation

- **[Tool Approval Core](./tool-approval-core.md)** - Core guide to tool approval system
- **[Tool Approval Advanced](./tool-approval-advanced.md)** - Advanced topics, IPC, testing, troubleshooting
- **[Conversation Preservation](./conversation-preservation.md)** - Directory-based session preservation with --continue
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode, Tool Approval Dialog
- **[Architecture](../architecture.md)** - Three-process model, services
- **[IPC Patterns](../ipc-patterns.md)** - All IPC channels
- **[Security](../security.md)** - Security principles
- **[Development Tasks](../development-tasks.md)** - Common patterns
