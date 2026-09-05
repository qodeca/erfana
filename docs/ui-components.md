# UI Components & Behavior

## Activity Bars

**Location**: `src/renderer/src/components/ActivityBar/`

Dual vertical activity bars on left and right edges (VS Code-style).

### Left & Right Bars

**Left**: Project icon (Cmd/Ctrl+B) toggles project tree
**Right**: Terminal icon (Cmd/Ctrl+J) toggles terminal panel; maximize/restore button in the terminal header (Cmd/Ctrl+Shift+M) expands the terminal over the editor
**Dimensions**: 48px fixed width, 48x48px click targets

### Components

- `ActivityBar.tsx` - Main container
- `ActivityBarItem.tsx` - Individual item with icon
- `ActivityBarBadge.tsx` - Badge notifications
- `activityBarConfig.ts` - Configuration mapping

### State Management

**Zustand Store**: `useActivityBarStore.ts` manages active panels, sidebar widths (persisted to localStorage)

### Design

- Background: `var(--color-gray-800)` (#3c3c3c)
- Icons: Lucide React – `activityBarConfig.ts` imports `Files`, `Search` and `Terminal`. The **Search panel is `enabled: false` ("Coming soon")** and `getPanelsBySide()` filters disabled panels out, so only the Project and Terminal icons are rendered. There is no project-wide search; `Cmd/Ctrl+F` is in-file search only
- Active indicator: 2px Qodeca Lime vertical bar (`var(--color-brand-lime)`)
- Hover: Icon changes to white

## Global Toasts

Lightweight toast notifications in bottom-left corner.

**Location**: `src/renderer/src/components/Toast/`
**API**: `showGlobalToast()` via event bus, rendered by `ToastProvider`
**Types**: info, success, warning, error

## Control Panels

Collapsible panels with chevron toggle (VS Code pattern).

### Pattern

Header with ChevronDown/ChevronLeft icon (8px spacing). Click toggles visibility with 150ms rotation transition.

**Implementation** (`ProjectPanel.tsx` swaps the icon rather than rotating one):
```typescript
const [show, setShow] = useState(true)

<button className="control-panel-chevron" onClick={() => setShow(!show)}>
  {show ? <ChevronDown size={16} strokeWidth={2} /> : <ChevronLeft size={16} strokeWidth={2} />}
</button>
{show && <div className="control-panel">{/* Controls */}</div>}
```

**CSS**: `.control-panel-chevron` (plus `:hover` / `:active`) in `ProjectPanel.css`

**Example**: ProjectPanel file filtering - see [Project Panel](./project-panel.md#control-panel)

## Project Panel

**Location**: Left sidebar via activity bar

Hierarchical file tree with filtering, visual indicators, context menu operations.

**Features**:
- File filtering (All Files | Markdown Only) with recursive logic
- Sensitive file detection (credentials, keys, certificates, dotfile secrets)
- Hidden file styling (dotfiles, 70% opacity)
- Context menu (Open as source, Cut, Copy, Paste, New File, New Folder, Rename, Import…, Delete, Reveal in Finder / Show in Explorer – built per node type by `context-menu/strategies.tsx`)
- Auto-refresh via directory watching

📚 **Full docs**: [Project Panel](./project-panel.md)

### Visual Indicators

**Sensitive** (amber + warning icon): `.env*`, `.npmrc`, `*.pem`, `*.key`, `.aws/`, `.ssh/`, `credentials`, `secrets`, `id_rsa` and the other SSH key names – see `isSensitiveFile()` in `ProjectTreeNode.tsx` (`config.json` is not on the list)
**Hidden** (70% opacity, italic): Files starting with `.` (`.git/`, `.gitignore`)

## Terminal Panel

**Location**: Right sidebar via activity bar

Integrated terminal with xterm.js + node-pty.

**Access**: Terminal icon (right sidebar) or Cmd/Ctrl+J
**Restart**: `RotateCw` icon in the header (`title="Restart terminal"`) kills and restarts the session – there is no X in the terminal header

**Header controls** (left to right, all rendered only once the terminal is ready):

| Control | Icon | Title |
|---------|------|-------|
| Capture screen | `Camera` | Capture screen |
| Capture window | `AppWindow` | Capture window |
| Capture area | `BoxSelect` | Capture area |
| Capture photo (webcam) | `Webcam` | Capture photo |
| Scroll to bottom | `ArrowDownToLine` | Scroll to bottom |
| Restart terminal | `RotateCw` | Restart terminal |
| Scroll lock | `LockKeyhole` / `LockKeyholeOpen` | Lock scroll to bottom / Disable scroll lock |
| Maximize terminal | `Maximize2` / `Minimize2` | Maximize terminal (⌘⇧M) |

The three capture buttons appear only on platforms where screenshot capture is supported.

**Features**:
- Native PTY (zsh/bash/PowerShell)
- WebGL rendering (canvas fallback)
- Auto-resize, bold fonts
- High contrast theme (white on black)
- Cross-platform screenshot capture (screen / window / area) and webcam photo capture, inserted as a path into the terminal
- Maximize over the editor (Cmd/Ctrl+Shift+M)
- Per-terminal Claude Code context status bar (`ClaudeStatusBar`)
- Preview and editor context menus send a selection to the terminal via prompt templates (there is no "Send selection to terminal" item)

**Theme**: Uses design tokens - `var(--color-black)` bg, white fg, `var(--color-cursor)` cursor

**Tech**: xterm.js v6.0.0, node-pty v1.0.0, WebglAddon, FitAddon, WebLinksAddon

**Modular architecture** (started v0.6.5, **not finished**):
- Extraction is partial. `TerminalPanel.tsx` currently consumes only `useScreenshotCapture`, plus the extracted `TerminalStatusContent.tsx` and `ClaudeStatusBar.tsx` components; the rest of the panel – including its header toolbar – is still inlined in `TerminalPanel.tsx`.
- `useTerminalDragDrop`, `useTerminalResize`, `useTerminalPortal` and `TerminalToolbar.tsx` exist and are re-exported from `TerminalPanel/index.ts`, but nothing outside their own tests imports them yet.
- `TerminalPanel/index.ts` still re-exports the component from its old location with a `// Will be moved here in Phase 6` comment, so the module boundary is not yet real.
- `TerminalStatusContent.tsx` – Status state display (checking, unavailable, error, ready). In use.
- `activityBarConfig.ts` owns panel `testId` values (no more parallel mapping in `ActivityBarItem`).

📚 **Full docs**: [Terminal](./terminal/README.md)

## Dialogs

**Location**: `src/renderer/src/components/Dialog/`

The maintained inventory – BaseDialog API, focus trap, ESC/backdrop handling, and how to add a dialog – lives in [`src/renderer/src/components/Dialog/CLAUDE.md`](../src/renderer/src/components/Dialog/CLAUDE.md). What ships today, one line each:

| Dialog | Purpose |
|--------|---------|
| `ConfirmDialog` | Confirm/cancel, with danger styling |
| `PromptDialog` | Single text input with validation and character count |
| `AlertDialog` | Single-OK notice |
| `FileSystemDialog` (+ `NewFileDialog`, `NewFolderDialog`, `RenameDialog`) | Create/rename files and folders with cross-platform name validation |
| `CameraDialog` | Live webcam preview (full frame, un-mirrored by default, with an optional per-camera mirror toggle), device selection, single-frame photo capture |
| `ScreenSelectDialog` | Pick which display to capture when multiple monitors are connected |
| `WindowPickerDialog` | Thumbnail grid for picking a window to capture (desktopCapturer backend; macOS uses the OS picker instead) |
| `ScreenPermissionDialog` | Advisory macOS Screen Recording flow – open the privacy pane, then relaunch |
| `FilePickerDialog` | Disambiguate multiple file matches during smart path resolution |
| `DropModeDialog` | Choose move / copy / import for dropped external files |
| `ConflictDialog` | Resolve a name conflict at the drop target – replace or keep both; cancel skips the file |
| `TranscriptionDialog`, `DocumentImportDialog` | Media and document import – documented in their own sections below |

## Context Menu

**Location**: `src/renderer/src/components/ContextMenu/ContextMenu.tsx`

Reusable menu for Project Panel file/folder operations and tab actions.

**Features**:
- Portal rendering (#portal-root)
- Keyboard navigation
- Separator support
- Disabled state (grayed out, non-clickable) - v0.4.2

**Interface**:
```typescript
interface ContextMenuItem {
  label: string
  icon?: ReactNode
  action: () => void
  danger?: boolean    // Destructive styling (e.g. Delete)
  separator?: boolean
  disabled?: boolean  // Grays out item, prevents click
  shortcut?: string   // Right-aligned shortcut hint
  testId?: string     // Optional test ID for automated UI testing
}
```

📚 **Full docs**: [Project Panel](./project-panel.md#context-menu-operations)

## Global Keyboard Shortcuts

Work **anywhere** in app:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle left sidebar (Project) |
| `Cmd/Ctrl+J` | Toggle right panel (Terminal) |
| `Cmd/Ctrl+Shift+M` | Maximize terminal over the editor |

**Implementation**: `AppDockLayout.tsx` bubble-phase `window` keydown listener
**Note**: `Cmd/Ctrl+B` is also registered inside Monaco as Bold. Which one wins while the editor is focused is unverified – see [Keyboard Shortcuts § Conflicts](./keyboard-shortcuts.md#conflicts)

## Panel Toggle System

### Behavior

VS Code-style: Toggles entire splitview panel, preserves dimensions, persists state.

**Panels**:
- Left: `ProjectPanel`
- Center: `EditorAreaSplitPanel` (hidden only while the terminal is maximized)
- Right: `TerminalPanel` (added only when a project is open)

**Toggle**: `splitviewApi.getPanel(id).api.setVisible(bool)`
**State**: `useActivityBarStore` (Zustand + localStorage)

### Size Constraints

**Min**: 170px sidebars, 400px center
**Max**: 600px left sidebar, 1200px terminal (`TERMINAL_MAX`; relaxed to `Number.MAX_SAFE_INTEGER` while the terminal is maximized), unlimited center
**Default**: 300px left, 300px right (`useActivityBarStore`)

### Resize

SplitviewReact handles resize between panels with `onDidSizeChange` events.

```typescript
leftPanel.api.onDidSizeChange(() => {
  setSidebarWidth(leftPanel.api.width, 'left')
})
```

## Panel Communication

**Pattern**: Pass DockviewApi through splitview params.

**Flow**:
1. `EditorAreaSplitPanel` creates DockviewReact → gets `dockviewApi`
2. Calls `setDockviewApi` callback → updates parent ref
3. Parent passes to `ProjectPanel` via params
4. ProjectTree calls `dockviewApi.addPanel()` to open files

## Tab Styling

**Location**: `AppDockLayout.css`, `src/renderer/src/components/Tabs/`

VS Code-style hover and active indicators with Chrome-style dynamic sizing.

### EditorTab Component (v0.4.2)

**Location**: `src/renderer/src/components/Tabs/EditorTab.tsx`

Custom tab component for editor panels with:
- **Dynamic sizing**: Flex 1 1 0, min 80px, max 300px (Chrome-style)
- **Dirty indicator**: Filled circle when file has unsaved changes
- **Close button**: X icon, confirmation dialog for dirty files
- **Middle-click close**: Standard browser tab behavior
- **Context menu**: Close, Close Others, Close All
- **Tooltip**: Shows filename + relative path from project root
- **Hover indication**: Subtle background change

### WelcomeTab

**Location**: `WelcomeTab.tsx`

Home icon tab (41px fixed, non-draggable, no scaling).

### Hover

**Inactive**: `var(--color-bg-hover-solid)` background (`AppDockLayout.css`, `.dv-inactive-tab:hover .dv-default-tab`)
**Active**: `var(--color-bg-secondary)` with 0.9 opacity (`.dv-active-tab:hover .dv-default-tab`)
**EditorTab**: `var(--color-bg-hover)` on hover; `var(--color-bg-hover-solid)` when the tab is active (`EditorTab.css`)

### Active Indicator

2px Qodeca **Lime** bottom border via an `::after` pseudo-element, matching the activity bar's active-panel edge (`AppDockLayout.css:93` and `:115`, `var(--color-brand-lime)`). This paragraph said *Violet* until 2026-09-01, contradicting both the shipped code and this same document five sections above. Decided by [`design/system/components/row/index.html`](../design/system/components/row/index.html), which cites this edge as the precedent for the selected-row rule.

### Focus

Auto-focus on tab change ensures the active indicator shows immediately, so a panel needs `tabIndex={0}`.

**Do not add `outline: none`.** This document used to instruct exactly that, which contradicts the `decided` [Focus & keyboard card](../design/system/foundations/focus.html): `outline: none` is allowed *only* with a replacement on the very next line. A panel that is a tab stop with no visible focus is a WCAG 2.4.7 failure, and it already ships — `AppDockLayout.css:138` carries a bare `outline: none; /* Remove focus outline */`, tracked by [#93](https://github.com/qodeca/erfana/issues/93). The instruction here was creating the next one.

## Welcome Tab & Panel

**Location**: `WelcomePanel.tsx`, `components/Panels/WelcomeTab.tsx`

Home-icon tab (41px square, non-draggable). The welcome screen is the central **home view** shown when no file is open:

- **Background image** – `src/renderer/src/assets/home-background.jpg`, cover-scaled and anchored top-left. Painted via the `.home-bg` modifier on the welcome panel's `panel-content` root, **never** on the shared `.panel-content` class (that class also backs document/preview panels, so styling it would paint the image behind open documents).
- **Controls** – heading (`Welcome to ERFANA v{__APP_VERSION__}`, no Home icon in the panel), Import button, and Recent Projects sit in a dimmed, blurred container pinned to the bottom-right corner; the Recent Projects label is left-aligned.
- **Styles** – `AppDockLayout.css`: `.panel-content.home-bg`, `.welcome-panel`, `.welcome-content`.

### `WELCOME_PANEL_ID` – never hard-code the literal

The welcome panel is the one non-closable panel in the editor dockview, so every
"close all editor tabs" sweep has to skip it. Its id lives in
`src/renderer/src/constants/panels.ts`:

```typescript
export const WELCOME_PANEL_ID = '_center-placeholder'
```

It sits in `constants/` rather than beside the component because the code that
matches on it has no business importing a React component. Current call sites:

| File | Use |
|---|---|
| `components/DockLayout/components/EditorAreaSplitPanel.tsx` | Creates the panel with this id, and skips it when clearing the area |
| `components/Tabs/tabOperations.ts` | Filters it out of "close others" / "close all" |
| `stores/useProjectStore.ts` | Skips it in the panel sweep on project switch |

The string was copied into three files before the constant existed. Import the
constant – do not retype `'_center-placeholder'`. The leading underscore keeps
it out of the `editor-…` / `image-…` namespace that real file panels use; every
other panel id is derived, see `utils/openFileInPanel.ts`.

## Development Patterns

### Add Activity Bar Item

1. Update `activityBarConfig.ts`: `{ id, icon, label, shortcut }`
2. Map ID in `AppDockLayout.tsx`
3. Create splitview panel component

### Toggle Panel

```typescript
// Via store
useActivityBarStore().togglePanel('project', 'left')

// Direct
splitviewApiRef.current.getPanel('left-sidebar').api.setVisible(false)
```

### Read State

```typescript
const { leftActivePanel, leftWidth } = useActivityBarStore()
console.log('Visible:', leftActivePanel === 'project')
```

## Quit confirmation

Prompts user before quitting when there are unsaved changes or active terminal sessions.

### Trigger conditions

| Condition | Dialog shown |
|-----------|--------------|
| Unsaved editor changes | "Unsaved changes" dialog |
| Active terminal session | "Active terminal session" dialog |
| Both conditions | "Unsaved changes and active terminal" dialog |
| Neither | App quits immediately |

### Dialog options

- **Discard and quit**: Close app without saving
- **Cancel**: Stay in app

### Terminal activity detection

Terminal is considered "active" when:
- Input or output within last 20 seconds
- 500ms warm-up period ignored after terminal opens
- Activity clears after Ctrl+C if terminal goes quiet

### Implementation

| Component | Location |
|-----------|----------|
| Quit handler hook | `src/renderer/src/hooks/useQuitHandler.ts` |
| Helper functions | `src/renderer/src/utils/quitHelpers.ts` |
| IPC handlers | `src/main/ipc/quit-handlers.ts` |
| Main process | `src/main/index.ts` (before-quit event) |

---

## Error containment

**Location**: `src/renderer/src/components/RootErrorBoundary/`, `src/renderer/src/components/Panels/PanelErrorBoundary.tsx`, `src/renderer/src/utils/installGlobalErrorTrail.ts`, `src/main/utils/rendererCrashHandlers.ts`

Added by [#60](https://github.com/qodeca/erfana/issues/60), where a `RangeError` thrown while flattening a 174k-node project tree unmounted the React root and left a black window. Containment is layered on purpose – full rationale in [design-issue-60](./design/design-issue-60.md) §2.3.

### Two-tier boundary contract

**Tier 1 – `PanelErrorBoundary`** wraps one panel. `ProjectPanel.tsx` wraps `<ProjectTree/>` with it, so a tree defect degrades to *"Project tree unavailable. The rest of Erfana still works."* inside the sidebar while editor buffers and the live terminal keep running. It logs at `error`, not `fatal` – the window is still usable, so this is not the crash of last resort. A failed Reload reads *"Project tree is still unavailable."*

**Focus contract**: swapping the subtree drops focus to `<body>`, so the boundary moves it deliberately – but only when the user was standing in this panel. Focus returns to the Reload button after a failed retry **or** any panel death with focus inside the panel (including an async re-throw after a reload succeeded, where no attempt counter changes); after a successful Reload it lands on the recovered panel container. A panel that throws while the user is in the editor never steals focus.

**One announcement channel**: that focus move *is* the announcement – the fallback container carries **no** `role="alert"`. The alert and the focus would land in the same tick with the same sentence (the focused Reload button reads its accessible name plus the `aria-describedby` message), so a live region only buys a duplicate or interleaved reading. The trade-off is deliberate: a panel that dies while the user is elsewhere announces nothing, and the copy is waiting when they navigate to it.

**Mount-site contract**: the error state survives every re-render and is cleared only by Reload or by a remount, so a caller whose content is scoped to something the user can switch must **key** the boundary by it – `<PanelErrorBoundary key={projectPath ?? 'none'} componentName="Project tree">`. Without the key, a tree that crashed on project A still reads "unavailable" after the user opens project B.

**Tier 2 – `RootErrorBoundary`** is the boundary of last resort. It wraps only the `<App/>` branch in `main.tsx`; the screenshot-overlay branch is deliberately unwrapped, having no recovery UI to show. It renders `{hasError ? <FallbackGuard><RootErrorFallback/></FallbackGuard> : children}`, where `FallbackGuard` is a **distinct** boundary class (colocated, never merged) – React never routes an error thrown by a boundary's own fallback back into that boundary, so the guard cannot live in the class it protects. The guard's fallback is dependency-free static JSX (no stylesheet, no `TEST_IDS`, no `window.api`, no detail extraction) and it appends an inline-styled **sibling** to `document.body` – never a write into `#root`, which React owns during commit. That sibling never becomes a second live region, and it takes focus **only** when no guard alert reached the document (it queries for `[role="alert"][data-erfana-guard-alert]`): with the React alert on screen, focusing the sibling would read the same copy twice, so it stays as silent visual insurance. `logger.fatal` is level-independent: in production an error caught by `componentDidCatch` does not reach `window.onerror`, so that line is the only record of the crash.

**Layer-coverage rule** – "no blank window" holds only for the failure classes a boundary can intercept, and each layer is scoped to one class:

| Failure class | Caught by | User sees | Record |
|---|---|---|---|
| Throw during render/lifecycle inside the project tree | `PanelErrorBoundary` (panel-scoped) | "Project tree unavailable" in the sidebar; editor and terminal keep running | `logger.error` |
| Throw during render/lifecycle anywhere else under `<App/>` | `RootErrorBoundary` | Full-window recovery screen | `logger.fatal` |
| Throw inside the recovery screen itself | `FallbackGuard` (distinct inner boundary) | Dependency-free static text | best-effort `logger.fatal`, then an inline-styled `document.body` sibling |
| Async throw, event-handler throw, unhandled rejection | `installGlobalErrorTrail()` | Nothing – the UI stays as it is | `logger.fatal`, boundary payload shape |
| Renderer / child-process death, window hang | main-process `rendererCrashHandlers` – `registerAppCrashLogging()` (app scope, once in `whenReady`) and `registerWindowResponsiveness(win)` (per window) | OS-level blank window or beachball (unchanged) | main log: `[crash] render-process-gone`, `[crash] child-process-gone`, `[hang] window-unresponsive` / `[hang] window-responsive` |
| Entry-module or preload failure before React mounts | main-process `registerWindowErrorSignals(win)` – the third registrar in the same module, per window from `createWindow` | An empty page. No process death, no hang, and no renderer-side record: the failure predates every boundary and `window` listener, so `render-process-gone` stays silent | main log: `[crash] renderer-console-error` (error-level console messages only, rate-capped) and `[crash] preload-error`, each with structured `windowId` context |
| Main-process crash | nothing | app exits | OS crash report |

`installGlobalErrorTrail()` runs in `main.tsx` **before** the route branch, so the overlay window gets a trail too, and it is idempotent. The main-process handlers are log-only by design – no auto-reload, no dialog, no relaunch, because a crash caused by restored state would re-crash on reload (boot-loop safety). The renderer console-error trail is rate-capped per window – at most 20 records per 10 s window. The window opens on the first console error and closes 10 s later; **when that interval expires**, and only if records were actually dropped, one `[crash] renderer-console-error suppressed` line reports the dropped count and the counters reset. The cap is tied to the rate-cap interval, not to the BrowserWindow: a window closing mid-interval emits nothing, and the timer is `unref`'d so a pending interval cannot hold a quitting app open. Without the cap a renderer stuck in an error loop would push the crash that started it out of the log rotation. `preload-error` is deliberately left uncapped – it fires at most once per load.

### Recovery screen (`RootErrorFallback`)

- **Actions**: Restart Erfana (primary), Copy error details, Open logs folder, plus a Show/Hide error details disclosure. Each action is gated by its own `typeof … === 'function'` probe on `window.api`, so a partially exposed bridge hides only the affected button instead of rendering a dead one.
- **Degraded mode**: when no bridge method is callable at all, the buttons are replaced by an instruction plus the log-folder location as platform-neutral prose (`.erfana/logs in your home folder`, from the shared `LOGS_DIR_RELATIVE` constant) – `~/…` would be wrong on Windows, and `process.platform` is `undefined` under the sandbox. The details disclosure still works.
- **One announcement**: the container is `role="alertdialog"` + `aria-modal="true"` with a real accessible name (`aria-labelledby`), focused on mount. Focus lands on the **container**, never on Restart, so a buffered Enter cannot relaunch the app the instant the screen appears. There is no focus trap because the fallback renders *instead of* `<App/>` – nothing else focusable remains in the document.
- **A single `role="status"` region** carries every transient message (copy result, restart pending, the 3 s manual-quit guidance). It exists from the first render so the live region is registered before anything is written to it, and writes are clear-then-set across two commits so a repeated message re-announces. Status is persistent until the next action – no timed revert.
- **Restart pending uses `aria-disabled` + an early-return handler**, never the `disabled` attribute: Chromium blurs a control the moment it becomes `disabled` and parks focus on `<body>` (see [`Dialog/CLAUDE.md`](../src/renderer/src/components/Dialog/CLAUDE.md)). Styling hangs off `[aria-disabled='true']` with `--opacity-disabled`.
- **Details region**: `role="region"`, `aria-label="Error details"`, `tabIndex={0}`, always in the DOM (so `aria-controls` always resolves) and `hidden` while collapsed. `error.message` is untrusted text – it is rendered as a text child inside this region only, never as HTML and never in the heading.

### Copy deck (as shipped)

| Slot | Text |
|---|---|
| Heading | `Erfana stopped unexpectedly.` |
| Message, Restart available | `Files you saved are not affected. Restarting opens Erfana on the welcome screen.` |
| Message, Restart bridge missing | `Files you saved are not affected. Quit Erfana and open it again.` |
| Degraded instruction | `Files you saved are not affected. Erfana's recovery tools are unavailable, so quit Erfana and open it again. Log files are in:` + `.erfana/logs in your home folder` |
| Buttons | `Restart Erfana` · `Copy error details` · `Open logs folder` |
| Details toggle | `Show error details` / `Hide error details` |
| Details body | `Erfana {version} · {timestamp}`, then `name: message`, truncated stack, component stack |
| Stack elision marker | `… N more lines – use Copy error details for the full stack` |
| Status – copy | `Error details copied to clipboard.` / `Could not copy the error details – the clipboard is unavailable.` |
| Status – restart | `Restarting Erfana…` / `Restart didn't start – quit and reopen Erfana manually.` (after 3 s) / `Restart failed – quit and reopen Erfana manually.` |
| Status – logs | `Opened the logs folder.` / `Could not open the logs folder.` |
| `FallbackGuard` last resort | `Erfana stopped unexpectedly.` + `The recovery screen could not be drawn. Quit Erfana and open it again. Files you saved are not affected.` |

The message paragraph branches on **capability, not taste**: promising that "restarting opens Erfana on the welcome screen" while rendering no Restart button would send the user hunting for a control that is not there.

### Restart-safety invariant

Offering Restart on a crash screen is only safe because **start-up never auto-opens the last project** – the "Load last project on mount - DISABLED" effect in [`useProjectManagement.ts`](../src/renderer/src/hooks/useProjectManagement.ts), which shows the welcome screen with recent projects instead. Were auto-restore re-enabled, restarting after a crash *caused by* a project would reopen that project and crash again, in a loop.

Rather than rest on that coupling alone, the Restart handler clears `lastProjectPath` best-effort before `relaunchApp()`. `closeProjectBestEffort()` races `window.api.file.closeProject()` against a `CLOSE_PROJECT_TIMEOUT_MS` (1500 ms) timer – comfortably inside the 3 s `RESTART_STALLED_MS` window, so even the worst case still reaches the relaunch before the screen offers manual-quit guidance. Three outcomes, one behaviour: the call **settles** (happy path), **rejects** (swallowed), or **never settles** – the realistic case when the main process is the unwell part – and the wait is abandoned at the timeout. The relaunch proceeds in all three; the timer is cleared on every branch so it cannot outlive the screen. Both halves are load bearing – if auto-restore is ever re-enabled, this handler is the second line of defence, not the first.

The invariant is pinned by `src/renderer/src/hooks/useProjectManagement.noAutoLoad.test.ts`. **Do not delete that test to "fix" a future auto-restore feature** – changing the behaviour means revisiting this screen first.

---

## Image Viewer Panel

**Location**: `src/renderer/src/components/Panels/ImageViewerPanel/` (a folder since #70; the panel, its CSS module and `imageViewer.logic.ts` all moved out of `Panels/`)

Opens when clicking image files (PNG, JPG, GIF, WebP, SVG, BMP, ICO) in the project tree, or an image path in the terminal — both go through `src/renderer/src/utils/openFileInPanel.ts` (#70).

**Features**:
- Zoom controls: buttons, mouse wheel (cursor-centered), keyboard (+/-)
- Pan via click-drag or arrow keys
- Fit to view with auto-scale on resize
- Full-screen mode with portal overlay and focus trap
- Metadata display: dimensions, file size, format, `Updated hh:mm:ss` stamp
- **Live refresh on external change** (#70): decode-first, so the old image stays painted until the new one is ready — no blank frame, no unmount, one React commit for `src` + `transform`. Zoom and pan are preserved unless the image's intrinsic dimensions changed; the view resets to fit only then
- **Degraded states** (#70): a permanently mounted `role="status"` slot (`idle` / `reloading` / `unavailable`) carrying `Reloaded from disk` or `Auto-refresh unavailable`, and a `role="alert"` banner with a single **Reload** action for the deleted and watch-unavailable cases. The tab is renamed `icon.svg (deleted)` via the shared `formatTabTitle` helper (`src/renderer/src/utils/tabTitle.ts`), the same one the Markdown editor uses
- **Export controls** (#73): Export as PNG, Export as PDF and Copy image, as a `role="group"` between the zoom cluster and the actions group — three semantic regions (*how I look at it* · *what I take away* · *where I look at it*), one `.toolbarSeparator` between each, and the far-right corner still the full-screen / close affordance. Rendered by **both** toolbar instances. The work happens entirely in the main process (see [API services – features § ImageExportService](./api-services-features.md#imageexportservice)); the panel sends a path and a target and gets back a small structured result, never image bytes
- Accessibility: ARIA labels, keyboard navigation, prefers-reduced-motion

**Architecture**:
- `ImageViewerPanel.tsx` - Panel shell: hook glue, render states, tab title
- `components/ImageViewerToolbar.tsx` - Metadata group, status slot, zoom controls, export group, fullscreen button. Stateless: it takes the three export handlers and their busy flags as props
- `components/ImageViewerExportControls.tsx` - The three export buttons (#73)
- `components/ImageViewerBanner.tsx` - Degraded-state banner + Reload
- `hooks/useImageSource.ts` - Decode-first load/refresh, generation counter, visibility-deferred re-read
- `hooks/useImageViewerTransform.ts` - Zoom/pan/wheel/keyboard/ResizeObserver behind a `getActiveContainer` seam; `applySourceChange` decides preserve-vs-reset
- `hooks/useFullScreenOverlay.ts` - Open/close, portal-root guard, focus trap
- `hooks/useImageExportHandlers.ts` - The three export handlers, their busy flags and the announcement sentence (#73). Called **once**, in the panel, and its output passed to both toolbar instances — one state, so clicking in full screen is literally the same handler and both toolbars agree on busy. Dispatches through `showGlobalToast` rather than `useToast()`, so the panel still renders without a `ToastProvider` in unit tests
- `hooks/useReloadAction.ts` - The banner's Reload action. `recover()` returning `false` changes nothing else on screen, so this hook adds the transient "still not available" feedback that tells the user the click registered; it self-clears on the same `INDICATOR_DURATION_MS` budget as the "Reloaded from disk" confirmation (#70)
- `imageViewer.logic.ts` - Pure functions for zoom, pan, keyboard actions
- `imageViewerStatus.logic.ts` - Status precedence, clock formatting, all copy constants — including the export copy deck (tooltips, accessible names, busy names, announcements, toast titles)
- `imageExportToast.logic.ts` - Pure `formatExportToast` plus the qualifier builders (#73). It composes, it does not author: every qualifier — which GIF frame, which ICO size, the SVG's 2x factor — is built from the structured `selection` the main process reported *after* the export, never from a guess about the file, so the toast cannot claim something the export did not do. A cancelled export produces no toast and no announcement at all. Basenames are middle-truncated, because `.toast-message` has a max width and no `overflow-wrap`
- `ImageViewerPanel.module.css` - The one remaining CSS module in the app
- `imageUtils.ts` (in `utils/`) - Image format detection, MIME types
- Watch subscription comes from `src/renderer/src/hooks/useFileChangeSubscription.ts` — see [File Watching](./file-watching/README.md#single-file-watch-internals-70)

**Toolbar**, left to right: metadata · status slot · Zoom out, Zoom level % (click to reset), Zoom in, Fit · separator · Export as PNG, Export as PDF, Copy image · separator · Full screen (or Close, in the overlay). There is no separate Reset button — the zoom-level indicator *is* the reset control.

**Busy state uses `aria-disabled`, never the `disabled` attribute.** Chromium blurs a control the instant it becomes `disabled`, and the native save dialog then returns focus to a blurred element, dropping the keyboard user on `<body>` on every export. All three buttons mark themselves busy together (there is one main-side lock), the click handler early-returns, and only the invoked action shows a spinner. Same rule and same reason as the recovery screen's Restart button (§ Error containment).

**Two live regions, panel-owned.** `role="status"` for busy and success, `role="alert"` for failures, both visually hidden and both rendered into whichever surface is on top — the overlay when full screen, the panel otherwise — so exactly one element carries each id at a time. The assertive half exists because the full-screen overlay is `aria-modal="true"`, which lets a screen reader suppress the toast that lives outside it; while full screen, the settled sentence is written into the region instead of being left to the toast alone.

📚 **Keyboard shortcuts**: [Keyboard Shortcuts](./keyboard-shortcuts.md#image-viewer)

---

## Transcription dialog

**Location**: `src/renderer/src/components/Transcription/`

Modal dialog for media file import with transcription (OpenAI API or local whisper.cpp). Composes on `BaseDialog` for portal rendering, overlay, and focus management. Mounted in `App.tsx` and opened automatically when importing audio (MP3, WAV, M4A, OGG, FLAC) or video (MP4, MOV, AVI, MKV, WebM, FLV, WMV) files. Media files are detected by `useImport` and routed to the dialog with pre-validation.

**Components**:
- `TranscriptionDialog.tsx` – Composes on BaseDialog; progress bar, error display, cancel
- `LanguageSelect.tsx` – Dropdown with 30 languages plus an auto-detect option (31 entries total)

**State**: `useTranscriptionStore.ts` (Zustand) manages dialog visibility, progress, result, error

**Features**:
- Composes on BaseDialog (`closeOnEscape={false}`, `closeOnBackdrop={false}`) with custom Escape handling (cancel when transcribing, close otherwise)
- Tab-cycling focus trap via BaseDialog's opt-in `trapFocus` prop (the dialog's own `handleFocusTrap` was removed in #42)
- Progress bar with percentage, ETA, and chunk indicator ("chunk N of M")
- ARIA: `role="progressbar"`, `aria-live` on phase text/error/success, `aria-describedby`
- Cancel via footer button or Escape key
- Error display with retry option and actionable suggestions per error code
- Language selector: 31 options – 30 languages plus auto-detect (persists within session)
- Video-aware: FileVideo icon and "Transcribe video" title for video files
- Batch import rejection: media files in multi-file drops show toast, not dialog

**IPC flow**: `transcription:import` (invoke) + `transcription:progress` (streamed events) + `transcription:cancel` (abort)

---

## Document import dialog

**Location**: `src/renderer/src/components/DocumentImport/`

Modal dialog for configuring and executing LiteParse document imports (PDF, Office, images). Composes on `BaseDialog` for portal rendering, overlay, and focus management. Mounted in `App.tsx` and opened automatically when importing document files detected by `useImport` via the extension cache.

**Components**:
- `DocumentImportDialog.tsx` – Import options form, indeterminate progress with phase text, OCR warnings, success/error states
- `OcrLanguageSelect.tsx` – Dropdown with 31 Tesseract ISO 639-3 languages

**State**: `useDocumentImportStore.ts` (Zustand) manages dialog visibility, import options (OCR, language, screenshots, DPI), extension cache, and progress

**Features**:
- OCR toggle with language selection (session-persistent options)
- Screenshot generation toggle with DPI configuration (100-page limit hint shown when enabled)
- Indeterminate progress bar with phase text during import
- OCR warning when OCR is disabled
- Auto-open imported file on success
- Dependency-missing modal for LibreOffice/ImageMagick with install guidance
- Batch drag-drop filtering – document files in multi-file drops show warning toast

**IPC flow**: `import:document` (invoke with options) + `import:documentProgress` (streamed phase events) + `import:documentCancel` (abort)

---

## Related documentation

- [Architecture](./architecture.md) - Hybrid layout system
- [Editor](./editor/README.md) - Editor features
- [Settings](./settings.md) - Transcription settings section
- [Development Tasks](./development-tasks.md) - Adding components
- [Known Issues](./known-issues.md) - Workarounds
