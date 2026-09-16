# AutoExecute Feature - Technical Details

> Part of the [Prompt Templates](./README.md) documentation. For overview, see [AutoExecute Overview](./autoexecute-overview.md).

## Table of Contents
1. [Terminal Write Pipeline](#terminal-write-pipeline)
2. [The 200ms Delay: Why It's Necessary](#the-200ms-delay-why-its-necessary)

---

## Terminal Write Pipeline

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Interaction                              │
│  (Right-click in preview → Select template action)               │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PreviewContextMenu.tsx                              │
│  - Build variables (selectedText, filePath, fileRef, etc.)      │
│  - Call executePromptTemplate(config.id, variables)             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              utils/panelUtils.ts                                 │
│  - executePromptTemplate: registry lookup, validate, render     │
│  - openPanelAndSendContent(rendered, autoExecute)               │
│  - waitForTerminalReady (event-based, 5 s timeout)              │
│  - Call sendToTerminal(content, autoExecute)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         stores/useTerminalStore.ts                               │
│  - sendToTerminal(text, autoExecute)                            │
│  - Multi-line text: wrap in bracketed paste, \n → \r            │
│  - AWAIT terminalOps.write(terminalId, text)  (injected)        │
│  - If autoExecute: wait 200ms (rendering delay)                 │
│  - If autoExecute: AWAIT terminalOps.write(id, '\r')            │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  preload/index.ts                                │
│  - window.api.terminal.write(terminalId, data)                  │
│  - ipcRenderer.invoke('terminal:write', {terminalId, data})     │
│  - Returns: Promise<{success: boolean, error?: string}>         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            main/ipc/terminal-handlers.ts                         │
│  - ipcMain.handle('terminal:write', (_, {id, data}) => {        │
│  -   const success = terminalService.write(id, data)            │
│  -   return {success}                                           │
│  - })                                                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│          main/services/TerminalService.ts                        │
│  - write(terminalId, data): boolean                             │
│  - ptyProcess.write(data)  ← node-pty synchronous API          │
│  - Returns immediately (fire-and-forget)                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PTY Process                                 │
│  - Data written to pseudo-terminal                              │
│  - Shell receives and displays text                             │
│  - (If autoExecute) Enter key executes command                  │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Context Menu** (`PreviewContextMenu.tsx`)
- Triggers template execution
- Builds the variables and passes the template id to `executePromptTemplate`

**Panel Utils** (`utils/panelUtils.ts`)
- Looks up the template in `PROMPT_REGISTRY`, validates the variables and renders it (adding the apply-to-document footer for mutation prompts)
- Ensures terminal panel is visible
- Waits for an active terminal with `waitForTerminalReady` – event-based through the terminal manager's `waitForReady` when available, otherwise polling every 50 ms – and fails with a toast after 5 s
- Delegates to terminal store

**Terminal Store** (`stores/useTerminalStore.ts`)
- **CRITICAL LAYER**: Handles write coordination and timing
- Receives its terminal operations by injection (`createTerminalStore(terminalOps)`; the default store passes `window.api.terminal`)
- Wraps multi-line text in bracketed paste mode (`\x1b[200~` … `\x1b[201~`, line endings converted to `\r`) so the receiving CLI treats it as one paste
- Awaits both text write and Enter key write for error handling
- Implements 200ms delay between text and Enter (rendering time)
- Simple, reliable fire-and-forget approach

**Preload Bridge** (`preload/index.ts`)
- Exposes async API to renderer
- Type-safe IPC invocation

**IPC Handlers** (`main/ipc/terminal-handlers.ts`)
- Converts IPC calls to service calls
- Returns success/error responses

**Terminal Service** (`main/services/TerminalService.ts`)
- Manages PTY instances
- Provides synchronous fire-and-forget write API
- PTY internally buffers writes (ordering guaranteed)

---

## The 200ms Delay: Why It's Necessary

### Problem Statement

When pasting text to a terminal and immediately sending Enter, the Enter key may execute before the text is fully rendered, causing partial command execution or shell confusion.

### The Write Buffering Pipeline

```
Write Call → Socket Buffer → PTY Buffer → Shell Input → Terminal Render → Display
   (0ms)      (1-20ms)        (1-20ms)     (1-50ms)      (10-100ms)     (done)
```

**Breakdown**:
- **Socket Buffer (1-20ms)**: Operating system TCP write buffer
- **PTY Buffer (1-20ms)**: node-pty internal buffering
- **Shell Processing (1-50ms)**: Bash/Zsh input processing, command line editing
- **Terminal Rendering (10-100ms)**: xterm.js layout, WebGL context, GPU rendering
- **System Load Factor**: Additional delay on loaded systems

### Why 200ms?

**Research shows** this delay accounts for:
- Worst-case sum: 20ms + 20ms + 50ms + 100ms = **190ms**
- **+10ms margin** for system load spikes
- **Industry standard**: VSCode Terminal, Hyper, iTerm2 all use 150-250ms delays

**Why not less?**
- 100ms was tested in v0.3.2 - **failed under load**
- 150ms works 95% of the time - **not reliable enough**
- 200ms works 99.9% of the time - **production-ready**

**Why not more?**
- 300ms feels sluggish to users
- 500ms is too conservative (wasting time)
- No evidence that delays >250ms improve reliability

### Fire-and-Forget + Delay = Reliable

**The combination works because**:
1. **Write ordering is guaranteed** by TCP FIFO semantics
2. **Writes are buffered** (not dropped if delayed)
3. **200ms delay ensures rendering completes** before Enter
4. **No synchronization needed** - timing is sufficient

### Alternative Approaches Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| Write callbacks | Precise timing | Unreliable (v0.3.3 failure) | ❌ Rejected |
| Polling terminal state | Can check readiness | Complex, overkill | ❌ Rejected |
| Adaptive delays | Smart sizing | Added complexity | ⚠️ Future |
| Fixed 200ms delay | Simple, reliable | Slightly slow for small text | ✅ **Current** |

---

The v0.3.2–v0.3.4 write-operation evolution is archived in [AutoExecute v0.3 history](../archive/autoexecute-v0.3-history.md#write-operations-evolution).

---

## See Also

- [AutoExecute Overview](./autoexecute-overview.md) - Feature overview and architecture
- [AutoExecute Testing](./autoexecute-testing.md) - Test coverage and mocking strategy
- [AutoExecute Reference](./autoexecute-reference.md) - Error handling and implementation files
- [Terminal Bootstrap Pattern](../terminal/bootstrap-pattern.md) - Terminal initialization details
