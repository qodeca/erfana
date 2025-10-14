# Conversation Preservation

Complete guide to Erfana's conversation preservation system for seamless Claude Code workflow.

## Overview

**Problem**: Traditional session restarts lose conversation context, forcing users to repeat context or abandon ongoing discussions when changing tool permissions or toggling modes.

**Solution**: Erfana intelligently preserves conversation history across configuration changes using Claude CLI's `--resume` flag, maintaining context while updating permissions.

**Key Innovation**: Session ID lifecycle management determines when to preserve context (reuse session ID + `--resume`) vs. start fresh (generate new session ID).

## How It Works

### Session ID Lifecycle

The session ID determines conversation continuity:

**Fresh Session ID** (new conversation):
- App launch or project open
- Manual "Restart Session" button
- Resume failure (automatic fallback)

**Reused Session ID** (preserved conversation):
- Tool authorization changes (settings save)
- Tool approval dialog
- Planning mode toggles

### --resume Flag

Claude CLI's `--resume` flag loads conversation history from server-side session storage:

```bash
# Initial session
claude --session-id abc123 --allowedTools Read Write

# Later: Add Edit tool with conversation preservation
claude --session-id abc123 --resume abc123 --allowedTools Read Write Edit
```

**Server-Side Storage**: Session state stored in `~/.claude/projects/` directory with conversation history, context, and metadata.

## When Conversation is Preserved

### Settings Changes

**User Flow**:
1. Open Copilot Configuration modal (Cmd/Ctrl+,)
2. Modify tool authorizations (enable/disable specific tools)
3. Click "Save"
4. Session restarts with `--resume` flag
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
    // startSession called without reason parameter
    // Internally uses 'settings' reason to trigger --resume
    await window.api.claudeCode.startSession(projectPath, false)
  }
}
```

**Session Start Reason**: `'settings'` - triggers session ID reuse + `--resume`

### Planning Mode Toggles

**User Flow**:
1. User toggles planning mode button in chat interface
2. Session restarts with `--resume` flag
3. Conversation history preserved
4. Tool set updated:
   - Planning mode ON: 9 safe tools (Read, LS, Glob, Grep, Task, WebSearch, TodoRead, TodoWrite, NotebookRead)
   - Planning mode OFF: All approved tools

**Technical**:
```typescript
// CopilotChat.tsx
const handlePlanningModeToggle = async () => {
  const newPlanningMode = !isPlanningMode
  setIsPlanningMode(newPlanningMode)

  await window.api.claudeCode.stopSession()
  // startSession with planning mode flag
  // Internally uses 'planning' reason to trigger --resume
  await window.api.claudeCode.startSession(projectPath, newPlanningMode)
}
```

**Session Start Reason**: `'planning'` - triggers session ID reuse + `--resume`

### Tool Approvals

**User Flow**:
1. Claude requests unapproved tool (e.g., MultiEdit, WebFetch)
2. ToolApprovalDialog appears
3. User approves tool (optionally with "Remember this choice")
4. Session restarts with `--resume` flag
5. Conversation history preserved
6. Newly approved tool active
7. Last user prompt automatically re-sent (auto-retry)

**Technical**:
```typescript
// ClaudeCliService.ts
async approveTool(toolName: string): Promise<void> {
  this.approvedTools.add(toolName)
  await settingsService.addApprovedTool(toolName)

  // Restart with new permissions
  await this.restartWithNewPermissions()  // Uses 'settings' reason internally
}

private async restartWithNewPermissions(): Promise<void> {
  console.log('🔄 Restarting session with updated tool permissions...')
  console.log('📊 Using reason: settings (conversation will be preserved)')

  // Use startSession with 'settings' reason to preserve conversation
  await this.startSession(this.projectPath!, this.isPlanningMode, 'settings')

  this.emit('session-resumed', {
    projectPath: this.projectPath,
    approvedTools: Array.from(this.approvedTools)
  })
}
```

**Session Start Reason**: `'settings'` - triggers session ID reuse + `--resume`

## When Conversation Resets

### App Launch or Project Open

**Behavior**: Fresh session ID generated, new conversation started.

**Reason**: No previous session context available.

**Session Start Reason**: `'initial'`

### Manual Restart

**Behavior**: User clicks "Restart Session" button, fresh session ID generated.

**Reason**: User explicitly requests fresh start (troubleshooting, clear context, etc.).

**Session Start Reason**: `'manual_restart'`

### Resume Failure

**Behavior**: `--resume` fails, automatically falls back to fresh session ID.

**Reason**: Session not found, expired, or corrupted on server-side.

**Session Start Reason**: `'recovery'` (attempts resume first, then falls back)

## Resume Failure Handling

### Automatic Fallback

Erfana detects resume failures and gracefully falls back to fresh session:

**Detection**: 13 error patterns from Claude CLI stderr:

```typescript
const resumeFailurePatterns = [
  'session not found',
  'resume failed',
  'invalid session',
  'session expired',
  'failed to resume',
  'could not resume',
  'unable to resume',
  'session file not found',
  'session file corrupted',
  'session file is corrupted',
  'failed to load session',
  'error loading session',
  'session data invalid'
]
```

**Fallback Process**:
1. Claude CLI process spawns with `--resume` flag
2. stderr output monitored for failure patterns
3. If match detected:
   - Kill current failed process
   - Generate fresh session ID
   - Restart without `--resume`
   - Emit `'session-resume-failed'` event
   - Show system message in chat

**User Experience**: Seamless transition with informative message:
```
⚠️ Previous conversation history unavailable. Starting fresh session.
```

### Resume Timeout

**Protection**: 10-second timeout prevents hanging on server-side issues.

**Implementation**:
```typescript
// ClaudeCliService.ts
let resumeTimeout: NodeJS.Timeout | null = null
if (shouldUseResume) {
  resumeTimeout = setTimeout(() => {
    if (this.sessionState === 'starting') {
      console.error('❌ Resume operation timed out (10s)')
      this.handleResumeFailed(previousSessionId!)
    }
  }, 10000)
}
```

**Behavior**: If session doesn't become ready within 10 seconds, automatic fallback to fresh session.

### Common Causes

**Session File Deleted**:
- User manually deleted `~/.claude/projects/<session-id>` directory
- Cleanup script removed old sessions
- File system full during session write

**Session Expired**:
- >30 days since last use (Claude CLI policy)
- Server-side retention policy

**Claude CLI Version Mismatch**:
- Session created with v1.x, resumed with v2.x
- Incompatible session format changes

**File System Corruption**:
- Disk errors during session write
- Power loss during session save
- File system permissions changed

**Network Interruption**:
- Server-side session fetch failed
- Timeout during session retrieval
- API endpoint unavailable

## Session Statistics Tracking

### What's Tracked

**Message Count**: Total user + assistant messages in conversation
**Tool Executions**: Total tool invocations (Read, Write, Edit, etc.)
**Session Age**: Time since session creation (in seconds)

### When Stats Reset

**Fresh Session ID** scenarios:
- App launch or project open
- Manual "Restart Session" button
- Resume failure (automatic fallback)

**Implementation**:
```typescript
// ClaudeCliService.ts
if (reason === 'initial' || reason === 'manual_restart' || reason === 'recovery') {
  this.sessionId = this.generateSessionId()

  // Reset stats for fresh sessions
  this.sessionStats = {
    messageCount: 0,
    toolExecutions: 0,
    createdAt: new Date()
  }
}
```

### When Stats Preserved

**Reused Session ID** scenarios:
- Tool authorization changes (settings save, approval dialog)
- Planning mode toggles (exploration ↔ implementation)

**Behavior**: Stats continue incrementing across session restarts.

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
- **Messages**: "15" (user + assistant count)
- **Tools Used**: "7" (total tool executions)
- **Duration**: "12m" (session runtime)

## Technical Implementation

### Session Start Reasons

**Type Definition**:
```typescript
/**
 * Session start reason - determines session ID lifecycle and --resume usage
 *
 * - 'initial': App launch or first project open - generates fresh session ID
 * - 'manual_restart': User explicit restart - generates fresh session ID
 * - 'settings': Tool approval change - reuses session ID with --resume
 * - 'planning': Planning mode toggle - reuses session ID with --resume
 * - 'recovery': Crash recovery - attempts --resume, falls back to fresh if needed
 */
type SessionStartReason =
  | 'initial'         // App launch
  | 'manual_restart'  // User explicit restart
  | 'settings'        // Tool config change
  | 'planning'        // Planning mode toggle
  | 'recovery'        // Crash recovery or resume failure
```

### Session ID Lifecycle Logic

**ClaudeCliService.ts** - Core logic:

```typescript
async startSession(
  projectPath: string,
  planningMode: boolean = false,
  reason: SessionStartReason = 'initial'
): Promise<void> {
  // Session ID lifecycle: Generate fresh ID for initial/manual/recovery, reuse for settings/planning
  const previousSessionId = this.sessionId
  const shouldUseResume = (reason === 'settings' || reason === 'planning') && previousSessionId

  if (reason === 'initial' || reason === 'manual_restart' || reason === 'recovery') {
    this.sessionId = this.generateSessionId()
    console.log('🆕 Fresh session ID generated:', this.sessionId)
    console.log(`📊 Reason: ${reason} - Starting new conversation`)

    // Reset stats for fresh sessions
    this.sessionStats = {
      messageCount: 0,
      toolExecutions: 0,
      createdAt: new Date()
    }
  } else {
    console.log('🔄 Reusing session ID for conversation preservation:', this.sessionId)
    console.log(`📊 Reason: ${reason} - Preserving conversation context`)
  }

  // Build args
  const args = ['--session-id', this.sessionId!]

  // Add --resume flag for settings/planning mode changes
  if (shouldUseResume) {
    this.logResumeAttempt(previousSessionId!, reason)
    args.push('--resume', previousSessionId!)
    console.log('✅ Added --resume flag for conversation preservation')
  }
}
```

### Structured Logging

**Resume Attempt Logging**: All resume attempts logged with full session context for debugging.

```typescript
private logResumeAttempt(sessionId: string, reason: SessionStartReason): void {
  console.log('📝 RESUME ATTEMPT', JSON.stringify({
    sessionId,
    reason,
    projectPath: this.projectPath,
    planningMode: this.isPlanningMode,
    messageCount: this.sessionStats.messageCount,
    toolExecutions: this.sessionStats.toolExecutions,
    sessionAge: this.sessionStats.createdAt
      ? Math.floor((Date.now() - this.sessionStats.createdAt.getTime()) / 1000)
      : 0,
    timestamp: new Date().toISOString()
  }, null, 2))
}
```

**Example Log Output**:
```json
📝 RESUME ATTEMPT {
  "sessionId": "abc123-def456-ghi789",
  "reason": "settings",
  "projectPath": "/Users/user/Projects/my-app",
  "planningMode": false,
  "messageCount": 15,
  "toolExecutions": 7,
  "sessionAge": 720,
  "timestamp": "2025-10-14T12:34:56.789Z"
}
```

### Error Detection

**stderr Monitoring**: Claude CLI stderr continuously monitored for resume failure patterns.

```typescript
this.claudeProcess.stderr.on('data', (data: Buffer) => {
  const errorText = data.toString()
  console.error('❌ Claude CLI stderr:', errorText)

  // Detect resume-specific failures
  if (this.isResumeFailure(errorText)) {
    console.error('❌ Resume failed, falling back to fresh session')
    this.handleResumeFailed(previousSessionId || this.sessionId!)
    return
  }
})
```

**Resume Failure Detection**:
```typescript
private isResumeFailure(errorText: string): boolean {
  const lowerErrorText = errorText.toLowerCase()
  return resumeFailurePatterns.some(pattern => lowerErrorText.includes(pattern))
}
```

### Fallback Process

**handleResumeFailed()** - Graceful fallback to fresh session:

```typescript
private async handleResumeFailed(oldSessionId: string): Promise<void> {
  console.error('🔄 Resume failed, initiating fallback to fresh session')
  console.error(`📝 Failed session ID: ${oldSessionId}`)

  // Kill current failed attempt
  if (this.claudeProcess) {
    this.claudeProcess.removeAllListeners()
    this.claudeProcess.kill('SIGKILL')
    this.claudeProcess = null
  }

  // Generate fresh session ID
  this.sessionId = this.generateSessionId()
  console.log(`🆕 Generated fresh session ID: ${this.sessionId}`)

  // Restart with 'recovery' reason (will not use --resume)
  await this.startSession(this.projectPath!, this.isPlanningMode, 'recovery')

  // Emit event to notify UI
  this.emit('session-resume-failed', {
    oldSessionId,
    newSessionId: this.sessionId,
    message: '⚠️ Previous conversation history unavailable. Starting fresh session.'
  })
}
```

## Troubleshooting

### Resume Not Working

**Symptoms**: Settings changes or planning mode toggles restart session but lose conversation context.

**Diagnosis**:
1. Check console logs for "🔄 Reusing session ID for conversation preservation"
2. Verify `--resume` flag in spawn args
3. Check stderr for resume failure patterns
4. Verify session ID is not regenerated

**Common Issues**:
- Session start reason incorrect (should be 'settings' or 'planning')
- Previous session ID is null (no session to resume)
- Session expired or deleted from `~/.claude/projects/`

**Fix**:
```typescript
// Ensure correct reason passed to startSession
await this.startSession(projectPath, planningMode, 'settings')  // ✅
await this.startSession(projectPath, planningMode, 'initial')   // ❌ Will not resume
```

### Stats Not Resetting

**Symptoms**: Message count and tool executions persist after app restart.

**Diagnosis**: Check session start reason. Stats only reset for 'initial', 'manual_restart', and 'recovery'.

**Expected Behavior**:
- App launch → 'initial' reason → stats reset
- Tool approval → 'settings' reason → stats preserved

### Resume Timeout

**Symptoms**: Session hangs for 10 seconds, then falls back to fresh session.

**Diagnosis**: Network or server-side issues preventing session retrieval.

**Mitigation**:
- Check internet connectivity
- Verify Claude API endpoint reachable
- Review `~/.claude/logs/` for server errors
- Try manual restart (fresh session)

### Session File Corruption

**Symptoms**: Resume consistently fails with "session file corrupted" error.

**Diagnosis**:
```bash
ls -la ~/.claude/projects/
# Check if session directory exists and has valid files
```

**Fix**:
```bash
# Remove corrupted session (forces fresh session)
rm -rf ~/.claude/projects/<session-id>

# Or reset all sessions
rm -rf ~/.claude/projects/*
```

## Performance Considerations

### Token Costs

**Resume Impact**: `--resume` loads conversation history from server, replaying context without retransmitting messages.

**Cost Comparison**:
- Without resume: Full context re-sent on every restart (e.g., 10,000 input tokens)
- With resume: Server-side replay (minimal additional cost)

**Recommendation**: Resume significantly reduces token costs for long conversations.

### Memory Usage

**Session State**: Server-side session storage has size limits (typically MB per session).

**Long Conversations**: Very long conversations (>1000 messages) may approach limits.

**Best Practice**: Periodically start fresh session for major task transitions.

### Network Latency

**Resume Latency**: Initial session startup with `--resume` fetches history from server (typically <500ms).

**Fallback Latency**: If resume fails, fallback adds 10-second timeout delay.

**Optimization**: Resume timeout could be tuned (currently 10s conservative).

## Future Enhancements

### Selective Resume

**Idea**: Allow user to choose whether to resume or start fresh on configuration changes.

**UI**: Checkbox in settings modal: "Preserve conversation when changing tools"

**Benefit**: Power users can control context vs. fresh start tradeoff.

### Session History UI

**Idea**: Show list of previous sessions with timestamps, allow manual resume.

**UI**: "Session History" section in Copilot panel

**Benefit**: Recover abandoned conversations, switch between projects.

### Resume Retry

**Idea**: If resume fails, show dialog offering retry vs. fresh start.

**UI**: "Resume failed. Retry or start fresh?"

**Benefit**: User control on transient network issues.

### Session Export/Import

**Idea**: Export session state to file, import on different machine.

**UI**: "Export Conversation" button, "Import Conversation" file picker

**Benefit**: Share conversation context, backup important discussions.

## Related Documentation

- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Tool Approval System](./tool-approval.md)** - Complete tool approval documentation
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Session management channels
