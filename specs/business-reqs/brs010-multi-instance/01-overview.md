# BRS-010: Multiple independent instances

## Overview

Enable users to run multiple independent Erfana instances to work on different projects side-by-side, matching VS Code's multi-instance behavior. When attempting to open an already-open project, Erfana focuses the existing window instead of showing an error, providing a seamless user experience.

## Purpose

Modern development workflows often require working across multiple related projects simultaneously (frontend + backend, microservices, monorepos with multiple packages). The current single-window architecture forces users to switch contexts repeatedly, reducing productivity and increasing cognitive load. This feature enables parallel project work while preventing conflicts from the same project being open in multiple instances.

## Problem statement

**Current behavior:**
- Erfana runs as a single-window application
- Opening a new instance creates a new Electron process (no single-instance lock enforced)
- Settings and recent projects shared via electron-store across processes
- No mechanism prevents opening the same project in multiple windows
- File watchers are singleton per-process and independent

**Impact:**
- Developers cannot work on multiple projects simultaneously without switching
- Risk of file conflicts if same project opened in multiple instances
- Lost productivity from constant context switching
- Inconsistent behavior compared to industry-standard tools (VS Code, IntelliJ)

## Goals

| Goal | Priority | Success metric |
|------|----------|----------------|
| G1: Enable multi-project work | P0 | Users can open different projects in separate windows |
| G2: Prevent duplicate conflicts | P0 | Same project cannot open in multiple instances |
| G3: Seamless UX | P1 | Window focusing replaces error dialogs |
| G4: Cross-platform support | P1 | Works consistently on macOS, Windows, Linux |
| G5: Crash resilience | P2 | Stale locks auto-cleaned on restart |

## Non-goals

The following are explicitly out of scope for the initial implementation:

- **Live settings sync**: Settings visible after restart, not in real-time
- **Duplicate command**: No "Open in New Window" for same project
- **CLI project opening**: `erfana /path/to/project` not supported initially
- **Watcher coordination**: Each instance watches independently

## Scope

### In scope

| Component | Changes |
|-----------|---------|
| Main process | Project lock lifecycle, window focusing |
| Lock service | New `ProjectLockService` for lock management |
| IPC handlers | Lock acquisition, cross-instance messaging |
| Settings service | Shared via electron-store (existing) |
| Quit handlers | Lock release on app quit |
| Preload | Expose lock APIs to renderer |

### Out of scope

| Component | Reason |
|-----------|--------|
| Renderer state | No multi-project state needed |
| File watchers | Already independent per process |
| Terminal service | Already tracks by webContentsId |
| Editor state | Already per-file |

## Success criteria

1. **Functional**: User can launch N instances, each with a different project
2. **Conflict prevention**: Duplicate project attempt focuses existing window
3. **Performance**: Lock operations complete in <50ms
4. **Recovery**: Crashed instance locks cleaned up within 60 minutes
5. **Compatibility**: Existing single-instance workflows unchanged

## Related

- **Issue**: [#27](https://github.com/qodeca/erfana/issues/27)
- **Similar**: VS Code multi-window, Atom multi-window, Sublime Text projects
- **Existing patterns**: `quit-handlers.ts`, `SettingsService.ts`, `electron-store`
