# Terminal Panel

Integrated terminal emulator with xterm.js and node-pty for native shell access within Erfana.

## Overview

**Status**: ✅ FULLY IMPLEMENTED

The Terminal Panel provides a full-featured terminal emulator using:
- **xterm.js v6.0.0** - Modern terminal emulator for web
- **node-pty v1.0.0** - Native pseudo-terminal (PTY) backend
- **WebGL rendering** - Hardware-accelerated rendering for performance

## Quick Access

- **Activity Bar**: Terminal icon in right sidebar (bottom)
- **Keyboard**: `Cmd/Ctrl+J` - Toggle terminal panel
- **Maximize**: ⛶ button in panel header / `Cmd/Ctrl+Shift+M` - Expand the terminal over the editor
- **Scroll to Bottom**: ⬇️ button in panel header - Jump to latest output
- **Scroll Lock**: 🔒 button in panel header - Lock scroll to always stay at bottom
- **Restart**: 🔄 button in panel header - Kill and restart terminal session

## Features

### Maximize Over Editor

A toggle maximizes the terminal to cover the editor/tabs area, leaving only the project panel and terminal visible (hide the project panel with `Cmd/Ctrl+B` for a full-screen terminal). Built for heavy terminal work on small screens.

**Behavior**:
- Trigger with `Cmd/Ctrl+Shift+M` or the maximize/restore button in the panel header
- From a closed terminal, the shortcut opens it and maximizes in one action
- Opening any file (project tree, terminal file links, dialogs, markdown links) auto-restores the editor
- Maximizing moves focus to the terminal and announces the change to screen readers; restoring returns focus to the editor
- Independent of the project panel — both your scenarios (project + terminal, terminal-only) fall out of `Cmd/Ctrl+B`
- Not persisted: every launch and project switch starts collapsed

**Implementation**:
- Store: `useActivityBarStore.terminalExpanded` (ephemeral; `toggleTerminalExpanded`, `setTerminalExpanded`)
- Layout: `AppDockLayout` hides the `center-editor` splitview panel and relaxes the terminal's max-size cap on a transition; pure decision helpers in `terminalExpand.ts` (unit-tested)
- Auto-collapse: editor dockview `onDidActivePanelChange` hook

**Files**:
- `src/renderer/src/components/DockLayout/AppDockLayout.tsx`
- `src/renderer/src/components/DockLayout/terminalExpand.ts`
- `src/renderer/src/stores/useActivityBarStore.ts`

### Claude Code context status bar (macOS + Windows)

A thin status bar pinned to the bottom of a terminal panel — its height matches the Project sidebar footer (`var(--header-height)`) — visible **only** while Claude Code (`claude` CLI) is actively running in that panel; hidden otherwise. It shows the friendly model name (e.g. "Opus 5"), a 200k-vs-1M context-window badge, the context-used percentage (pinned to the right edge), and a green/orange/red `role="meter"` progress bar that fills the available width between the badge and the percentage; a native-title hover tooltip reveals exact token counts (e.g. "84k / 200k", with a trailing `(inferred)` when the 1M badge rests on the capability registry alone). Display-only, always on.

**Behavior**:
- Data is read **non-invasively** (read-only) from Claude Code's own transcript JSONL under `~/.claude/projects/<encoded-cwd>/*.jsonl` — Erfana never writes the user's Claude Code config
- Per-panel detection inspects the panel's own PTY child-process tree for a `claude` process (macOS `ps`/`lsof`; Windows a single static `powershell.exe` `Get-CimInstance Win32_Process` snapshot, BFS over the tree) and uses that process's cwd to locate the transcript (Windows v1 falls back to the panel's spawn cwd rather than Claude's live cwd)
- Window size resolves through one shared model-id parser + exact-id capability registry (`claudeStatus/modelId.ts`, [#41](https://github.com/qodeca/erfana/issues/41); table verified 2026-08-07 against platform.claude.com + code.claude.com): **1M** for `claude-opus-5` / `4-8` / `4-7`, `claude-sonnet-5`, `claude-fable-5` and Mythos; **200k** for `claude-opus-4-6` and older Opus, `claude-sonnet-4-6` and older Sonnet, and all Haiku. The two 4.6 rows are **plan-conditional defaults, not ceilings** — Opus 4.6 runs at 1M where the plan includes extended context (auto-granted on Max/Team/Enterprise) and Sonnet 4.6 runs at 1M with usage credits, which no plan includes by default, Max included. 200k is the metered default in both cases, and an entitled session self-corrects via R2 once observed usage crosses 200k
- Extrapolation for an unrecognised id is **per major generation, not family-wide** (design §7.2.1). `newestByMajor` is consulted first and, when the id's major is known, it *decides*: the id inherits **that major's** newest known window within `MAX_MINOR_LOOKAHEAD` (4) minor releases, and the family-wide value is never reached. So `claude-sonnet-4-7` reports **200k**, inheriting Sonnet 4.6, even though the family's newest known entry `claude-sonnet-5` is 1M. Only an **unknown** major inherits the family's newest window, and only `MAX_MAJOR_LOOKAHEAD` (1) generation ahead. Unknown families and bare aliases (`opus`) get no opinion and default to 200k
- The window is **not** purely a property of the model id — plan and provider decide it too (Bedrock / Google Cloud / Foundry cap Opus at 200k). Sizing is therefore a **strict first-match chain, not a set of independent overrides** (`detectWindowDetail`, design §8): **R2** observed usage > 200k → **R0** explicit `/model …[1m]` → **R0'** explicit `/model <id>` with no marker (forces 200k) → **R1m** a `[1m]` marker on the id itself → **R1** the capability registry → **R3** a `settings.json` `[1m]` model → **R4** default 200k. R2 leads because a 200k window physically cannot hold 250k tokens. R1 precedes R3 deliberately: only a registry **1M** short-circuits, so a registry 200k falls through and a settings marker can still upgrade it
- The **environment rule is gone**. An earlier `R_ENV` forced 200k from a spawn-env signal; it was withdrawn because three of its four signals were unreachable by construction (`TerminalService.cleanEnvironment` strips `CLAUDE_CODE_*` from the merged spawn env), the survivor (`ANTHROPIC_BASE_URL`) is a routing fact rather than a capacity fact, and the rule outranked explicit user configuration. A narrowed, settings-based replacement is tracked as [#48](https://github.com/qodeca/erfana/issues/48)
- Only the R1 answer is **provisional**: the tooltip marks it `(inferred)`, the meter's `aria-valuetext` appends the same marker after the token counts, it is recomputed on every refresh, and the sticky-window bit never latches it — only a corroborated 1M (R2 observed usage, R0 `/model …[1m]`, R1m a `[1m]` on the id, R3 `settings.json` `[1m]`) latches
- Colour bands track usage against the active window: a true green safe band (`--color-context-safe` #3fb950, distinct from the Qodeca-lime brand colour) below 30%, orange at 30–60%, red at ≥60% (on a 1M window that's 300k / 600k tokens; on 200k it's 60k / 120k)
- On any detection/parse failure the bar hides gracefully — no error, no stale data
- macOS and Windows are both supported (Windows support was cut for 0.16.0, which was never tagged; it first reached users in v0.16.3 — pre-migration issue #217); on Linux the process detector is a no-op so the bar never appears there

See the full design in [`docs/designs/216-claude-status-bar.md`](../designs/216-claude-status-bar.md); model-id parsing and window sizing are superseded by [`docs/designs/41-model-capability-registry.md`](../designs/41-model-capability-registry.md). IPC: `claude-status:register` / `:unregister` / `:nudge` (invoke) and `claude-status:changed` (main → renderer push).

### Auto-Open on Project Load (v0.6.3)

Terminal panel automatically opens when a project loads, providing immediate shell access.

**Behavior**:
- Opens automatically on Recent Projects selection or File > Open
- Tracks user intent: if user closes terminal, it stays closed until next project load
- Ephemeral state (`terminalUserClosed`) resets on project change

**Implementation**:
- Hook: `useAutoOpenTerminal` integrates with `useProjectChangedEffect`
- Store: `useActivityBarStore.terminalUserClosed` tracks manual closes
- Reset: `resetTerminalUserClosed()` called on project change

**Files**:
- `src/renderer/src/hooks/useAutoOpenTerminal.ts`
- `src/renderer/src/stores/useActivityBarStore.ts`

### Clipboard Support (v0.4.7)

Full copy/paste operations with keyboard shortcuts and context menu.

**Keyboard Shortcuts**:
- **Smart Ctrl/Cmd+C**: Copies text when selected, sends SIGINT when no selection
- **Cmd+V / Ctrl+V**: Paste (handled natively by xterm.js)
- **Ctrl+Shift+C / Ctrl+Shift+V**: Explicit copy/paste (Windows/Linux style)

**Context Menu**:
- Right-click opens context menu with Copy and Paste options
- Copy is disabled when no text is selected
- Platform-specific shortcut display (⌘C/⌘V on macOS, Ctrl+C/Ctrl+V on Windows)

**Behavior**:
- Selection preserved after copy (VS Code behavior)
- Toast notification on copy success
- Pure logic extraction pattern: `terminalClipboard.logic.ts` for testability

**Central clipboard service (#203)**: terminal copy/paste now reads and writes through the shared renderer `textClipboard` service (`src/renderer/src/services/textClipboard.ts` → main-process `clipboard` module over IPC), the single transport-error chokepoint for all text surfaces. The SIGINT-vs-copy decision table in `terminalClipboard.logic.ts` (#28/#122) is **unchanged** — only the underlying read/write transport moved. See [API Services § Clipboard service](../api-services.md#clipboard-service-203).

**Files**:
- `src/renderer/src/components/Panels/Terminal/terminalClipboard.logic.ts`
- `src/renderer/src/components/Panels/Terminal/useTerminalClipboard.ts`
- `src/renderer/src/components/Panels/Terminal/TerminalContextMenu.tsx`
- `src/renderer/src/services/textClipboard.ts` (shared transport)

### Smart File Path Links (v0.5.0)

Clickable file path links in terminal output with intelligent path resolution.

**Base Features**:
- Detects absolute, relative, and project-relative paths
- Supports `@`-prefixed paths from CLI tools (e.g., `@src/main/index.ts`) – the `@` is stripped and the underlying path is opened; `@scope/package` references (e.g., `@types/node`) are preserved and not treated as file paths
- Supports line:column notation (`:42:10`, `(15,3)`) and `:line-line` range notation (e.g., `:22-24`) – navigates to the first line of the range
- Path validation with LRU cache (100 entries, 30s TTL)
- Click to open file in editor at specified location
- Multi-line link ranges – links span correctly across xterm-wrapped and CLI-wrapped lines

**Smart Resolution**:
- Falls back to filename search when exact path not found
- FilePickerDialog for disambiguation when multiple files match
- Keyboard navigation (Arrow Up/Down, Enter to select, Escape to cancel)

**Paths with Spaces Support** (VS Code-style fallback matchers):
- Detects paths with spaces on their own line
- Python error format: `File "/path/with spaces/file.py", line 42`
- Windows paths: `C:\Program Files\My App\app.exe`
- Bullet point lists: `- /path/to my/project/file.ts`
- Based on VS Code Issue #97941 and PR #43733

**Multi-line Path Detection** (two-phase joining):
- **Phase 1 – xterm wrapping**: Joins lines marked `isWrapped` by xterm.js when content exceeds `terminal.cols`
- **Phase 2 – CLI-wrap joining**: Detects CLI tool output split across buffer lines with explicit `\n` + indentation (e.g., `Write(path/fi` + `       le.md)`)
- Three CLI patterns: tool output (`Write(`, `Read(`, etc.), `Saved to`/`Wrote to`, `@`-prefixed paths
- Phase 2 replaces Phase 1 data when a CLI group is found (mutually exclusive – CLI-formatted lines are short)
- Position mapping via `joinedPosToBuffer()` converts joined text positions back to buffer coordinates

**Architecture** (Pure Logic Extraction):
- `filePathLinks.logic.ts`: Path detection, fallback matchers for paths with spaces
- `cliWrapJoin.logic.ts`: CLI-wrap group detection (`findCliWrapGroup`, `joinedPosToBuffer`)
- `filenameIndex.ts`: Map-based O(1) filename lookup
- `pathScoring.ts`: Candidate ranking algorithm
- `smartPathResolver.logic.ts`: Resolution orchestration
- `useFilenameIndex.ts`: Lazy index management hook
- `FilePickerDialog.tsx`: Disambiguation UI component
- `useTerminalFileLinks.ts`: Hook integrating all detection phases

**Files**:
- `src/renderer/src/utils/cliWrapJoin.logic.ts` – Pure logic (no React/xterm deps)
- `src/renderer/src/utils/cliWrapJoin.logic.test.ts` – 51 tests
- `src/renderer/src/hooks/useTerminalFileLinks.ts` – Integration hook
- `src/renderer/src/components/Panels/Terminal/FileLinks/`

### Drag-Drop File Path Insertion (v0.6.5)

Drag files or folders from project tree or Finder to insert shell-escaped paths into the terminal.

**Supported Sources**:
- **Internal drag** (project tree): Uses @dnd-kit with bounding rect detection
- **External drag** (Finder/file manager): Uses native document-level event listeners with capture phase

**Behavior**:
- Single file/folder: Inserts quoted path at cursor position
- Multiple items: Paths joined with newlines
- Folders: Inserts folder path (not contents)
- Visual feedback: Drop target indicator appears on terminal panel

**Path Escaping** (POSIX shell-safe):
- Single-quote wrapping for all paths
- Null byte sanitization
- Special characters properly escaped

**Example**:
```bash
# Single file drag
'/Users/demo/Projects/erfana/src/main/index.ts'

# Multiple files drag
'/Users/demo/file1.md'
'/Users/demo/file2.md'
```

**Architecture**:
- `useTerminalDrop.ts`: Hook combining @dnd-kit sensor and native event handling
- `terminalDrop.logic.ts`: Path escaping and formatting logic
- CSS class `.terminal-drop-active`: Visual drop indicator styling

**Files**:
- `src/renderer/src/components/Panels/Terminal/useTerminalDrop.ts`
- `src/renderer/src/components/Panels/Terminal/terminalDrop.logic.ts`

**Related issues**:
- #85 - Terminal drag-drop file path insertion

### Screenshot Capture (v0.6.5 macOS, cross-platform via #164)

Capture screenshots directly from the terminal toolbar with file paths automatically pasted into the terminal. macOS uses the native `/usr/sbin/screencapture` binary; Windows uses Electron's `desktopCapturer` API + an in-app area-select overlay window. Every other platform gets `UnsupportedCapturer`, which fails each call with `SCREENSHOT_NOT_SUPPORTED`.

**Toolbar Buttons** (visible on macOS + Windows; hidden on Linux):
- **Capture Screen** (Camera icon): captures the chosen display immediately (or shows a picker when there is more than one display)
- **Capture Window** (AppWindow icon): macOS opens the native OS picker; Windows opens an in-app thumbnail-grid `WindowPickerDialog`
- **Capture Area** (BoxSelect icon): macOS opens the OS crosshair; Windows opens a transparent always-on-top `ScreenshotOverlayWindow` for drag-to-select

**Behavior**:
- Screenshots saved to OS temp directory as PNG (`erfana-screenshot-{timestamp}.png`)
- File path automatically pasted to the active terminal with shell-safe escaping
- Success/error toasts provide user feedback
- 30 s timeout for the macOS native selection, 60 s for the cross-platform overlay (`SCREENSHOT.OVERLAY_TIMEOUT_MS`)
- Loading spinner during capture; window picker shows a "Looking for capturable windows…" state while sources resolve

**macOS Screen Recording permission (grant-and-relaunch flow)**:

When a macOS capture returns `SCREENSHOT_PERMISSION_DENIED`, the renderer shows `ScreenPermissionDialog` instead of a dead-end error toast. On every other platform the same error code still falls back to a toast.

- **Never gated by a pre-check.** The capture is always attempted first; the dialog appears only after the OS itself denies it. A stale permission read must never block a user who has actually been granted access – `status` from `screenshot:getScreenPermission` only tailors the wording.
- **Silent-denial reclassification (the case users actually hit).** On modern macOS a *denied* `/usr/sbin/screencapture` exits 0 and simply writes no file – indistinguishable from a user pressing Escape. `MacScreenshotCapturer` therefore re-classifies "process succeeded but produced no file" from `SCREENSHOT_CANCELLED` to `SCREENSHOT_PERMISSION_DENIED` when `systemPreferences.getMediaAccessStatus('screen')` reads `'denied'`. That reclassification is what opens this dialog – without it the denial would surface as a silent no-op.
- **Two actions**, both backed by `system:*` IPC: *Open settings* (`system:openScreenRecordingSettings`) opens the Screen Recording privacy pane, and *Relaunch* (`system:relaunchApp`) restarts Erfana – macOS applies a fresh Screen Recording grant only to a newly-launched process, so a relaunch is genuinely required, not a convenience.
- Dismissable by Close, Escape, or backdrop click.

> A repeated "asks every time" prompt despite a granted permission is usually a stale TCC record on the machine, not an app bug. Reset it with `tccutil reset ScreenCapture com.erfana.app` and reboot.

**Architecture (strategy pattern, #164)**:
- `IScreenshotCapturer` interface in `src/main/services/screenshot/types.ts`
- `MacScreenshotCapturer` wraps the existing `screencapture` flow
- `DesktopCapturerScreenshotCapturer` uses `desktopCapturer.getSources()` + `nativeImage.toPNG()` for full-resolution captures, and `nativeImage.crop()` for area mode
- `AreaSelectOverlay.selectArea()` (in `ScreenshotOverlayWindow.ts`) spawns **one frameless transparent always-on-top `BrowserWindow` per attached display** (`screen.getAllDisplays()` → `createOverlayForDisplay`), each with its own 5 s `did-finish-load` watchdog so a slow first load on one display cannot block the round. Whichever overlay the user drags on first resolves the selection; the rest are destroyed synchronously. It then awaits the renderer's `screenshot:areaSelected` / `screenshot:areaCancelled` IPC and tears the round down. A per-instance `isActive` guard rejects overlapping calls, and a per-round 60 s timeout (`SCREENSHOT.OVERLAY_TIMEOUT_MS`) covers every overlay at once. Listeners are attached to each overlay's own `webContents.mainFrame.ipc` (not global `ipcMain`) and every payload must carry the round's per-capture UUID token, so cross-window messages are rejected.
- `ScreenshotService` is a thin dispatcher that takes its `IScreenshotCapturer` **by constructor injection**. Platform routing lives in the `pickCapturer(platform)` / `createScreenshotService(capturer?, platform?)` factory pair – that factory is the DI seam tests use to inject a stub instead of mocking `process.platform`
- `IScreenshotService.getScreenRecordingPermission()` returns the advisory macOS `ScreenRecordingPermission` (`granted` / `denied` / `not-determined` / `restricted` / `unknown`) read from `systemPreferences.getMediaAccessStatus('screen')`; it reports `'unknown'` off macOS and is never used to gate a capture
- Renderer state lives in `useScreenshotCapture` (was macOS-only; the boolean flag was renamed `isMacOS` → `isScreenshotSupported` to reflect the cross-platform reality)
- The overlay re-uses the main renderer bundle via a hash route (`#overlay/screenshot?displayId=…`); `main.tsx` mounts `ScreenshotOverlay` instead of `App` when the hash is present

**Files**:
- `src/main/services/ScreenshotService.ts` (dispatcher)
- `src/main/services/screenshot/MacScreenshotCapturer.ts`
- `src/main/services/screenshot/DesktopCapturerScreenshotCapturer.ts`
- `src/main/services/screenshot/ScreenshotOverlayWindow.ts`
- `src/main/services/screenshot/sharedHelpers.ts`
- `src/main/services/screenshot/types.ts`
- `src/main/ipc/screenshot-handlers.ts` (now also `screenshot:enumerateWindows` and `screenshot:getScreenPermission`; every channel gated by `validateMainRendererSender`)
- `src/shared/ipc/screenshot-schema.ts` (adds `WindowSource`, `AreaSelection`, `windowId`, `ScreenRecordingPermissionSchema` / `ScreenRecordingPermission`)
- `src/shared/ipc/screenshot-channels.ts` (channel constants incl. `screenshot:getScreenPermission`, plus the overlay hash-route helpers)
- `src/renderer/src/components/Screenshot/ScreenshotOverlay.tsx` + `.css`
- `src/renderer/src/components/Dialog/WindowPickerDialog.tsx` + `.css`
- `src/renderer/src/components/Dialog/ScreenPermissionDialog.tsx` (macOS grant-and-relaunch flow)
- `src/shared/ipc/system-channels.ts` + `src/main/ipc/system-handlers.ts` (open-settings / relaunch, sender-gated)
- `src/renderer/src/components/Panels/TerminalPanel.tsx` (renamed gate, removed duplicated effect)
- `src/renderer/src/main.tsx` (hash-routed overlay mount)

**Related issues**:
- #86 - original macOS screenshot capture
- #164 - Windows Phase 3 screenshot parity

### Camera Photo Capture (v0.7.0)

Capture photos from connected cameras directly from the terminal toolbar.

**Toolbar Button**:
- **Camera** (Camera icon): Opens camera dialog with live preview

**Dialog Features**:
- Live camera preview with device selector (when multiple cameras available)
- "Mirror preview" checkbox below the preview – preview-only, remembered per camera, disabled until the preview is live
- Hot-plug support: detects camera connect/disconnect, debounced 300 ms. The listener lives on the terminal panel, not the dialog, so a camera plugged in while the dialog is closed is already known by the time it opens
- Fallback labels ("Camera 1", "Camera 2") when device labels unavailable
- Keyboard: Escape closes; Enter captures only while the Capture button itself has focus (Enter on Cancel cancels, as expected)
- Shutter animation on capture

**Behavior**:
- Photos saved to OS temp directory as JPEG, named from the **local** date/time: `erfana-camera-YYYY-MM-DD-HHMMSS.jpg` (e.g. `erfana-camera-2026-08-07-143052.jpg`)
- File path automatically pasted to active terminal with proper quoting
- Success/error toasts provide user feedback
- 20MB size limit for photo data
- **Preview is un-mirrored by default; the saved file is never mirrored.** Every camera opens with a true preview, so what you see is what lands in the JPEG – which is what the document-scanning / OCR use case needs, since text in frame stays readable. A **Mirror preview (saved photo is never mirrored)** checkbox under the preview flips the preview horizontally for selfie-style framing; the choice is stored per camera (by `deviceId`) and survives restarts, and the saved JPEG stays un-mirrored either way. The checkbox is disabled while no preview is running. There is deliberately **no** automatic front/selfie-camera detection – macOS does not expose which way a camera faces
- **Preview shows the whole frame.** The preview is a 16:9 box that fits the entire captured frame inside it; it is no longer cropped to a 4:3 window, so the framing on screen matches the saved photo. Black letterbox bars appear when the camera's own aspect ratio differs – an accepted trade for showing everything that will be captured

**Use Cases**:
- Quick attachment of photos in chat/command workflows
- Document scanning and OCR workflows
- Visual context for bug reports

**Architecture**:
- `CameraService.ts`: Main process service for JPEG file saving
- `camera-handlers.ts`: IPC handlers for renderer communication
- `camera-schema.ts`: Zod schemas for IPC types
- `useCameraCapture.ts`: React hook for camera access and capture. The `devicechange` effect is deliberately registered **once**, with an empty dependency array, reading `refreshDevices` / `selectedDeviceId` / the stream through refs. Do not "fix" this by adding those to the dependency array to satisfy `react-hooks/exhaustive-deps`: the cleanup cancels the pending 300 ms debounce, so a re-render inside that window would silently drop a queued enumeration and never re-arm it, leaving a hot-plugged camera invisible. Covered by the regression test "should still enumerate when a re-render lands inside the debounce window"
- `useCameraMirrorPreference.ts` + `useCameraMirrorStore.ts`: per-camera mirror-preview preference, persisted to `localStorage` under `erfana-camera-mirror-state`; preview-only, never consulted by the capture path
- `CameraDialog.tsx`: Modal dialog with preview and controls

**Files**:
- `src/main/services/CameraService.ts`
- `src/main/ipc/camera-handlers.ts`
- `src/shared/ipc/camera-schema.ts`
- `src/renderer/src/hooks/useCameraCapture.ts`
- `src/renderer/src/hooks/useCameraMirrorPreference.ts`
- `src/renderer/src/stores/useCameraMirrorStore.ts`
- `src/renderer/src/components/Dialog/CameraDialog.tsx`
- `src/renderer/src/components/Panels/TerminalPanel.tsx` (toolbar button)

**Related issues**:
- #93 - Camera photo capture from terminal toolbar
- #42 - Un-mirrored preview by default, per-camera mirror toggle, full-frame preview

### Scroll Lock Toggle (v0.6.0)

Proactive scroll protection via a toggle button that locks terminal to always stay at bottom.

**Behavior**:
- Toggle button in terminal toolbar (also available in ChatBubble header)
- When ON: Blocks all scroll-up attempts (mouse wheel, PageUp/Home/ArrowUp, scrollbar drag)
- When OFF: Normal scroll behavior restored
- Default: OFF (user enables when needed)
- Ephemeral: State resets on app restart (not saved to settings)

**Icons**:
- 🔓 `LockKeyholeOpen` - Unlocked (scroll lock disabled)
- 🔒 `LockKeyhole` - Locked (scroll lock enabled, with accent color highlight)

**Implementation**:
Three complementary mechanisms ensure scroll lock works reliably:
1. **Wheel event handler**: Intercepts `WheelEvent`, blocks `deltaY < 0` (scroll up)
2. **Keyboard handler wrapper**: Blocks PageUp/Home/ArrowUp keys when locked
3. **Polling watcher**: 100ms interval detects scrollbar drag, snaps back to bottom

**Architecture** (Pure Logic Extraction):
- `useScrollLock.ts`: Hook encapsulating all three blocking mechanisms
- `useTerminalStore.scrollLocked`: Global boolean state (single terminal architecture)
- `TerminalPortalContext.TerminalControls`: `isScrollLocked()`, `toggleScrollLock()` for ChatBubble access

**Coordination**:
- When lock engages, calls `resetAll()` from `useScrollAnomalyRecovery` to clear recovery queue
- Prevents conflict between proactive lock and reactive recovery mechanisms

**Files**:
- `src/renderer/src/hooks/useScrollLock.ts` (130 lines)
- `src/renderer/src/hooks/useScrollLock.test.ts` (22 tests)

**Related issues**:
- #60 - Add scroll-lock button to terminal toolbar
- #12, #22, #52 - Previous reactive scroll recovery (now complemented by proactive lock)

### Forced Scroll-to-Bottom After Prompt Execution (v0.5.4)

Automatic scroll to bottom 1 second after executing prompt templates, respecting user scroll intent.

**Behavior**:
- Terminal scrolls to bottom 1 second after prompt execution completes
- Skips scroll if user manually scrolled during the 1-second delay window
- Works with all prompt templates: Explain, Modify, Ask, diagram chat, Mermaid directions, import organization

**Architecture** (Pure Logic Extraction):
- `promptScrollScheduler.logic.ts`: Timestamp-based scheduling with user scroll detection
- `didUserScrollRecently()`: Checks if user scrolled within delay window
- `scheduleScrollIfNeeded()`: Coordinates scroll with terminal readiness and user intent
- Integrates with `useScrollAnomalyRecovery` via `lastUserScrollTsRef`

**Edge Cases Handled**:
- Terminal not ready → Graceful skip
- Controls unavailable → Graceful skip
- User scrolls during delay → Scroll cancelled
- Rapid execution → Independent scheduling

**Files**:
- `src/renderer/src/utils/promptScrollScheduler.logic.ts` (141 lines)
- `src/renderer/src/utils/promptScrollScheduler.logic.test.ts` (871 lines, 66 tests)

**Integration Points** (6 call sites):
- PreviewContextMenu (Explain, Modify, Ask)
- ChatBubble (diagram chat + direction changes)
- MermaidToolbar (direction buttons)
- MermaidDiagram (bug report)
- useImport (organize-import)

See [Scroll Fixes](./scroll-fixes.md) for related scroll preservation features.

### Core Capabilities

- **Native Shell**: Spawns real PTY process (zsh on macOS, bash on Linux, Git Bash / PowerShell 7 / Windows PowerShell 5.1 / cmd.exe on Windows – resolved by `TerminalService.resolveWindowsShell()` in precedence order, honoring `$SHELL` first)
- **Auto-Resize**: Terminal automatically resizes when panel is dragged
- **WebGL Rendering**: Hardware acceleration with canvas fallback
- **Bold Font Support**: Renders bold text with proper font weight
- **Full Environment**: Login shell on macOS/Linux loads user's shell configuration and Homebrew paths
- **Context Integration**: "Send Selection to Terminal" from markdown preview

### Terminal Configuration

- **Font**: **Cascadia Mono**, 12px, bold support — bundled with the app (`src/renderer/src/assets/fonts/`, declared in `src/renderer/src/styles/fonts.css`, SIL OFL 1.1) so the terminal renders identically on every platform. SF Mono / Monaco / Consolas remain as fallbacks. Apple's SF Mono cannot be redistributed, so Cascadia Mono is the closest freely-licensable match. The font is awaited via the CSS Font Loading API (`ensureTerminalFontLoaded`) **before** `xterm.open()` — xterm measures glyph metrics on a canvas at open time, so a not-yet-loaded web font would cache fallback metrics and misalign the grid.
- **Theme**: High contrast – black background (`#000000`), white foreground (`#ffffff`), cyan cursor (`#4fc1ff`)
- **Scrollbar**: 16px wide, dark gray thumb (`#555555`) on `#1e1e1e` track, custom WebKit styling
- **Container**: `padding: 0` on container, `padding: 8px` on `.xterm`

### Shell Configuration

**Prompt Format**: `%n %~ $` (username directory $)

**Example**: `marcinmobel ~/Projects/erfana $`

**Environment Variables**:
- `PS1='%n %~ $ '` - Traditional zsh prompt
- `PROMPT='%n %~ $ '` - Zsh synonym for PS1
- `SHELL_SESSIONS_DISABLE='1'` - Disables macOS "Restored session" messages
- `TERM='xterm-256color'` - 256-color support
- `COLORTERM='truecolor'` - True color support

**Shell Arguments** (Platform-Specific):
- **macOS/Linux**: `-l` (login shell) - Sources RC files (.zprofile, .bash_profile) to load environment, Homebrew paths, and user configuration
- **Windows (PowerShell)**: `-NoProfile` - Loads full environment profile
- **Windows (cmd.exe)**: No arguments - Uses default environment

### Terminal Initialization

**Clean Start Behavior**: Terminal uses a non-interactive bootstrap pattern to eliminate initialization artifacts and provide a clean user experience.

See [Bootstrap Pattern](./bootstrap-pattern.md) for detailed initialization documentation.

## Architecture

### Service Layer

**File**: `src/main/services/TerminalService.ts` (~260 lines)

```typescript
class TerminalService extends EventEmitter {
  private terminals: Map<string, TerminalInstance>

  // Lifecycle
  createTerminal(config: TerminalConfig): string | null
  killTerminal(terminalId: string): boolean
  dispose(): Promise<void>

  // Operations
  write(terminalId: string, data: string): Promise<boolean>  // v0.3.3: Promise-based with completion callback
  resize(terminalId: string, cols: number, rows: number): boolean

  // Info
  getTerminalInfo(terminalId: string): {...} | null
  listTerminals(): Array<{id: string; title: string}>
}

export const terminalService = new TerminalService()
```

**Pattern**: OOP service with singleton instance (follows FileService pattern)

**v0.3.3 Enhancement**: The `write()` method now returns a Promise that resolves when the write operation completes. This enables reliable autoExecute behavior for prompt templates, preventing race conditions between text write and Enter key. See [AutoExecute Reference](../prompts/autoexecute-reference.md) for details.

### IPC Handlers

**File**: `src/main/ipc/terminal-handlers.ts` (~120 lines)

**Exposed via contextBridge**:
```typescript
window.api.terminal = {
  isAvailable: (terminalId?) => Promise<{success, available, initialized?}>
  create: (config) => Promise<{success, terminalId?, error?}>
  write: (terminalId, data) => Promise<{success, error?}>  // v0.3.3: Promise-based
  resize: (terminalId, cols, rows) => void
  kill: (terminalId) => void

  // Events
  onData: (callback) => unsubscribe
  onExit: (callback) => unsubscribe
  onError: (callback) => unsubscribe
}
```

### UI Component (Modular Architecture, v0.6.5)

**Main Component**: `src/renderer/src/components/Panels/TerminalPanel.tsx` (~250 lines)

**Extracted Hooks** (`src/renderer/src/components/Panels/TerminalPanel/hooks/`):
- `useTerminalDragDrop.ts` - External file drag-drop handling
- `useScreenshotCapture.ts` - macOS screenshot capture workflow
- `useTerminalResize.ts` - ResizeObserver-based terminal resize
- `useTerminalPortal.ts` - DOM portal management for xterm

**Extracted Components** (`src/renderer/src/components/Panels/TerminalPanel/components/`):
- `TerminalToolbar.tsx` - Screenshot, scroll, restart buttons
- `TerminalStatusContent.tsx` - Status state display (unavailable, loading, error)

**Supporting Files**:
- `types.ts` - TerminalState, ScreenshotCaptureMode types
- `terminalPanel.logic.ts` - Pure functions and constants

See [Terminal Architecture Review](../architecture-reviews/reviews/terminal-panel-architecture-review.md) for detailed refactoring documentation.

**Key Features**:
- Visibility check before xterm initialization (prevents rendering issues)
- WebGL addon loaded AFTER `xterm.open()` (order matters)
- ResizeObserver for panel drag handling
- useRef pattern to avoid useEffect cleanup issues
- Clean screen on mount (`\x1b[2J\x1b[H`)

**Critical Implementation Detail**: Terminal cleanup uses `useRef` for `terminalId` instead of including it in `useEffect` dependencies. Including `terminalId` in deps causes cleanup to run on ID change, disposing xterm before it can render. The cleanup effect depends only on `isAvailable`.

### State Management

**File**: `src/renderer/src/stores/useTerminalStore.ts`

```typescript
interface TerminalStore {
  activeTerminalId: string | null
  setActiveTerminalId: (id: string | null) => void
  sendToTerminal: (text: string, autoExecute?: boolean) => Promise<boolean>  // v0.3.3: autoExecute support
}
```

**Purpose**: Cross-component communication (PreviewContextMenu → Terminal Panel)

**v0.3.3 Enhancement**: `sendToTerminal()` now supports `autoExecute` parameter to automatically send Enter key after text. Includes initialization polling (5s timeout, 50ms intervals) to prevent race conditions. See [AutoExecute Reference](../prompts/autoexecute-reference.md).

### Bracketed Paste Mode (v0.7.2+, #108)

Terminal prompt writes are wrapped in **bracketed paste mode** escape sequences to prevent shell interpretation of pasted text:

```
\x1b[200~ ... text ... \x1b[201~
```

Without bracketed paste, multi-line text or text containing special characters (e.g., `!`, `$`, newlines) could be interpreted by the shell as commands. The bracketed paste wrapper tells the shell to treat the entire block as literal paste content.

**Implementation**: `useTerminalStore.sendToTerminal()` wraps the text payload before writing to the PTY.

## Addons

| Addon | Purpose | Notes |
|-------|---------|-------|
| **FitAddon** | Auto-fits terminal dimensions to container | Called on resize, mount, show/hide |
| **WebLinksAddon** | Makes URLs clickable | Loaded automatically on creation |
| **WebglAddon** | Hardware-accelerated rendering | MUST load AFTER `xterm.open()` or rendering fails; falls back to canvas on WebGL context loss |

## Integration Points

### Activity Bar Toggle
**File**: `src/renderer/src/components/DockLayout/AppDockLayout.tsx`

- Terminal icon in right activity bar (bottom position)
- Toggles terminal splitview panel visibility

### Context Menu Integration
**File**: `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx`

**"Send Selection to Terminal"** menu item:
1. Opens terminal panel (if closed)
2. Waits 100ms for initialization
3. Calls `sendToTerminal(selectedText)`
4. Shows success/error toast

### Keyboard Shortcuts
**Global**: `Cmd/Ctrl+J` - Toggle terminal panel (works anywhere in app)

## Related Documentation

- [Bootstrap Pattern](./bootstrap-pattern.md) - Clean initialization without artifacts
- [Scroll Fixes](./scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
- [Flickering Prevention](./flickering-prevention.md) - v0.3.2 rendering stability fixes
- [Troubleshooting](./troubleshooting.md) - Known issues and solutions
- [UI Components](../ui-components.md) - Terminal panel UI integration
- [Architecture](../architecture.md) - TerminalService in service layer
- [IPC Patterns](../ipc-patterns.md) - Terminal IPC communication patterns
