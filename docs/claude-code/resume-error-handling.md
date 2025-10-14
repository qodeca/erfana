# Resume Failure Error Handling

**Status**: ✅ FULLY IMPLEMENTED

Robust error detection and recovery system for `--resume` flag failures in Claude CLI integration.

## Overview

When Claude CLI is restarted with the `--resume` flag (to preserve conversation history), the session file may be unavailable, corrupted, or incompatible. This system detects resume failures automatically and gracefully falls back to a fresh session.

## Architecture

### Detection Layer
**Location**: `ClaudeCliService.ts:isResumeFailure()`

Monitors Claude CLI stderr for 13 distinct error patterns:
- Session not found
- Resume failed
- Invalid session
- Session expired
- Session file not found/corrupted
- Failed to load/resume session
- Error loading session
- Session data invalid

### Recovery Layer
**Location**: `ClaudeCliService.ts:handleResumeFailed()`

Automatic fallback process:
1. Kill failed Claude CLI process
2. Generate fresh session ID
3. Restart with 'recovery' reason (no --resume)
4. Emit `session-resume-failed` event to UI
5. Show system message: "⚠️ Previous conversation history unavailable. Starting fresh session."

### Timeout Protection
**Location**: `ClaudeCliService.ts:startSession()` lines 438-446

10-second timeout for resume operations:
- If `--resume` hangs (large session file, I/O issues), automatic fallback triggers
- Prevents indefinite waiting
- Ensures responsive user experience

### Structured Logging
**Location**: `ClaudeCliService.ts:logResumeAttempt()`

JSON-formatted logs for diagnostics:
```json
{
  "sessionId": "abc-123",
  "reason": "settings",
  "projectPath": "/path/to/project",
  "planningMode": false,
  "messageCount": 15,
  "toolExecutions": 8,
  "sessionAge": 245,
  "timestamp": "2025-10-14T12:00:00Z"
}
```

## Error Scenarios Covered

### 1. Session Not Found
**Cause**: Session file deleted or moved from `~/.claude/projects/`

**Detection**: stderr contains "session not found"

**Recovery**: Fresh session with new ID

### 2. Session File Corrupted
**Cause**: Interrupted write, disk corruption, power failure

**Detection**: stderr contains "session file corrupted" or "session data invalid"

**Recovery**: Fresh session, old session ID logged

### 3. Claude CLI Version Mismatch
**Cause**: Session saved with newer/older Claude CLI version

**Detection**: stderr contains "invalid session" or "failed to load session"

**Recovery**: Fresh session with compatible format

### 4. Permissions Issue
**Cause**: Session file unreadable (wrong permissions, locked)

**Detection**: stderr contains "failed to resume" or "unable to resume"

**Recovery**: Fresh session, original file preserved

### 5. Resume Timeout
**Cause**: Large session file (100+ messages), slow disk I/O

**Detection**: 10-second timeout expires while state is 'starting'

**Recovery**: Process killed, fresh session started

### 6. Network Session Sync Failure (Future)
**Cause**: Cloud-synced sessions unavailable offline

**Detection**: stderr contains "session expired" or network-related errors

**Recovery**: Fresh local session

## Implementation Files

### Backend
- **ClaudeCliService.ts** (lines 315-537, 1207-1296)
  - `startSession()`: Enhanced with resume detection and timeout
  - `isResumeFailure()`: Pattern matching for 13 error types
  - `handleResumeFailed()`: Automatic fallback with process cleanup
  - `logResumeAttempt()`: Structured JSON logging

### IPC Layer
- **claude-code-handlers.ts** (lines 282-288)
  - Forward `session-resume-failed` event to renderer

### Frontend
- **preload/index.ts** (lines 298-311)
  - Type-safe event listener: `onSessionResumeFailed()`

- **preload/index.d.ts** (lines 147-153)
  - TypeScript interface for resume failure event

- **CopilotChat.tsx** (lines 314-330)
  - Listen for resume failures
  - Display system message to user

## Testing Guide

### Manual Testing

#### Test 1: Simulate Session Not Found
```bash
# 1. Start Erfana, open project, send message to Claude
# 2. Note session ID from console logs
# 3. In terminal:
rm ~/.claude/projects/<session-id>*

# 4. In Erfana, approve a tool or toggle planning mode (triggers --resume)
# Expected: System message appears, conversation continues with fresh session
```

#### Test 2: Corrupt Session File
```bash
# 1. Start Erfana, send messages
# 2. Corrupt session file:
echo "CORRUPTED" > ~/.claude/projects/<session-id>.json

# 3. Approve tool or toggle planning mode
# Expected: Resume fails, fresh session starts automatically
```

#### Test 3: Resume Timeout
```bash
# 1. Create large session file (1000+ messages)
# 2. Approve tool
# Expected: After 10 seconds, timeout triggers, fresh session starts
```

#### Test 4: Normal Resume Success
```bash
# 1. Start Erfana, send 5 messages
# 2. Approve a new tool (triggers --resume)
# Expected: Conversation history preserved, no error messages
```

### Automated Testing

#### Log Verification
Check console for structured logs:
```typescript
// Resume attempt log
📝 RESUME ATTEMPT {
  "sessionId": "...",
  "reason": "settings",
  "messageCount": 10,
  "timestamp": "..."
}

// Failure detection log
❌ Resume failed, falling back to fresh session
📝 Failed session ID: abc-123
🆕 Generated fresh session ID: xyz-789 (replacing: abc-123)

// UI notification log
⚠️ Resume failed, notifying renderer
```

#### UI Verification
System message should appear in chat:
```
⚠️ Previous conversation history unavailable. Starting fresh session.
```

### Edge Cases

#### Edge Case 1: Multiple Rapid Restarts
**Scenario**: User rapidly toggles planning mode multiple times

**Expected**: Each attempt logs structured data, timeout prevents hang, only final session becomes active

#### Edge Case 2: Resume Fails During Active Generation
**Scenario**: Claude is generating response when user approves tool

**Expected**: Current response completes, then session restarts with fresh ID

#### Edge Case 3: Fallback Session Also Fails
**Scenario**: Fresh session start fails after resume failure

**Expected**: Error state with recoverable flag, user sees error message

## Monitoring & Diagnostics

### Key Metrics to Track

1. **Resume Success Rate**
   - Count: successful resumes / total resume attempts
   - Target: >95%

2. **Resume Failure Reasons**
   - Breakdown by error pattern
   - Identify common failure modes

3. **Timeout Frequency**
   - How often 10s timeout triggers
   - Indicates session file size issues

4. **Recovery Success Rate**
   - Fresh sessions after resume failure
   - Should be 100% unless system-level issues

### Log Analysis

Search console logs for:
```bash
# Resume attempts
grep "RESUME ATTEMPT" console.log

# Resume failures
grep "Resume failed, falling back" console.log

# Timeout events
grep "Resume operation timed out" console.log

# Recovery attempts
grep "Starting fresh session after resume failure" console.log
```

## Session ID Lifecycle

### Before This Feature
```
[initial] → fresh ID
[settings] → reuse ID + --resume (COULD FAIL)
[planning] → reuse ID + --resume (COULD FAIL)
[recovery] → fresh ID
```

### After This Feature
```
[initial] → fresh ID
[settings] → reuse ID + --resume → [FAILURE] → fresh ID
[planning] → reuse ID + --resume → [FAILURE] → fresh ID
[recovery] → fresh ID (no --resume)
```

## Future Enhancements

### 1. Session File Health Checks
Pre-validate session file before attempting resume:
- Check file exists
- Verify JSON structure
- Validate schema version

### 2. Partial Resume
Instead of full fallback, attempt to load partial history:
- Load first N messages
- Skip corrupted sections
- Preserve recent context

### 3. Session Backup
Before resume attempt, backup current session:
- Copy session file to `.bak`
- Restore on failure if needed
- Automatic cleanup of old backups

### 4. Retry Strategy
Exponential backoff for transient failures:
- Retry once after 1s delay
- Check if error is transient
- Full fallback on persistent failure

### 5. User Control
Settings option for resume behavior:
- Always attempt resume (current)
- Never resume (always fresh)
- Ask user on failure

## Security Considerations

### Session ID Exposure
- Old session ID logged but never shown to user
- Session files remain in `~/.claude/projects/`
- No automatic deletion of failed sessions

### Process Cleanup
- Failed processes killed with SIGKILL
- All listeners removed before kill
- No zombie processes

### Error Message Sanitization
- Generic message shown to user
- Detailed errors only in console logs
- No file paths exposed in UI

## Performance Impact

### Resume Timeout Overhead
- 10-second worst-case delay
- Only affects failed resume attempts
- Normal resume: <100ms overhead

### Process Cleanup
- SIGKILL is instant
- No graceful shutdown delay
- Immediate fallback start

### Memory
- Old streaming message state cleared
- Session stats reset for fresh sessions
- No memory leaks from failed processes

## Related Documentation

- [Claude Code Integration](README.md) - Overview
- [Tool Approval System](tool-approval.md) - Settings trigger
- [UI Features](ui-features.md) - Planning mode toggle
- [IPC Patterns](../ipc-patterns.md) - Event forwarding

## Changelog

**2025-10-14 - STAGE 5: Resume Error Handling**
- Added `isResumeFailure()` with 13 error patterns
- Implemented `handleResumeFailed()` with process cleanup
- Added 10-second timeout protection
- Structured logging with `logResumeAttempt()`
- IPC event forwarding for UI notifications
- System message display in CopilotChat
- Type-safe event listeners in preload layer
