# AutoExecute Feature - Overview & Architecture

> Part of the [Prompt Templates](./README.md) documentation. For technical details, see [AutoExecute Technical](./autoexecute-technical.md).

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [AutoExecute Feature](#autoexecute-feature)
3. [Summary](#summary)
4. [Related Documentation](#related-documentation)

---

## Overview & Architecture

The prompt template system enables AI-powered text operations through context menu actions. This guide documents the technical implementation of the **autoExecute feature**, which automatically presses Enter after pasting a prompt into the terminal.

### What Was Fixed

#### v0.3.3 - Initial autoExecute Implementation

**Problem**: The "Explain", "Modify", and "Ask" context menu actions inconsistently executed the Enter key after pasting prompts to the terminal.

**Root Causes**:
- Fire-and-forget terminal writes (no completion confirmation)
- No terminal initialization state checking
- Race conditions between terminal bootstrap and prompt execution
- Insufficient delay (100ms) between text write and Enter key
- IPC writes had no ordering guarantees

**Solution**: Implemented Promise-based writes with completion callbacks, terminal initialization polling, enhanced error handling, and increased reliability delays.

#### v0.3.4 - Simplified Fire-and-Forget (Current)

**Problem**: The v0.3.3 solution was over-engineered - Promise-based writes with callbacks caused IPC handler hangs ("reply was never sent" errors) because node-pty's write callback wasn't firing reliably.

**Root Cause**: The node-pty write callback only indicates socket buffer flush, NOT completion of rendering or shell readiness. This made it unreliable for synchronization.

**Research Findings**:
- Fire-and-forget writes are the industry standard (VSCode, Hyper, all major terminals)
- Write ordering is guaranteed by TCP/socket FIFO semantics
- 200ms delay is well-calibrated: PTY buffering (1-20ms) + shell processing (1-50ms) + GPU rendering (10-100ms) + system load margin
- No simpler reliable alternative exists

**Solution**: Reverted to synchronous fire-and-forget writes, removed initialization polling complexity, kept the 200ms delay which is sufficient and necessary.

### Key Architectural Changes

| Layer | v0.3.2 (Before) | v0.3.3 (Complex) | v0.3.4 (Simplified) |
|-------|-----------------|------------------|---------------------|
| **TerminalService** | Sync writes | Promise writes with callbacks | Sync writes (fire-and-forget) |
| **IPC Handlers** | `ipcMain.on` | `ipcMain.handle` (async) | `ipcMain.handle` (sync) |
| **Preload Bridge** | Void return | Promise<{success, error}> | Promise<{success, error}> |
| **Terminal Store** | 100ms delay | Polling (5s) + 200ms delay | 200ms delay only |

---

## AutoExecute Feature

### What It Does

When `autoExecute: true` is set in a prompt template's YAML frontmatter, the system:
1. Pastes the rendered prompt text into the active terminal
2. Waits for write completion
3. Waits 200ms for text rendering
4. Sends Enter key (`\r`) to execute the command

### When to Use

**Use autoExecute for**:
- Trusted operations (e.g., "Explain this code", "Modify selection")
- Operations where immediate execution is expected

**Don't use autoExecute for**:
- Commands that require user review before execution
- Multi-step processes requiring user input

### Configuration

In template YAML frontmatter:

```yaml
---
id: explain-selection
label: Explain
autoExecute: true  # ← Enables automatic Enter key press
---
```

### User Experience

**With autoExecute (true)**:
1. User selects text in preview
2. User right-clicks → "Explain"
3. Prompt appears in terminal **and executes immediately**
4. Claude/AI tool processes the request

**Without autoExecute (false)**:
1. User selects text in preview
2. User right-clicks → template action
3. Prompt appears in terminal **but waits**
4. User reviews command
5. User manually presses Enter

---

## Summary

The autoExecute feature evolved through three major versions:

**v0.3.2**: Simple fire-and-forget with 100ms delay - **unreliable**
**v0.3.3**: Promise-based with callbacks and polling - **over-engineered, caused hangs**
**v0.3.4**: Simplified fire-and-forget with 200ms delay - **reliable and maintainable**

### Key Learnings

✅ **Simplicity wins**: Fire-and-forget is industry standard for good reason
✅ **Timing > Synchronization**: 200ms delay is more reliable than callbacks
✅ **Research matters**: Understanding PTY pipeline prevented over-engineering
✅ **Less code = fewer bugs**: Removed 100+ lines, improved reliability

### The Winning Formula

```
Fire-and-Forget Writes + 200ms Delay + TCP Ordering = Reliable AutoExecute
```

This pattern is applicable to any terminal automation requiring sequential operations with rendering time.

---

## Related Documentation

### Within Prompts
- [Template Syntax](./template-syntax.md) - YAML frontmatter and variable syntax
- [Template Examples](./examples.md) - Sample templates and use cases
- [Prompt Templates README](./README.md) - User-facing overview
- [AutoExecute Technical](./autoexecute-technical.md) - Write pipeline and 200ms delay details
- [AutoExecute Testing](./autoexecute-testing.md) - Test coverage and mocking strategy
- [AutoExecute Reference](./autoexecute-reference.md) - Error handling and implementation files

### Terminal & Architecture
- [Terminal Bootstrap Pattern](../terminal/bootstrap-pattern.md) - Three-flag initialization
- [Terminal README](../terminal/README.md) - Terminal architecture overview
- [IPC Patterns](../ipc-patterns.md) - IPC communication patterns
- [Testing Strategy](../testing/README.md) - Test organization and coverage

### External Resources
- [node-pty Documentation](https://github.com/microsoft/node-pty) - PTY library reference
- [Electron IPC Guide](https://www.electronjs.org/docs/latest/tutorial/ipc) - IPC patterns
- [Zustand Documentation](https://docs.pmnd.rs/zustand) - State management
- [Vitest Documentation](https://vitest.dev/) - Test framework
