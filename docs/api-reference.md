# API Reference

**Location:** `src/main/services/`

Comprehensive API documentation for Erfana's main process service classes.

## Overview

This document covers the primary ClaudeCliService API. For documentation on supporting services (Terminal, File Watching, File Operations, Settings), see [API Services](./api-services.md).

## ClaudeCliService

**File:** `src/main/services/ClaudeCliService.ts` (~1200 lines)

Manages persistent Claude CLI sessions with JSONL I/O, tool approval, and conversation preservation.

### Public Methods

#### `isClaudeInstalled(): Promise<boolean>`
Check if Claude CLI is installed on the system.

**Returns:** Promise resolving to true if `claude` binary is found in PATH.

**Example:**
```typescript
const installed = await claudeCliService.isClaudeInstalled()
if (!installed) {
  console.log('Please install: brew install claude')
}
```

---

#### `checkAuthStatus(): Promise<{isAuthenticated: boolean; username?: string; error?: string}>`
Check Claude CLI authentication status.

**Returns:** Authentication status object.

**Note:** Currently trusts system configuration (`~/.claude/`) without explicit verification.

---

#### `startSession(projectPath: string, planningMode?: boolean, skipContinue?: boolean): Promise<void>`
Start persistent Claude CLI session.

**Parameters:**
- `projectPath` - Absolute path to project directory
- `planningMode` - If true, restricts to 9 read-only tools (default: false)
- `skipContinue` - If true, starts fresh conversation without --continue flag (default: false)

**Throws:** Error if spawn fails or authentication errors occur.

**Events Emitted:**
- `session-started` - Session successfully started
- `error` - Session start failed

**Example:**
```typescript
await claudeCliService.startSession('/path/to/project', false, false)
// Session now ready, emits 'session-started' event
```

**Flags Used:**
```bash
claude -p /path/to/project \
  --continue \  # (unless skipContinue=true)
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --replay-user-messages \
  --include-partial-messages \
  --allowedTools Read Write Edit ... \  # All approved tools
  --permission-mode plan  # (if planningMode=true)
```

---

#### `sendMessage(prompt: string, context?: Partial<ClaudeMessageContext>): void`
Send message to running Claude CLI session via JSONL stdin.

**Parameters:**
- `prompt` - User message text
- `context` - Optional context (projectPath, currentFile, selectedText)

**Throws:** Error if session not ready.

**Events Emitted:**
- `message` - For each response message
- `message-update` - For streaming token deltas
- `message-complete` - When response finishes
- `tool-approval-needed` - When unapproved tool requested

**Example:**
```typescript
claudeCliService.sendMessage('Explain this file', {
  currentFile: '/path/to/file.ts',
  selectedText: 'const foo = bar'
})
```

---

#### `approveTool(toolName: string): Promise<void>`
Approve tool and restart session with updated permissions.

**Parameters:**
- `toolName` - Tool to approve (e.g., 'Write', 'Bash', 'Edit')

**Side Effects:**
- Adds tool to approved set
- Persists to settings via electron-store
- Restarts session with --continue flag

**Events Emitted:**
- `session-resumed` - After restart with new permissions

**Example:**
```typescript
await claudeCliService.approveTool('Write')
// Session restarts with Write tool enabled
```

---

#### `denyTool(toolName: string): Promise<void>`
Deny tool use and restart session (allows Claude to try alternative approach).

**Parameters:**
- `toolName` - Tool to deny

**Side Effects:**
- Does NOT add to approved tools
- Restarts session with --continue flag

---

#### `stopSession(): Promise<void>`
Stop current Claude CLI session gracefully.

**Returns:** Promise resolving when process exits.

**Side Effects:**
- Sends SIGTERM to process
- Force kills after 2 seconds if needed
- Clears session state

**Events Emitted:**
- `session-stopped` - When process exits

---

#### `clearSessionHistory(): Promise<void>`
Delete all JSONL conversation files for current project.

**Side Effects:**
- Deletes `~/.claude/projects/[encoded-path]/*.jsonl`
- Makes next `--continue` start fresh

**Throws:** Error if deletion fails (except ENOENT).

**Example:**
```typescript
await claudeCliService.clearSessionHistory()
// Next session start will have no prior conversation
```

---

#### `getSessionState(): SessionState`
Get current session state.

**Returns:** `'stopped' | 'starting' | 'ready' | 'error'`

---

#### `getSessionStats(): SessionStats`
Get session statistics.

**Returns:**
```typescript
{
  messageCount: number      // Total user + assistant messages
  toolExecutions: number    // Total tool executions
  createdAt: Date          // Session creation timestamp
}
```

---

#### `getMessageCount(): number`
Convenience method for message count.

**Returns:** Total messages in session.

---

#### `setOAuthToken(token: string): void`
Set OAuth token (bypasses authentication check).

**Parameters:**
- `token` - OAuth token (currently unused, just sets bypass flag)

**Note:** This method primarily exists for UI integration. Authentication is trusted from `~/.claude/`.

---

### Events

ClaudeCliService extends EventEmitter and emits the following events:

#### `'session-started'`
**Payload:** `{ projectPath: string }`

Emitted when session successfully starts.

---

#### `'session-stopped'`
**Payload:** none

Emitted when session stops (manual or after crash recovery fails).

---

#### `'session-resumed'`
**Payload:** `{ projectPath: string; approvedTools: string[] }`

Emitted after session restarts with new tool permissions.

---

#### `'session-restarting'`
**Payload:** `{ attempt: number; maxAttempts: number }`

Emitted during crash recovery attempts.

---

#### `'message'`
**Payload:** `ClaudeMessage`

Emitted for each message (user, assistant, tool_use, tool_result, system, error).

**Message Types:**
- `user` - User message (replayed by --replay-user-messages)
- `assistant` - Assistant response
- `tool_use` - Tool execution started
- `tool_result` - Tool execution result
- `system` - System message (e.g., "✓ Complete")
- `error` - Error message

---

#### `'message-update'`
**Payload:** `ClaudeMessage` (with partial content)

Emitted during token streaming (--include-partial-messages).

---

#### `'message-complete'`
**Payload:** `ClaudeMessage` (with final content + cumulative tokens)

Emitted when streaming message finishes.

---

#### `'tool-approval-needed'`
**Payload:** `{ toolName: string; toolId: string; input: any; description: string }`

Emitted when Claude requests unapproved tool.

---

#### `'error'`
**Payload:** `{ message: string; recoverable: boolean }`

Emitted on errors (authentication, spawn failures, etc.).

---

### Interfaces

#### `ClaudeMessage`
```typescript
interface ClaudeMessage {
  id: string
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'error'
  content: string
  metadata?: any
  timestamp: Date
}
```

#### `ClaudeMessageContext`
```typescript
interface ClaudeMessageContext {
  workingDirectory?: string
  currentFile?: string
  selectedText?: string
  projectPath?: string
}
```

#### `SessionStats`
```typescript
interface SessionStats {
  messageCount: number      // Total user + assistant messages
  toolExecutions: number    // Total tool executions
  createdAt: Date          // Session creation timestamp
}
```

---

### Constants

#### `ALL_CLAUDE_TOOLS` (17 total)
All available Claude Code tools:
- **File Operations** (7): Read, Write, Edit, MultiEdit, Glob, Grep, LS
- **System** (1): Bash
- **AI & Web** (3): WebSearch, WebFetch, Task
- **Workflow** (4): TodoRead, TodoWrite, SlashCommand, ExitPlanMode
- **Notebooks** (2): NotebookRead, NotebookEdit

#### `PLANNING_MODE_TOOLS` (9 total)
Read-only tools allowed in planning mode:
- Read, LS, Glob, Grep, Task, WebSearch, TodoRead, TodoWrite, NotebookRead

---

## Usage Example

### Starting Claude Session with Event Handling

```typescript
import { claudeCliService } from './services/ClaudeCliService'

// Listen for events
claudeCliService.on('session-started', ({ projectPath }) => {
  console.log('Session started for:', projectPath)
})

claudeCliService.on('message', (message) => {
  if (message.type === 'assistant') {
    console.log('Assistant:', message.content)
  }
})

claudeCliService.on('tool-approval-needed', async ({ toolName, description }) => {
  // Show approval dialog to user
  const approved = await showApprovalDialog(toolName, description)

  if (approved) {
    await claudeCliService.approveTool(toolName)
  } else {
    await claudeCliService.denyTool(toolName)
  }
})

// Start session
await claudeCliService.startSession('/path/to/project')

// Send message
claudeCliService.sendMessage('Help me refactor this code')
```

## See Also

- [API Services](./api-services.md) - Supporting services (Terminal, File Operations, Watchers, Settings)
- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Claude Code Integration](./claude-code/README.md) - ClaudeCliService usage patterns
- [Terminal](./terminal.md) - Terminal panel implementation
- [File Watching](./file-watching.md) - Auto-refresh implementation
