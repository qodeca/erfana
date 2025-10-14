# Conversation Preservation

Complete guide to Erfana's conversation preservation system for seamless Claude Code workflow.

## Overview

**Problem**: Traditional session restarts lose conversation context, forcing users to repeat context or abandon ongoing discussions when changing tool permissions or toggling modes.

**Solution**: Erfana preserves conversation history across configuration changes using Claude CLI's `--continue` flag, maintaining context while updating permissions.

**Key Innovation**: Directory-based session management - one project directory = one conversation thread, automatically resumed without session ID tracking.

## How It Works

### Directory-Based Sessions

Claude CLI stores conversation history in `~/.claude/projects/` organized by project directory path:

```bash
~/.claude/projects/
└── Users_marcinobel_Projects_erfana/
    ├── conversation.jsonl      # Message history
    ├── context.json            # Session metadata
    └── tools.json              # Tool execution log
```

**Key Concept**: Session identity tied to project directory, not UUID-based session IDs.

### --continue Flag

Claude CLI's `--continue` flag automatically resumes the latest conversation in the current directory:

```bash
# Initial session
claude -p /path/to/project --allowedTools Read Write

# Later: Add Edit tool with conversation preservation
claude -p /path/to/project --continue --allowedTools Read Write Edit
```

**Automatic Resume**: `--continue` finds and loads the latest conversation for the current directory without manual session ID management.

## When Conversation is Preserved

### Settings Changes

**User Flow**:
1. Open Copilot Configuration modal (Cmd/Ctrl+,)
2. Modify tool authorizations (enable/disable specific tools)
3. Click "Save"
4. Session restarts with `--continue` flag
5. Conversation history preserved
6. New tool configuration active

**Technical**:
```typescript
// CopilotPanel.tsx
const handleSaveSettings = async (approvedTools: string[]) => {
  await window.api.settings.setApprovedTools(approvedTools)
  await window.api.claudeCode.stopSession()
  const projectPath = await window.api.file.getProjectPath()
  if (projectPath) {
    // startSession uses --continue internally
    await window.api.claudeCode.startSession(projectPath, false)
  }
}
```

### Planning Mode Toggles

**User Flow**:
1. User toggles planning mode button in chat interface
2. Session restarts with `--continue` flag
3. Conversation history preserved
4. Tool set updated:
   - Planning mode ON: 9 safe tools (Read, LS, Glob, Grep, Task, WebSearch, TodoRead, TodoWrite, NotebookRead)
   - Planning mode OFF: All approved tools (17 by default)

**Technical**:
```typescript
// CopilotChat.tsx
const handlePlanningModeToggle = async () => {
  const newPlanningMode = !isPlanningMode
  setIsPlanningMode(newPlanningMode)
  await window.api.claudeCode.stopSession()
  await window.api.claudeCode.startSession(projectPath, newPlanningMode)
}
```

### Tool Approvals

**User Flow**:
1. Claude requests unapproved tool (e.g., MultiEdit, WebFetch)
2. ToolApprovalDialog appears
3. User approves tool (optionally with "Remember this choice")
4. Session restarts with `--continue` flag
5. Conversation history preserved
6. Newly approved tool active
7. Last user prompt automatically re-sent (auto-retry)

**Technical**:
```typescript
// ClaudeCliService.ts
async approveTool(toolName: string): Promise<void> {
  this.approvedTools.add(toolName)
  await settingsService.addApprovedTool(toolName)
  await this.restartWithNewPermissions()
}

private async restartWithNewPermissions(): Promise<void> {
  console.log('🔄 Restarting session with updated tool permissions...')
  await this.startSession(this.projectPath!, this.isPlanningMode)
  this.emit('session-resumed', {
    projectPath: this.projectPath,
    approvedTools: Array.from(this.approvedTools)
  })
}
```

## When Conversation Resets

### Clear Button

**Behavior**: Deletes session files from `~/.claude/projects/`, forcing fresh conversation start.

**User Flow**:
1. Click "Clear" button in Copilot panel
2. Confirmation dialog appears
3. User confirms
4. Session files deleted from disk
5. Session restarts without `--continue`
6. Fresh conversation begins

**Technical**:
```typescript
// ClaudeCliService.ts
async clearSession(): Promise<void> {
  const sessionDir = this.getSessionDirectory()
  if (await fs.pathExists(sessionDir)) {
    await fs.remove(sessionDir)
    console.log('🗑️ Session files deleted:', sessionDir)
  }
  await this.restartSession()
}

private getSessionDirectory(): string {
  const encoded = this.projectPath!.replace(/[\/\\:]/g, '_')
  return path.join(os.homedir(), '.claude', 'projects', encoded)
}
```

**Result**: Next session starts fresh without conversation history.

### App Launch or Project Open

**Behavior**: Session uses `--continue` automatically if previous conversation exists, otherwise starts fresh.

**Reason**: Directory-based approach enables seamless context restoration across app restarts.

### Manual Restart

**Behavior**: User clicks "Restart Session" button, session restarts with `--continue`.

**Reason**: Troubleshooting or connection issues, context preserved unless user explicitly clears.

## Session Statistics Tracking

### What's Tracked

**Message Count**: Total user + assistant messages in conversation
**Tool Executions**: Total tool invocations (Read, Write, Edit, etc.)
**Session Age**: Time since current session started (not total conversation age)

### When Stats Reset

**Session restart**: Stats reset on each session restart (tool changes, planning mode toggles)
**Not conversation**: Conversation history preserved via `--continue`, but runtime stats are per-session

**Implementation**:
```typescript
// ClaudeCliService.ts
async startSession(projectPath: string, planningMode: boolean = false): Promise<void> {
  // Stats reset on every session start
  this.sessionStats = {
    messageCount: 0,
    toolExecutions: 0,
    createdAt: new Date()
  }
}
```

### Accessing Stats

**IPC Channel**: `claudeCode:getSessionStats()`

**Usage**:
```typescript
// Renderer process
const stats = await window.api.claudeCode.getSessionStats()
console.log(`Messages: ${stats.messageCount}`)
console.log(`Tools used: ${stats.toolExecutions}`)
console.log(`Session age: ${Math.floor((Date.now() - stats.createdAt.getTime()) / 1000)}s`)
```

**UI Display**: Control Panel shows real-time stats:
- **Messages**: "15" (user + assistant count in current session)
- **Tools Used**: "7" (total tool executions in current session)
- **Duration**: "12m" (current session runtime)

## Technical Implementation

### Directory-Based Session Management

**ClaudeCliService.ts** - Core logic:

```typescript
async startSession(
  projectPath: string,
  planningMode: boolean = false
): Promise<void> {
  this.projectPath = projectPath
  this.isPlanningMode = planningMode

  // Build args with --continue for automatic resume
  const args = [
    '-p', projectPath,
    '--continue',  // Automatic conversation resume
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--allowedTools', ...Array.from(this.approvedTools)
  ]

  if (planningMode) {
    args.push('--permission-mode', 'plan')
  }

  this.claudeProcess = spawn('claude', args, { cwd: projectPath })
}
```

### Structured Logging

**Session Start Logging**: All session starts logged with configuration context.

```typescript
private logSessionStart(reason: string): void {
  console.log('📝 SESSION START', JSON.stringify({
    projectPath: this.projectPath,
    planningMode: this.isPlanningMode,
    approvedTools: Array.from(this.approvedTools).length,
    reason,
    timestamp: new Date().toISOString()
  }, null, 2))
}
```

**Example Log Output**:
```json
📝 SESSION START {
  "projectPath": "/Users/user/Projects/my-app",
  "planningMode": false,
  "approvedTools": 17,
  "reason": "settings_change",
  "timestamp": "2025-10-14T12:34:56.789Z"
}
```

## Troubleshooting

### Conversation Not Preserved

**Symptoms**: Settings changes or planning mode toggles restart session but lose conversation context.

**Diagnosis**:
1. Check console logs for `--continue` flag in spawn args
2. Verify session directory exists: `ls ~/.claude/projects/`
3. Check session files: `ls ~/.claude/projects/<encoded_path>/`
4. Verify Claude CLI version supports `--continue`

**Common Issues**:
- Session directory deleted (user cleanup or disk full)
- Claude CLI version too old (update via `brew upgrade claude`)
- File system permissions prevent reading session files

**Fix**:
```bash
# Check Claude CLI version
claude --version

# Update if needed
brew upgrade claude

# Verify session files exist
ls -la ~/.claude/projects/
```

### Clear Button Not Working

**Symptoms**: Clear button clicked but conversation continues from previous session.

**Diagnosis**:
1. Check session directory still exists after clear
2. Verify `fs.remove()` completed successfully
3. Check file system permissions for deletion

**Fix**:
```bash
# Manual clear if button fails
rm -rf ~/.claude/projects/<encoded_project_path>

# Or clear all sessions
rm -rf ~/.claude/projects/*
```

### Stats Not Resetting

**Symptoms**: Message count and tool executions persist after session restart.

**Expected Behavior**: Stats reset on every session restart, not conversation reset.

**Note**: Stats track current session runtime, not total conversation history. This is by design.

## Performance Considerations

### Token Costs

**Continue Impact**: `--continue` loads conversation history from disk, replaying context efficiently.

**Cost Comparison**:
- Without continue: Full context re-sent on every restart (e.g., 10,000 input tokens)
- With continue: Client-side replay from disk (minimal API cost)

**Recommendation**: Continue significantly reduces token costs for long conversations.

### Disk Usage

**Session Storage**: Each project has dedicated directory in `~/.claude/projects/`.

**Long Conversations**: Very long conversations (>1000 messages) may consume significant disk space (typically <10MB).

**Best Practice**: Use Clear button periodically for major task transitions to reclaim disk space.

### Session Load Time

**Continue Latency**: Initial session startup with `--continue` loads history from disk (typically <200ms).

**Network**: No network latency since session stored client-side, not server-side.

**Optimization**: Fast local disk I/O ensures minimal startup delay.

## Architecture Benefits

### Simplified Session Management

**No UUID Tracking**: Directory-based approach eliminates session ID lifecycle complexity.

**Automatic Resume**: Claude CLI handles session discovery automatically.

**Crash Recovery**: Session files persist on disk, survive app crashes.

### Clear Button for Fresh Start

**User Control**: Explicit action to clear conversation, not accidental.

**Disk Cleanup**: Removes session files, reclaims space.

**Debugging**: Clean slate for testing or troubleshooting.

## Migration from --resume

**Previous Approach**: Used `--session-id` + `--resume` with UUID-based session tracking.

**Current Approach**: Uses `--continue` with directory-based session discovery.

**Benefits**:
- Simpler architecture (-178 lines of code)
- No session ID lifecycle management
- Automatic session discovery
- Better crash recovery (session files persist)
- Explicit clear action via Clear button

**Code Reduction**:
- Removed: `generateSessionId()`, session ID reuse logic, resume failure patterns, timeout handling
- Simplified: Session start logic, conversation preservation, error handling

## Related Documentation

- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Tool Approval System](./tool-approval-core.md)** - Complete tool approval documentation
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Session management channels
