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

**1. Add Tool Description**: Update `ClaudeCliService.ts:getToolDescription()` with new tool name and description.

**2. Add to ToolSettingsDialog Categories**: Update `ToolSettingsDialog.tsx:20-60` TOOL_CATEGORIES array with new tool entry.

All tools are enabled by default. Users configure via Settings modal (Cmd/Ctrl+,).

### Testing Settings Modal

**Open**: Gear icon in Copilot header OR `Cmd/Ctrl+,`

**Default State**: All 17 tools enabled, global toggle checked

**Selective Mode Test**: Uncheck global toggle → customize individual tools → verify counter updates

**Save & Restart**: Verify session restarts, modal closes, Control Panel updates

**Persistence**: Check `~/.config/erfana/config.json` for approved tools list

**Approval Dialog**: Send message requiring restricted tool → dialog appears → approve → tool added back

**Reset**: Click "Reset to Defaults" → confirm → all tools re-enabled

### Testing Tool Approval Flow

**Setup**: Restrict tool via Settings modal (e.g., uncheck Edit)

**Trigger**: Send message requiring restricted tool

**Approval Test**: Click "Approve" with "Remember" → dialog closes → session restarts with --continue → last prompt auto-retried → tool executes → config.json updated

**Denial Test**: Click "Deny" → dialog closes → session restarts without tool → no auto-retry

**Verify Persistence**: Check `~/.config/erfana/config.json` for approved tool

### Testing Planning Mode

**Enable**: Click toggle → button turns blue → system message → session restarts with `--permission-mode plan` → Control Panel shows 9 safe tools

**Test Read-Only**: Send "Read README.md" → executes successfully, no dialog

**Test Blocked**: Send "Edit README.md" → Claude responds with error, no dialog

**Disable**: Click toggle again → normal state → system message → session restarts with full tool set → Control Panel shows all approved tools

### Testing Auto-Retry

**Setup**: Restrict tool, trigger approval

**Verify**: Send "Edit file" → approve → check console for "🔄 Auto-retrying last prompt" → verify Edit executes

**Without Prompt**: Approve via Settings (no message) → session restarts → no auto-retry, only system message

## Debugging Common Issues

### Dialog Doesn't Show

**Diagnose**: Tool already approved? Event listener registered? IPC channel name correct? Preload API exposed?

**Debug**: Add console.logs in `ClaudeCliService.convertEvent()` and `CopilotChat.onToolApprovalNeeded` listener

**Check**: config.json for tool list, useEffect listener, contextBridge setup

### Tool Blocked Even After Approval

**Diagnose**: Tool in approvedTools Set? In --allowedTools spawn args? Session restarted? Tool name case-sensitive match?

**Debug**: Log `this.approvedTools` after add, spawn args before exec, stored tools in config.json

**Common Causes**: Case mismatch, session not restarted, persistence failed

### Context Lost After Restart

**Diagnose**: `--continue` flag in spawn args? Session dir `~/.claude/projects/` exists? Claude CLI version supports --continue? File permissions OK?

**Debug**: Log spawn args, check session directory with `ls -la ~/.claude/projects/`

**Verify**: Directory should contain `conversation.jsonl`, `context.json`, `tools.json`

**Common Causes**: Missing --continue flag, directory deleted, old Claude CLI version, permission issues

### Auto-Retry Doesn't Work

**Diagnose**: `lastUserPrompt` stored? `onSessionResumed` listener registered? System message shows?

**Debug**: Log in handleSend (storing prompt) and onSessionResumed (retrying)

**Common Causes**: Prompt not stored, listener not registered, sendMessage not called, React state timing

### Persistence Doesn't Work

**Diagnose**: "Remember this choice" checked? electron-store initialized? config.json exists and writable?

**Debug**: Log remember parameter, verify addApprovedTool called, check config.json content

**Verify**: `cat ~/.config/erfana/config.json` should show approvedTools array

**Common Causes**: Checkbox not checked, electron-store async import issue, file permissions, disk full

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

**Session Restart**: Full process restart (kill + spawn) on tool approval takes 200-500ms.

**Future Improvements**: Batch approvals (500ms debounce), parallel config loading

**Memory**: Sessions stored in `~/.claude/projects/`. Long conversations (>1000 messages) may accumulate.

**Cleanup**: Clear button removes session files, or manual `rm -rf ~/.claude/projects/*`

## Related Documentation

- **[Tool Approval Core Guide](./tool-approval-core.md)** - Overview, settings modal, approval flow
- **[Claude Code Integration Index](./README.md)** - Overview and quick reference
- **[Conversation Preservation](./conversation-preservation.md)** - Session preservation guide
- **[UI Features](./ui-features.md)** - Copilot panel, Control Panel, Planning Mode
- **[Architecture](../architecture.md)** - ClaudeCliService, persistent sessions
- **[IPC Patterns](../ipc-patterns.md)** - Tool approval and settings channels
- **[Security](../security.md)** - Security principles and validation
