# API Reference

**Location:** `src/main/services/`

Comprehensive API documentation for Erfana's main process service classes.

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

## TerminalService

**File:** `src/main/services/TerminalService.ts` (~260 lines)

Manages terminal emulator instances with xterm.js + node-pty.

### Public Methods

#### `createTerminal(id: string, cwd: string, cols: number, rows: number): Promise<void>`
Create new PTY instance.

**Parameters:**
- `id` - Unique terminal identifier
- `cwd` - Working directory for terminal
- `cols` - Terminal columns (width)
- `rows` - Terminal rows (height)

**Throws:** Error if terminal with ID already exists.

**Side Effects:**
- Spawns new PTY process (zsh shell)
- Emits 'data' events for output

---

#### `writeToTerminal(id: string, data: string): void`
Write data to terminal stdin.

**Parameters:**
- `id` - Terminal identifier
- `data` - Data to write (e.g., user input)

**Throws:** Error if terminal not found.

---

#### `resizeTerminal(id: string, cols: number, rows: number): void`
Resize PTY dimensions.

**Parameters:**
- `id` - Terminal identifier
- `cols` - New column count
- `rows` - New row count

**Throws:** Error if terminal not found.

---

#### `killTerminal(id: string): Promise<void>`
Gracefully kill PTY process.

**Parameters:**
- `id` - Terminal identifier

**Side Effects:**
- Removes terminal from internal map
- Kills PTY process

**Events Emitted:**
- `exit` - When process exits

---

### Events

#### `'data'`
**Payload:** `{ id: string; data: string }`

Emitted when PTY produces output.

---

#### `'exit'`
**Payload:** `{ id: string; code: number }`

Emitted when PTY process exits.

---

## FileWatcherService

**File:** `src/main/services/FileWatcherService.ts`

Watches file content for external changes with auto-reload and conflict detection.

### Public Methods

#### `watchFile(filePath: string): void`
Start watching file for changes.

**Parameters:**
- `filePath` - Absolute path to file

**Side Effects:**
- Creates chokidar watcher (300ms debounce)
- Emits 'file-changed' events

---

#### `unwatchFile(filePath: string): void`
Stop watching file.

**Parameters:**
- `filePath` - Absolute path to file

---

#### `pauseWatching(filePath: string): void`
Temporarily pause watching (used during save operations).

**Parameters:**
- `filePath` - Absolute path to file

---

#### `resumeWatching(filePath: string): void`
Resume watching after pause.

**Parameters:**
- `filePath` - Absolute path to file

---

### Events

#### `'file-changed'`
**Payload:** `{ filePath: string }`

Emitted when file changes externally (after 300ms debounce).

**Note:** Not emitted during pause window.

---

#### `'file-deleted'`
**Payload:** `{ filePath: string }`

Emitted when watched file is deleted.

---

## DirectoryWatcherService

**File:** `src/main/services/DirectoryWatcherService.ts`

Watches directory tree for changes with auto-refresh and pause/resume pattern.

### Public Methods

#### `watchDirectory(dirPath: string): void`
Start watching directory recursively.

**Parameters:**
- `dirPath` - Absolute path to directory

**Side Effects:**
- Creates chokidar watcher (1000ms debounce)
- Ignores: `node_modules`, `.git`, `.next`, `dist`, `build`, `.DS_Store`

---

#### `unwatchDirectory(dirPath: string): void`
Stop watching directory.

**Parameters:**
- `dirPath` - Absolute path to directory

---

#### `pauseWatching(dirPath: string): void`
Pause watching (used during CRUD operations).

**Parameters:**
- `dirPath` - Absolute path to directory

**Usage Pattern:**
```typescript
// Before internal operation
await directoryWatcherService.pauseWatching(projectPath)

// Perform CRUD
await fs.writeFile(newFilePath, content)

// After operation
await directoryWatcherService.resumeWatching(projectPath)
```

---

#### `resumeWatching(dirPath: string): void`
Resume watching after pause.

**Parameters:**
- `dirPath` - Absolute path to directory

---

### Events

#### `'directory-changed'`
**Payload:** `{ dirPath: string; changeType: string; filePath?: string }`

Emitted when directory changes (after 1000ms debounce).

**Change Types:** `'add'`, `'unlink'`, `'addDir'`, `'unlinkDir'`

**Note:** Not emitted during pause window.

---

## FileService

**File:** `src/main/services/FileService.ts`

File operations with validation and error handling.

### Public Methods

#### `readFile(filePath: string): Promise<string>`
Read file contents.

**Parameters:**
- `filePath` - Absolute path to file

**Returns:** File contents as UTF-8 string.

**Throws:** Error if file not found or read fails.

---

#### `writeFile(filePath: string, content: string): Promise<void>`
Write file contents.

**Parameters:**
- `filePath` - Absolute path to file
- `content` - File contents

**Throws:** Error if write fails.

---

#### `createFile(dirPath: string, fileName: string): Promise<string>`
Create new empty file.

**Parameters:**
- `dirPath` - Directory path
- `fileName` - File name

**Returns:** Full path to created file.

**Throws:** Error if file exists or creation fails.

---

#### `deleteFile(filePath: string): Promise<void>`
Delete file.

**Parameters:**
- `filePath` - Absolute path to file

**Throws:** Error if deletion fails.

---

#### `renameFile(oldPath: string, newPath: string): Promise<void>`
Rename/move file.

**Parameters:**
- `oldPath` - Current file path
- `newPath` - New file path

**Throws:** Error if file exists at newPath or rename fails.

---

## SettingsService

**File:** `src/main/services/SettingsService.ts`

Persistent settings storage using electron-store.

**Important:** All methods are async due to dynamic ES Module import.

### Public Methods

#### `getLastProjectPath(): Promise<string | null>`
Get last opened project path.

**Returns:** Project path or null.

---

#### `setLastProjectPath(path: string): Promise<void>`
Save last opened project path.

**Parameters:**
- `path` - Project directory path

---

#### `clearLastProjectPath(): Promise<void>`
Clear last project path.

---

#### `getApprovedTools(): Promise<string[]>`
Get approved Claude Code tools.

**Returns:** Array of tool names (defaults to all 17 tools).

---

#### `setApprovedTools(tools: string[]): Promise<void>`
Set approved tools.

**Parameters:**
- `tools` - Array of tool names

---

#### `addApprovedTool(toolName: string): Promise<void>`
Add single tool to approved list.

**Parameters:**
- `toolName` - Tool to add

---

#### `removeApprovedTool(toolName: string): Promise<void>`
Remove single tool from approved list.

**Parameters:**
- `toolName` - Tool to remove

---

#### `resetApprovedTools(): Promise<void>`
Reset to default (all 17 tools).

---

## Usage Examples

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

### Terminal Management

```typescript
import { terminalService } from './services/TerminalService'

// Create terminal
await terminalService.createTerminal('main', '/path/to/project', 80, 24)

// Listen for output
terminalService.on('data', ({ id, data }) => {
  console.log(`Terminal ${id}:`, data)
})

// Write input
terminalService.writeToTerminal('main', 'ls -la\n')

// Resize
terminalService.resizeTerminal('main', 100, 30)

// Clean up
await terminalService.killTerminal('main')
```

### File Watching with Pause/Resume

```typescript
import { directoryWatcherService } from './services/DirectoryWatcherService'

// Start watching
directoryWatcherService.watchDirectory('/path/to/project')

// Listen for changes
directoryWatcherService.on('directory-changed', ({ dirPath, changeType, filePath }) => {
  console.log(`${changeType}: ${filePath}`)
  refreshProjectTree()
})

// Internal operation pattern
async function createNewFile(fileName: string) {
  // Pause watching
  await directoryWatcherService.pauseWatching(projectPath)

  // Perform operation
  await fs.writeFile(path.join(projectPath, fileName), '')

  // Refresh UI
  await refreshProjectTree()

  // Resume watching
  await directoryWatcherService.resumeWatching(projectPath)

  // No duplicate refresh event
}
```

## See Also

- [Architecture](./architecture.md) - Service class overview
- [IPC Patterns](./ipc-patterns.md) - IPC handler integration
- [Claude Code Integration](./claude-code/README.md) - ClaudeCliService usage
- [Terminal](./terminal.md) - Terminal panel implementation
- [File Watching](./file-watching.md) - Auto-refresh implementation
