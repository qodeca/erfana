# Screenshot Capture

## Overview

Add screenshot capture capability to Erfana's terminal panel toolbar, allowing users to capture screen, window, or selected area and automatically paste the file path to the active terminal.

**Scope:** macOS only (initial release). Other platforms may be added later.

**Trigger:** Three toolbar buttons in terminal panel header.

**Enhancement:** Multi-monitor support for full screen capture via display selection dialog.

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Add "Capture Screen" button to terminal panel toolbar that captures the primary display | Must |
| FR-02 | Add "Capture Window" button to terminal panel toolbar that lets user select a window to capture | Must |
| FR-03 | Add "Capture Area" button to terminal panel toolbar that lets user select a rectangular area | Must |
| FR-04 | Save screenshots to OS temporary directory with unique timestamped filename | Must |
| FR-05 | Paste the screenshot file path to the terminal that was active at time of button click | Must |
| FR-06 | Use native macOS `screencapture` command via child_process.spawn | Must |
| FR-07 | Buttons should only be visible on macOS platform (hidden on Windows/Linux) | Must |
| FR-08 | Buttons should only be enabled when a terminal session is active | Must |
| FR-09 | Use PNG format for screenshots | Must |
| FR-10 | Capture silently without camera shutter sound (use `-x` flag) | Must |
| FR-11 | Show loading state on clicked button during capture operation | Must |
| FR-12 | Disable all screenshot buttons while any capture operation is in progress | Must |
| FR-13 | Show toast notification on successful capture displaying filename only (via `path.basename`) | Must |
| FR-14 | Show error toast with actionable message on capture failure | Must |
| FR-15 | Quote file path with single quotes when pasting to terminal (shell-safe escaping) | Must |
| FR-16 | Do not append newline after pasted path (user decides when to execute) | Must |
| FR-17 | Handle macOS Screen Recording permission denial with guidance toast | Must |
| FR-18 | If target terminal closes during capture, show error toast instead of pasting | Must |
| FR-19 | Terminate capture process after 30-second timeout | Must |
| FR-20 | If paste to terminal fails after successful capture, show toast with full file path for manual copy | Must |
| FR-21 | Verify screencapture binary exists at service initialization; set `isAvailable()` to false if missing | Must |

### Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-01 | Screenshot capture should complete within 30 seconds (including user selection time) | Must |
| NFR-02 | Follow existing service patterns (singleton in main process) | Must |
| NFR-03 | Follow existing IPC patterns (Zod schema validation, typed responses) | Must |
| NFR-04 | Use Lucide React icons consistent with existing toolbar buttons (size 14) | Must |
| NFR-05 | Log capture operations via LoggingService (debug: start, info: success, error: failure) | Must |
| NFR-06 | Buttons must have ARIA labels for screen reader accessibility | Must |
| NFR-07 | Buttons must be keyboard accessible (in tab order) | Must |
| NFR-08 | After successful capture, return focus to terminal via `xtermRef.current?.focus()` | Should |
| NFR-09 | Register screenshot handlers after LoggingService initialization in main process | Must |

---

## User Experience

### Button States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Icon only, secondary color | Clickable |
| Hover | Icon highlighted, primary color | Clickable |
| Disabled (no terminal) | Dimmed, `opacity: 0.5` | Not clickable, `cursor: not-allowed` |
| Loading (capture in progress) | Spinning icon on clicked button | All 3 buttons disabled |
| Hidden (non-macOS) | Not rendered | N/A |

**State Management:** Use local `useState` in TerminalPanel for `isCapturing: boolean` and `capturingMode: 'screen' | 'window' | 'area' | null`. No global store needed for transient UI state.

### User Feedback

| Event | Feedback |
|-------|----------|
| Capture started | Clicked button shows spinner, all buttons disabled |
| Capture success | Toast: "Screenshot saved: {filename}" (filename via `path.basename`), path pasted to terminal |
| Capture cancelled (Escape) | Buttons return to default state, no toast, no paste |
| Permission denied | Error toast: "Screen recording permission required. Enable in System Preferences > Privacy & Security > Screen Recording" |
| Timeout (30s) | Error toast: "Screenshot capture timed out" |
| Target terminal closed | Error toast: "Terminal closed during capture" |
| Write failed | Error toast: "Failed to save screenshot" |
| Paste failed | Error toast: "Screenshot saved but paste failed: {full path}" (allows manual copy) |
| Binary not found | Error toast: "Screenshot capture unavailable" |

### Terminal Targeting

The terminal that receives the pasted path is determined **at the moment the button is clicked**, not when capture completes. This prevents confusion if user switches terminals during interactive selection.

**Implementation:** Capture `activeTerminalId` at click time, store in closure, use for paste operation. Check `sendToTerminal` return value — if `false`, terminal is gone, show error toast with full path.

### Path Format

Paths are quoted with single quotes for shell safety (using `escapePathForShell` utility):
```
'/var/folders/xx/xxxxx/T/erfana-screenshot-1737012345123.png'
```

Internal single quotes are escaped as `'\''`. This is consistent with the drag-drop file path insertion.

No trailing space or newline. User can type command before or after the path.

---

## Technical Approach

### macOS screencapture Flags

| Mode | Command | Description |
|------|---------|-------------|
| Full screen | `screencapture -x <path>` | Captures primary display instantly |
| Window | `screencapture -w -x <path>` | Interactive window selection (works across all displays) |
| Area | `screencapture -i -s -x <path>` | Interactive rectangular selection |

**Note:** Full screen capture supports multi-monitor selection via dialog when multiple displays are connected. Uses `-D` flag with 1-based display index.

**Note:** On Retina displays, screenshots are captured at native resolution (2x). This is automatic.

**Binary location:** `/usr/sbin/screencapture` (verify at service init)

### Exit Code Decision Tree

```
┌─────────────────────────────────────────────────────────────────┐
│                    screencapture exits                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Wait 50ms for       │
              │   filesystem sync     │
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Check if file       │
              │   exists              │
              └───────────┬───────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
    File exists                     File missing
          │                               │
          ▼                               ▼
      SUCCESS                 ┌───────────────────────┐
   (exit 0 or 1)              │ Check stderr content  │
                              └───────────┬───────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
            stderr contains       stderr empty           otherwise
            "permission" or       (exit code 1)
            "cannot be opened"
                    │                     │                     │
                    ▼                     ▼                     ▼
            PERMISSION_DENIED       CANCELLED               UNKNOWN
```

**Key insight:** macOS sometimes returns exit code 1 even on success. Always check file existence first.

### File Naming

**Pattern:** `erfana-screenshot-{timestamp}.png`

**Timestamp format:** ISO 8601 with colons replaced by hyphens (filesystem safe)

**Example:** `erfana-screenshot-2026-01-15T19-30-45-123Z.png`

**Location:** `os.tmpdir()` (e.g., `/var/folders/.../T/`)

### Temp File Cleanup

Screenshot files are **not automatically cleaned up** by Erfana. Rationale:
- User may reference paths in terminal history
- OS handles temp directory cleanup periodically
- Explicit cleanup could delete files user still needs

### IPC Contract

**Channel:** `screenshot:capture`

**Request:**
```typescript
{
  mode: 'screen' | 'window' | 'area'
  displayId?: number  // Optional display ID for 'screen' mode (multi-monitor support)
}
```

**Note:** `terminalId` is NOT included in the request. It is captured client-side at click time to ensure the correct terminal receives the path even if user switches terminals during interactive selection.

**Response:**
```typescript
{
  success: boolean
  filePath?: string      // On success
  error?: string         // Human-readable error message
  errorCode?: 'SCREENSHOT_PERMISSION_DENIED' | 'SCREENSHOT_TIMEOUT' | 'SCREENSHOT_CANCELLED' | 'SCREENSHOT_FAILED' | 'SCREENSHOT_NOT_SUPPORTED'
}
```

**Channel:** `screenshot:getDisplays`

**Request:** None

**Response:**
```typescript
{
  displays: DisplayInfo[]  // Array of available displays
}
```

**Pattern deviation note:** The capture response structure differs from other IPC handlers that throw errors. The deviation is intentional because `SCREENSHOT_CANCELLED` is a legitimate non-error outcome (user pressed Escape) that should not throw.

### Zod Schema

```typescript
// src/shared/ipc/screenshot-schema.ts
import { z } from 'zod'

export const ScreenshotModeSchema = z.enum(['screen', 'window', 'area'])
export type ScreenshotMode = z.infer<typeof ScreenshotModeSchema>

// Display information for multi-monitor support
export const DisplayBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
})

export const DisplayInfoSchema = z.object({
  id: z.number(),
  label: z.string(),
  isPrimary: z.boolean(),
  bounds: DisplayBoundsSchema
})
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>

export const GetDisplaysResponseSchema = z.object({
  displays: z.array(DisplayInfoSchema)
})
export type GetDisplaysResponse = z.infer<typeof GetDisplaysResponseSchema>

// Capture request (terminalId captured client-side, not in IPC)
export const ScreenshotCaptureRequestSchema = z.object({
  mode: ScreenshotModeSchema,
  displayId: z.number().optional()  // For multi-monitor screen capture
})
export type ScreenshotCaptureRequest = z.infer<typeof ScreenshotCaptureRequestSchema>

// Capture response (uses success/error pattern instead of throwing)
export const ScreenshotCaptureResponseSchema = z.object({
  success: z.boolean(),
  filePath: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional()  // ErrorCode enum values
})
export type ScreenshotCaptureResponse = z.infer<typeof ScreenshotCaptureResponseSchema>
```

### Preload API

```typescript
window.api.screenshot: {
  getDisplays: () => Promise<GetDisplaysResponse>
  capture: (request: ScreenshotCaptureRequest) => Promise<ScreenshotCaptureResponse>
}

window.api.utils: {
  getPlatform: () => NodeJS.Platform  // Used to check for 'darwin'
}
```

### UI Integration

**Icons (lucide-react, size 14):**
| Button | Icon | Tooltip |
|--------|------|---------|
| Capture Screen | `Monitor` | "Capture screen" |
| Capture Window | `AppWindow` | "Capture window" |
| Capture Area | `ScanLine` | "Capture area" |

**Placement:** After existing toolbar buttons, with 8px gap as separator.

```
[Scroll ↓] [Restart ↻] [Lock 🔒] ── gap ── [Monitor] [Window] [Area]
```

**Test IDs:**
```typescript
TERMINAL_BTN_SCREENSHOT_SCREEN: 'terminal-btn-screenshot-screen'
TERMINAL_BTN_SCREENSHOT_WINDOW: 'terminal-btn-screenshot-window'
TERMINAL_BTN_SCREENSHOT_AREA: 'terminal-btn-screenshot-area'
```

**Accessibility:**
```tsx
<button
  aria-label="Capture screen"
  aria-disabled={!terminalId || isCapturing}
  disabled={!terminalId || isCapturing}
  data-testid={TEST_IDS.TERMINAL_BTN_SCREENSHOT_SCREEN}
>
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User cancels with Escape | No file created, no paste, no toast, buttons reset |
| Empty/tiny area selected (<10x10 px) | macOS handles this - small but valid image created |
| Erfana in fullscreen mode | macOS exits fullscreen for interactive selection; Erfana does not auto-restore fullscreen |
| Rapid button clicks | Ignored - buttons disabled during capture |
| Multiple displays | Full screen = primary only; Window/Area = user selects from any display |
| Terminal closed during capture | Error toast with full path, no paste attempt |
| screencapture binary not found | `isAvailable()` returns false, buttons hidden |
| Disk full / write error | Error toast: "Failed to save screenshot" |
| Capture exceeds 30 seconds | Process killed via SIGTERM, error toast: "Screenshot capture timed out" |
| Paste to terminal fails | Error toast with full path for manual copy |
| File existence check race | 50ms delay before checking file existence |

---

## Acceptance Criteria

### AC-01: Full Screen Capture
- [ ] Click "Capture Screen" button in terminal toolbar
- [ ] Button shows loading spinner, all screenshot buttons disabled
- [ ] Primary display is captured immediately (no user interaction)
- [ ] PNG file is saved to temp directory
- [ ] Quoted file path appears at terminal cursor position
- [ ] Success toast shows filename (not full path)
- [ ] Buttons return to default state

### AC-02: Window Capture
- [ ] Click "Capture Window" button in terminal toolbar
- [ ] Button shows loading spinner, all screenshot buttons disabled
- [ ] macOS window selection UI appears (cursor changes to camera)
- [ ] User can select window from any connected display
- [ ] User clicks on a window to capture it
- [ ] PNG file is saved to temp directory
- [ ] Quoted file path appears at terminal cursor position
- [ ] Success toast shows filename
- [ ] Buttons return to default state

### AC-03: Area Selection Capture
- [ ] Click "Capture Area" button in terminal toolbar
- [ ] Button shows loading spinner, all screenshot buttons disabled
- [ ] macOS selection UI appears (crosshair cursor)
- [ ] User drags to select rectangular area
- [ ] PNG file is saved to temp directory
- [ ] Quoted file path appears at terminal cursor position
- [ ] Success toast shows filename
- [ ] Buttons return to default state

### AC-04: Cancellation
- [ ] User can press Escape during window/area selection
- [ ] No file is created
- [ ] No path is pasted to terminal
- [ ] No toast notification shown
- [ ] Buttons return to default state immediately

### AC-05: Platform Restriction
- [ ] Buttons are not rendered on Windows/Linux
- [ ] `window.api.screenshot.isAvailable()` returns false on non-macOS
- [ ] No errors occur when running on Windows/Linux

### AC-06: Terminal State
- [ ] Buttons are disabled when no terminal session is active
- [ ] Path is pasted to the terminal that was active when button was clicked
- [ ] If that terminal closes during capture, error toast shows full path

### AC-07: Permission Denied
- [ ] Revoke Screen Recording permission for Erfana in System Preferences
- [ ] Click any capture button
- [ ] Error toast appears with permission guidance
- [ ] No crash or unhandled exception

### AC-08: Concurrent Capture Prevention
- [ ] Click "Capture Window" button
- [ ] While in selection mode, try clicking other screenshot buttons
- [ ] Other buttons do not respond (disabled)
- [ ] Original capture completes normally

### AC-09: Timeout
- [ ] Click "Capture Window" button
- [ ] Wait 30+ seconds without selecting a window
- [ ] Capture is terminated
- [ ] Error toast: "Screenshot capture timed out"
- [ ] Buttons return to default state

### AC-10: Accessibility
- [ ] Screenshot buttons are reachable via Tab key
- [ ] Screen reader announces button labels

### AC-11: Paste Failure Recovery
- [ ] Capture succeeds but terminal closes before paste
- [ ] Error toast displays full file path
- [ ] User can manually copy path from toast

---

## Out of Scope

- Windows/Linux support (future enhancement)
- Screenshot preview before pasting
- Screenshot editing/annotation
- Clipboard integration (copy image to clipboard)
- Custom save location selection
- Keyboard shortcuts for capture
- Automatic temp file cleanup
- Auto-restore fullscreen after capture

**Note:** Multi-display selection for full screen capture was originally out of scope but was implemented as an enhancement (issue #86).

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/shared/ipc/screenshot-schema.ts` | Create | Zod schemas for request/response/displays |
| `src/main/services/ScreenshotService.ts` | Create | Service with IScreenshotService interface |
| `src/main/services/ScreenshotService.test.ts` | Create | Unit tests for service (52 tests) |
| `src/main/ipc/screenshot-handlers.ts` | Create | IPC handlers for capture and getDisplays |
| `src/main/index.ts` | Modify | Register screenshot handlers (after LoggingService init) |
| `src/preload/index.ts` | Modify | Expose screenshot API and utils.getPlatform |
| `src/preload/index.d.ts` | Modify | Add TypeScript types |
| `src/shared/constants.ts` | Modify | Add SCREENSHOT constants |
| `src/shared/errors.ts` | Modify | Add SCREENSHOT_* error codes |
| `src/renderer/src/components/Panels/TerminalPanel.tsx` | Modify | Add toolbar buttons with local state |
| `src/renderer/src/components/Panels/TerminalPanel.css` | Modify | Add loading state styles |
| `src/renderer/src/components/Dialog/ScreenSelectDialog.tsx` | Create | Multi-monitor selection dialog |
| `src/renderer/src/components/Dialog/ScreenSelectDialog.css` | Create | Dialog styles using design tokens |
| `src/renderer/src/constants/testids.ts` | Modify | Add TERMINAL_BTN_CAPTURE_* test IDs |

---

## Test Scenarios

### Unit Tests (ScreenshotService)

| Test | Expected |
|------|----------|
| `capture('screen')` spawns correct command | `screencapture -x <path>` |
| `capture('window')` spawns correct command | `screencapture -w -x <path>` |
| `capture('area')` spawns correct command | `screencapture -i -s -x <path>` |
| Successful capture returns file path | `{ success: true, filePath: '...' }` |
| User cancellation (exit 1, no file, empty stderr) | `{ success: false, errorCode: 'CANCELLED' }` |
| Permission denied (exit 1, no file, stderr contains "permission") | `{ success: false, errorCode: 'PERMISSION_DENIED' }` |
| Timeout kills process after 30s | `{ success: false, errorCode: 'TIMEOUT' }` |
| File path contains timestamp | Matches pattern `erfana-screenshot-*.png` |
| Non-macOS returns unavailable | `isAvailable() === false` on Windows/Linux |
| Binary missing returns unavailable | `isAvailable() === false` if `/usr/sbin/screencapture` not found |
| File existence check waits 50ms | Delay before checking file |

### Component Tests (TerminalPanel)

| Test | Expected |
|------|----------|
| Buttons hidden on non-macOS | Not in DOM when `process.platform !== 'darwin'` |
| Buttons hidden when `isAvailable()` false | Not in DOM |
| Buttons disabled when no terminal | `disabled` attribute present |
| Buttons disabled during capture | All 3 disabled when `isCapturing === true` |
| Clicked button shows spinner | Spinner icon replaces normal icon |
| Success triggers toast with filename | `showToast` called with `path.basename(filePath)` |
| Error triggers error toast | `showToast` called with error message |
| Path pasted to correct terminal | `sendToTerminal` called with captured `terminalId` |
| Paste failure shows full path | Toast contains full file path when `sendToTerminal` returns false |

---

## References

- [macOS screencapture man page](https://ss64.com/mac/screencapture.html)
- Existing spawn pattern: `src/main/utils/spawnNewInstance.ts`
- Terminal store: `src/renderer/src/stores/useTerminalStore.ts`
- Toast system: `src/renderer/src/components/Toast/`
