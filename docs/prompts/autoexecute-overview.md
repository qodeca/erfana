# AutoExecute Feature - Overview & Architecture

> Part of the [Prompt Templates](./README.md) documentation. For technical details, see [AutoExecute Technical](./autoexecute-technical.md).

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [AutoExecute Feature](#autoexecute-feature)
3. [Summary](#summary)
4. [Related Documentation](#related-documentation)

---

## Overview & Architecture

The prompt template system sends the selected text, with instructions, to the CLI agent running in the terminal, through context menu actions. This guide documents the technical implementation of the **autoExecute feature**, which automatically presses Enter after pasting a prompt into the terminal.

### Lesson kept from the v0.3.x fixes

Waiting on node-pty's write callback hung the IPC reply ("reply was never sent"): the callback only means the socket buffer flushed, not that the shell or the renderer is ready, and it did not fire reliably. Writes are fire-and-forget, followed by a fixed 200ms delay before Enter – do not bring the callback back. For why 200ms and the alternatives considered, see [AutoExecute Technical](./autoexecute-technical.md#why-200ms).

The version-by-version fix history now lives in [AutoExecute v0.3 history](../archive/autoexecute-v0.3-history.md).

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
1. Pastes the rendered prompt text into the active terminal (multi-line text as one bracketed paste)
2. Waits for the write IPC call to return
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
area: markdown-preview
subArea: context-menu
name: Explain
icon: maximize2
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
