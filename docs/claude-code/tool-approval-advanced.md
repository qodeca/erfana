# Tool Approval System - Advanced Guide

Advanced topics: IPC channels, development patterns, testing, and troubleshooting.

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

**settings:setApprovedTools(tools)**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:15`

**settings:addApprovedTool(toolName)**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:24`

**settings:removeApprovedTool(toolName)**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:33`

**settings:resetApprovedTools()**
- Returns: `{success, error?}`
- Handler: `settings-handlers.ts:42`

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

### Testing Tool Approval Flow

**Setup**: Restrict a tool via Settings modal

**1. Restrict Edit Tool**:
```typescript
// Via Settings modal
// 1. Open modal (Cmd/Ctrl+,)
// 2. Uncheck "Enable all tools by default"
// 3. Uncheck "Edit" tool
// 4. Click "Save"
// 5. Verify config.json updated
```

**2. Trigger Approval Dialog**:
```typescript
// Send message requiring Edit tool
"Change the poem in asd.md"

// Expected:
// 1. ToolApprovalDialog appears
// 2. Shows "Edit" tool with description
// 3. Shows file_path parameter
```

**3. Test Approval**:
```typescript
// Click "Approve" with "Remember this choice" checked

// Expected:
// 1. Dialog closes
// 2. System message: "🔄 Retrying with approved tools: ..."
// 3. Session restarts with --continue
// 4. Last prompt auto-retried
// 5. Edit tool executes successfully
// 6. config.json updated with Edit tool
```

**4. Test Denial**:
```typescript
// Click "Deny"

// Expected:
// 1. Dialog closes
// 2. System message: "Tool Edit was denied"
// 3. Session restarts without Edit tool
// 4. No auto-retry
```

**5. Verify Persistence**:
```bash
cat ~/.config/erfana/config.json
# Should include "Edit" if approved with "Remember this choice"
```

### Testing Planning Mode

**1. Enable Planning Mode**:
```typescript
// Click planning mode toggle button in chat interface

// Expected:
// 1. Button turns blue (active state)
// 2. System message: "Planning mode enabled. Using read-only tools."
// 3. Session restarts with --permission-mode plan
// 4. Control Panel shows only 9 safe tools
```

**2. Test Read-Only Tools**:
```typescript
// Send message requiring safe tool
"Read the contents of README.md"

// Expected:
// 1. Read tool executes successfully
// 2. No approval dialog
```

**3. Test Blocked Tools**:
```typescript
// Send message requiring write tool
"Edit the file README.md"

// Expected:
// 1. Claude responds with error
// 2. "Edit tool not available in planning mode"
// 3. No approval dialog (tool not in allowed list)
```

**4. Disable Planning Mode**:
```typescript
// Click planning mode toggle button again

// Expected:
// 1. Button returns to normal state
// 2. System message: "Planning mode disabled. All approved tools available."
// 3. Session restarts with full tool set
// 4. Control Panel shows all 17 tools (or approved subset)
```

### Testing Auto-Retry

**Setup**: Restrict a tool, then trigger approval

**1. Track Prompt**:
```typescript
// CopilotChat.tsx should store lastUserPrompt
const handleSend = () => {
  setLastUserPrompt(trimmedInput)  // This must be called
  window.api.claudeCode.sendMessage(trimmedInput, {}, sessionId)
}
```

**2. Trigger Approval**:
```typescript
// Send: "Edit the file asd.md"
// ToolApprovalDialog appears
// Click "Approve"
```

**3. Verify Auto-Retry**:
```typescript
// Expected sequence:
// 1. Dialog closes
// 2. Session restarts with --continue
// 3. onSessionResumed event fires
// 4. System message shows approved tools
// 5. lastUserPrompt automatically re-sent
// 6. Edit tool executes
// 7. File modified

// Check console logs:
// "🔄 Auto-retrying last prompt: Edit the file asd.md"
```

**4. Test Without Last Prompt**:
```typescript
// Open new session
// Approve tool via Settings modal (not via message)

// Expected:
// 1. Session restarts with --continue
// 2. No auto-retry (no lastUserPrompt)
// 3. Only system message about tool approval
```

## Debugging Common Issues

### Dialog Doesn't Show

**Symptoms**: Tool blocked but no approval dialog appears.

**Diagnosis**:
1. Check tool not already in approved list
2. Check `convertEvent()` detecting tool_use blocks
3. Check `tool-approval-needed` event emitted
4. Check `onToolApprovalNeeded` listener registered

**Debug Steps**:
```typescript
// ClaudeCliService.ts
private convertEvent(event: ClaudeEvent): any {
  if (event.type === 'tool_use') {
    const toolName = event.name
    if (!this.approvedTools.has(toolName)) {
      console.log('❌ Tool not approved:', toolName)  // Should log
      this.emit('tool-approval-needed', { ... })      // Should emit
    }
  }
}

// CopilotChat.tsx
useEffect(() => {
  const unsubscribe = window.api.claudeCode.onToolApprovalNeeded((request) => {
    console.log('📨 Approval request received:', request)  // Should log
    setPendingApproval(request)
  })
  return unsubscribe
}, [])
```

**Common Causes**:
- Tool already approved (check config.json)
- Event listener not registered (check useEffect)
- Event name mismatch (check IPC channel name)
- Preload API not exposed (check contextBridge)

### Tool Blocked Even After Approval

**Symptoms**: User approves tool but it's still blocked on next use.

**Diagnosis**:
1. Check `approvedTools` Set contains tool name
2. Check `--allowedTools` in spawn args includes tool
3. Check session restarted (logs: "🔄 Restarting session")
4. Check no typos in tool name (case-sensitive)

**Debug Steps**:
```typescript
// ClaudeCliService.ts
async approveTool(toolName: string, remember: boolean): Promise<void> {
  this.approvedTools.add(toolName)
  console.log('✅ Tool approved:', toolName)
  console.log('📊 Approved tools:', Array.from(this.approvedTools))  // Verify included

  if (remember) {
    await settingsService.addApprovedTool(toolName)
    const stored = await settingsService.getApprovedTools()
    console.log('💾 Stored tools:', stored)  // Verify persisted
  }

  await this.restartWithNewPermissions()
}

private async startSession(...) {
  const args = [
    '--allowedTools', ...Array.from(this.approvedTools)
  ]
  console.log('🚀 Spawn args:', args)  // Verify tool in args
}
```

**Common Causes**:
- Tool name case mismatch (Edit vs edit)
- Session not restarted after approval
- Approved tools not passed to spawn args
- electron-store persistence failed

### Context Lost After Restart

**Symptoms**: Session restarts but conversation history lost.

**Diagnosis**:
1. Check `--continue` flag in spawn args
2. Check session directory exists: `~/.claude/projects/`
3. Check Claude CLI version supports --continue
4. Check file system permissions

**Debug Steps**:
```typescript
// ClaudeCliService.ts
private async startSession(...) {
  const args = [
    '-p', this.projectPath,
    '--continue',  // Must be present
    // ...
  ]
  console.log('🚀 Session start args:', args)

  // Check session directory
  const sessionDir = path.join(os.homedir(), '.claude', 'projects',
    this.projectPath!.replace(/[\/\\:]/g, '_'))
  console.log('📁 Session directory:', sessionDir)
  console.log('📁 Exists:', fs.existsSync(sessionDir))
}
```

**Manual Check**:
```bash
# Check Claude CLI version
claude --version

# Check session directory
ls -la ~/.claude/projects/

# Check session files
ls -la ~/.claude/projects/<encoded_project_path>/
# Should show: conversation.jsonl, context.json, tools.json
```

**Common Causes**:
- `--continue` flag missing from args
- Session directory deleted (user cleanup or disk full)
- Claude CLI version too old (update via brew)
- File system permissions prevent reading

### Auto-Retry Doesn't Work

**Symptoms**: After approval, user must manually re-send prompt.

**Diagnosis**:
1. Check `lastUserPrompt` stored in state
2. Check `onSessionResumed` listener registered
3. Check system message shows
4. Check `sendMessage` called with `lastUserPrompt`

**Debug Steps**:
```typescript
// CopilotChat.tsx
const handleSend = () => {
  console.log('📨 Storing last prompt:', trimmedInput)
  setLastUserPrompt(trimmedInput)  // Must be called
}

useEffect(() => {
  const unsubscribe = window.api.claudeCode.onSessionResumed((data) => {
    console.log('🔄 Session resumed:', data)
    console.log('📝 Last prompt:', lastUserPrompt)

    if (lastUserPrompt) {
      console.log('🔁 Auto-retrying:', lastUserPrompt)
      window.api.claudeCode.sendMessage(lastUserPrompt, {}, newSessionId)
    } else {
      console.log('⚠️ No last prompt to retry')
    }
  })
  return unsubscribe
}, [lastUserPrompt])
```

**Common Causes**:
- `lastUserPrompt` not stored before approval
- `onSessionResumed` listener not registered
- `sendMessage` not called after resume
- React state update timing issue

### Persistence Doesn't Work

**Symptoms**: Approved tools lost on app restart.

**Diagnosis**:
1. Check `remember` parameter true in `approveTool()` call
2. Check `addApprovedTool()` called
3. Check `config.json` file exists and writable
4. Check electron-store initialized (async import)

**Debug Steps**:
```typescript
// ClaudeCliService.ts
async approveTool(toolName: string, remember: boolean): Promise<void> {
  console.log('💾 Remember:', remember)  // Should be true

  if (remember) {
    await settingsService.addApprovedTool(toolName)
    console.log('✅ Tool persisted')

    // Verify immediately
    const tools = await settingsService.getApprovedTools()
    console.log('📊 All stored tools:', tools)
  }
}
```

**Manual Check**:
```bash
# Check config file exists
cat ~/.config/erfana/config.json

# Should show:
# {
#   "approvedTools": ["Read", "Write", "Edit", ...],
#   "lastProjectPath": "..."
# }

# Check file permissions
ls -la ~/.config/erfana/config.json
# Should be writable by current user
```

**Common Causes**:
- "Remember this choice" not checked in dialog
- electron-store not initialized (async import issue)
- Config file permissions (not writable)
- Disk full (write failed)

## Advanced Troubleshooting

### Session Restart Timing

**Issue**: Brief delay after approval before new tools available.

**Explanation**: Session restart involves:
1. Kill old process (SIGTERM, 100ms grace period)
2. Spawn new process (50-200ms initialization)
3. Load conversation history (50-200ms from disk)
4. Ready state (total: 200-500ms)

**Expected**: 200-500ms delay is normal and intentional.

**Not a Bug**: This delay allows clean process shutdown and initialization.

### Stop Generation Not Supported

**Issue**: Stop generation button unavailable during tool execution.

**Explanation**: Persistent session architecture doesn't support mid-request cancellation without full restart.

**Workaround**: Restart session via "Restart Session" button if needed.

**Future**: Consider implementing graceful cancellation with --continue.

### Network File Systems

**Issue**: Claude CLI may have issues with NFS/SMB projects.

**Explanation**: Claude CLI relies on local file system for session storage and project access.

**Recommendation**: Use local projects only. Clone remote projects to local disk.

**Workaround**: If required, ensure NFS/SMB has proper file locking and sync.

## Performance Optimization

### Session Restart Optimization

**Current**: Full process restart (kill + spawn) on tool approval.

**Optimization Opportunities**:
- Batch tool approvals (approve multiple tools before restart)
- Debounce rapid approvals (500ms delay)
- Parallel initialization (load config during spawn)

**Implementation**:
```typescript
// Future: Batch approvals
private pendingApprovals: Set<string> = new Set()
private approvalTimer: NodeJS.Timeout | null = null

async approveTool(toolName: string): Promise<void> {
  this.pendingApprovals.add(toolName)

  if (this.approvalTimer) clearTimeout(this.approvalTimer)

  this.approvalTimer = setTimeout(() => {
    this.approvedTools = new Set([...this.approvedTools, ...this.pendingApprovals])
    this.pendingApprovals.clear()
    this.restartWithNewPermissions()
  }, 500)
}
```

### Memory Management

**Session Storage**: Each project stores conversation history in `~/.claude/projects/`.

**Long Conversations**: Monitor disk usage for projects with >1000 messages.

**Cleanup Strategy**:
- Clear button removes session files
- Manual cleanup: `rm -rf ~/.claude/projects/*`
- Future: Automatic cleanup of old sessions (>30 days)

## Related Documentation

- **[Tool Approval Core Guide](./tool-approval-core.md)** - Overview, settings modal, approval flow
- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Conversation Preservation](./conversation-preservation.md)** - Session preservation guide
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Tool approval and settings channels
- **[Security](../security.md)** - Security principles and validation
