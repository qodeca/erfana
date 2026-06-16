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
- Icons: Lucide React (`Folder`, `Terminal`)
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

**Implementation**:
```typescript
const [show, setShow] = useState(true)

<ChevronDown
  className={`chevron-toggle ${show ? '' : 'collapsed'}`}
  onClick={() => setShow(!show)}
/>
{show && <div className="control-panel">{/* Controls */}</div>}
```

**CSS**: `.chevron-toggle.collapsed { transform: rotate(-90deg); transition: transform 0.15s; }`

**Example**: ProjectPanel file filtering - see [Project Panel](./project-panel.md#control-panel)

## Project Panel

**Location**: Left sidebar via activity bar

Hierarchical file tree with filtering, visual indicators, context menu operations.

**Features**:
- File filtering (All Files | Markdown Only) with recursive logic
- Sensitive file detection (credentials, keys, configs)
- Hidden file styling (dotfiles, 70% opacity)
- Context menu (New, Rename, Delete)
- Auto-refresh via directory watching

📚 **Full docs**: [Project Panel](./project-panel.md)

### Visual Indicators

**Sensitive** (amber + warning icon): `.env*`, `.npmrc`, `*.pem`, `.aws/`, `.ssh/`, `credentials*`, `config.json`
**Hidden** (70% opacity, italic): Files starting with `.` (`.git/`, `.gitignore`)

## Terminal Panel

**Location**: Right sidebar via activity bar

Integrated terminal with xterm.js + node-pty.

**Access**: Terminal icon (right sidebar) or Cmd/Ctrl+J
**Restart**: X in header kills/restarts session

**Features**:
- Native PTY (zsh/bash)
- WebGL rendering (canvas fallback)
- Auto-resize, bold fonts
- High contrast theme (white on black)
- "Send Selection to Terminal" from preview context menu

**Theme**: Uses design tokens - `var(--color-black)` bg, white fg, `var(--color-cursor)` cursor

**Tech**: xterm.js v6.0.0, node-pty v1.0.0, WebglAddon, FitAddon, WebLinksAddon

**Modular architecture** (v0.6.5+):
- `TerminalStatusContent.tsx` – Status state display (checking, unavailable, error, ready)
- Extracted hooks: `useTerminalDragDrop`, `useScreenshotCapture`, `useTerminalResize`, `useTerminalPortal`
- `activityBarConfig.ts` owns panel `testId` values (no more parallel mapping in `ActivityBarItem`)

📚 **Full docs**: [Terminal](./terminal/README.md)

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
  separator?: boolean
  disabled?: boolean  // NEW: Grays out item, prevents click
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

**Implementation**: `AppDockLayout.tsx` keydown listener
**Note**: Overrides Monaco shortcuts with same keys

## Panel Toggle System

### Behavior

VS Code-style: Toggles entire splitview panel, preserves dimensions, persists state.

**Panels**:
- Left: `ProjectPanelWrapper`
- Center: `EditorAreaSplitPanel` (always visible)
- Right: `TerminalSplitPanel`

**Toggle**: `splitviewApi.getPanel(id).api.setVisible(bool)`
**State**: `useActivityBarStore` (Zustand + localStorage)

### Size Constraints

**Min**: 170px sidebars, 400px center
**Max**: 600px sidebars, unlimited center
**Default**: 300px left, 250px right

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
3. Parent passes to `ProjectPanelWrapper` via params
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

**Inactive**: `#3a3d41` background
**Active**: `#2d2d30` with 0.9 opacity
**EditorTab**: `rgba(255, 255, 255, 0.05)` on hover

### Active Indicator

2px Qodeca Violet bottom border via `::after` pseudo-element, matches activity bar styling.

### Focus

Auto-focus on tab change ensures active indicator shows immediately. Panels need `tabIndex={0}` and `outline: none`.

## Welcome Tab & Panel

**Location**: `WelcomePanel.tsx`, `WelcomeTab.tsx`

Home-icon tab (41px square, non-draggable). The welcome screen is the central **home view** shown when no file is open:

- **Background image** – `src/renderer/src/assets/home-background.jpg`, cover-scaled and anchored top-left. Painted via the `.home-bg` modifier on the welcome panel's `panel-content` root, **never** on the shared `.panel-content` class (that class also backs document/preview panels, so styling it would paint the image behind open documents).
- **Controls** – heading (`Welcome to ERFANA v{__APP_VERSION__}`, no Home icon in the panel), Import button, and Recent Projects sit in a dimmed, blurred container pinned to the bottom-right corner; the Recent Projects label is left-aligned.
- **Styles** – `AppDockLayout.css`: `.panel-content.home-bg`, `.welcome-panel`, `.welcome-content`.

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

## Image Viewer Panel

**Location**: `src/renderer/src/components/Panels/ImageViewerPanel.tsx`

Opens when clicking image files (PNG, JPG, GIF, WebP, SVG, BMP, ICO) in project tree.

**Features**:
- Zoom controls: buttons, mouse wheel (cursor-centered), keyboard (+/-)
- Pan via click-drag or arrow keys
- Fit to view with auto-scale on resize
- Full-screen mode with portal overlay and focus trap
- Metadata display: dimensions, file size, format
- Accessibility: ARIA labels, keyboard navigation, prefers-reduced-motion

**Architecture**:
- `ImageViewerPanel.tsx` - Main component with state management
- `imageViewer.logic.ts` - Pure functions for zoom, pan, keyboard actions
- `imageUtils.ts` - Image format detection, MIME types

**Toolbar**: Zoom -, Zoom level %, Zoom +, Fit, Reset, Fullscreen

📚 **Keyboard shortcuts**: [Keyboard Shortcuts](./keyboard-shortcuts.md#image-viewer)

---

## Transcription dialog

**Location**: `src/renderer/src/components/Transcription/`

Modal dialog for media file import with transcription (OpenAI API or local whisper.cpp). Composes on `BaseDialog` for portal rendering, overlay, and focus management. Mounted in `App.tsx` and opened automatically when importing audio (MP3, WAV, M4A, OGG, FLAC) or video (MP4, MOV, AVI, MKV, WebM, FLV, WMV) files. Media files are detected by `useImport` and routed to the dialog with pre-validation.

**Components**:
- `TranscriptionDialog.tsx` – Composes on BaseDialog; progress bar, error display, cancel
- `LanguageSelect.tsx` – Dropdown with 31 languages + auto-detect option

**State**: `useTranscriptionStore.ts` (Zustand) manages dialog visibility, progress, result, error

**Features**:
- Composes on BaseDialog (`closeOnEscape={false}`, `closeOnBackdrop={false}`) with custom Escape handling (cancel when transcribing, close otherwise)
- Tab-cycling focus trap (unique to this dialog – BaseDialog only auto-focuses)
- Progress bar with percentage, ETA, and chunk indicator ("chunk N of M")
- ARIA: `role="progressbar"`, `aria-live` on phase text/error/success, `aria-describedby`
- Cancel via footer button or Escape key
- Error display with retry option and actionable suggestions per error code
- Language selector: 31 options (persists within session)
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
