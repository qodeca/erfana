# ERFANA - Project Instructions for Claude

## Project Overview
Electron-based markdown IDE with integrated terminal and project management.
- **Repository**: `qodeca/erfana` (GitHub)
- **Version**: 0.5.4
- **Tech Stack**: Electron 33, React 18, TypeScript 5.7, Monaco Editor, xterm.js
- **Architecture**: Hybrid SplitviewReact (layout) + DockviewReact (tabs)
- **Node Version**: 18+

## Key Commands
```bash
npm run dev          # Development server
npm run build        # Production build
npm run typecheck    # Type checking
npm run lint         # Linting
npm run build:mac    # macOS build

# Tests
npm run test         # Vitest workspace (one-shot)
npm run test:renderer
npm run test:main
npm run test:preload
npm run test:cov     # Coverage (v8) per project
```

## Project Structure
```
src/
├── main/           # Electron main process
│   ├── services/   # FileService, TerminalService, SettingsService, import/
│   └── ipc/        # IPC handlers
├── preload/        # Context bridge API
├── shared/         # Shared code (errors.ts, constants.ts)
└── renderer/       # React UI
    ├── components/ # UI components (Tabs/, Dialog/, ContextMenu/, etc.)
    ├── context/    # React contexts (ProjectManagementContext)
    ├── stores/     # Zustand state
    └── prompts/    # Template system
```

## Core Features
1. **Markdown Editor** - Monaco with live preview, scroll sync, Mermaid diagrams
2. **Project Tree** - File explorer with drag-drop reorganization, markdown filtering, context menu, git status indicators
3. **Terminal** - xterm.js with PTY backend
4. **Prompt Templates** - AI text operations via context menu

## Documentation
See `docs/` for details (keep Claude's context focused):
- [Architecture](docs/architecture.md) — System design patterns, SOLID principles, DI
- [Drag-Drop](docs/drag-drop/README.md) — VS Code-style file reorganization, visual feedback, validation
- [Terminal](docs/terminal/README.md) — Bootstrap pattern, flickering prevention, scroll fixes
- [Editor](docs/editor/README.md) — Monaco, preview, scroll sync
- [File Watching](docs/file-watching/README.md) — Auto-refresh, recoverable ENOENT, session tokens
- [IPC Patterns](docs/ipc-patterns.md) — Schemas, broadcast, race-guard tokens
- [Testing](docs/testing/README.md) — Workspace, coverage (3512 tests, 119 files)
- [Known Issues](docs/known-issues.md) — Limitations and workarounds
- [GitHub Issues Protocol](docs/claude-code/github-issues-protocol.md) — When/how Claude Code uses `gh` CLI for issues

## Code Style & Conventions
- TypeScript strict mode enabled
- React functional components with hooks
- Zustand for state management
- IPC pattern: main/services → ipc/handlers → preload → renderer
- CSS modules for component styling
- Lucide React for icons

## UI Style Guide (MANDATORY)

**Before implementing ANY UI changes, you MUST:**

1. **Read the style guide**: [docs/ui-style-guide.md](docs/ui-style-guide.md)
2. **Use design tokens**: All CSS values come from `src/renderer/src/styles/design-tokens.css`

### Rules (Non-Negotiable)

| Category | Rule | Example |
|----------|------|---------|
| Colors | Use `var(--color-*)` tokens | `color: var(--color-text-primary)` |
| Spacing | Use `var(--space-*)` tokens | `padding: var(--space-6)` (12px) |
| Typography | Use `var(--text-*)` and `var(--font-*)` | `font-size: var(--text-base)` (13px) |
| Borders | `border-radius: 0` always | Exception: `50%` for circles only |
| Transitions | Use `var(--transition-normal)` | `transition: var(--transition-normal)` (0.15s) |
| Z-Index | Use `var(--z-*)` tokens | `z-index: var(--z-modal)` |
| Shadows | Use `var(--shadow-*)` tokens | `box-shadow: var(--shadow-md)` |

### Quick Reference - Common Tokens

```css
/* Colors (Qodeca Brand) */
--color-text-primary       /* #cccccc - main text */
--color-text-secondary     /* #858585 - muted text */
--color-bg-primary         /* #161312 - Smoky Black (main background) */
--color-bg-secondary       /* #2d2d30 - panels */
--color-border-default     /* #3c3c3c - borders */
--color-accent-primary     /* #A0A8FF - Qodeca Violet */
--color-accent-secondary   /* #E3E829 - Qodeca Lime */

/* Spacing (4px grid) */
--space-4   /* 8px */
--space-6   /* 12px */
--space-8   /* 16px */
--space-12  /* 24px */

/* Typography */
--text-base /* 13px - default */
--text-sm   /* 11px - small */
```

### Checklist Before Committing UI Changes

- [ ] All colors use design tokens (no hardcoded hex values)
- [ ] All spacing uses design tokens (no arbitrary px values)
- [ ] All fonts use design tokens
- [ ] No rounded corners (border-radius: 0)
- [ ] Transitions use tokens
- [ ] Focus states are visible (accessibility)

## Recent Changes (v0.5.4)
- **Forced Scroll-to-Bottom After Prompt Execution** (Dec 1, 2025):
  - Automatically scrolls terminal to bottom 1 second after prompt template execution (issue #52)
  - **User Intent Respect**: Skips scroll if user manually scrolled during the 1-second delay window
  - **Integration**: Works with all prompt templates (Elaborate, Modify, Ask, diagram chat, Mermaid direction changes, import organization)
  - **Architecture**: Pure logic module (`promptScrollScheduler.logic.ts`) with zero React dependencies
  - **Coordination**: Uses `lastUserScrollTsRef` from `useScrollAnomalyRecovery` for user scroll detection
  - **Edge Cases Handled**: Terminal not ready, controls unavailable, panel closed, rapid execution
  - New files:
    - `src/renderer/src/utils/promptScrollScheduler.logic.ts` - Pure scheduling logic (141 lines)
    - `src/renderer/src/utils/promptScrollScheduler.logic.test.ts` - 66 comprehensive tests (872 lines)
  - Updated files:
    - `src/renderer/src/utils/panelUtils.ts` - Added `completionTs` to PromptResult
    - `src/renderer/src/context/TerminalPortalContext.tsx` - Registered `lastUserScrollTsRef` with ref-only pattern
    - `src/renderer/src/components/Panels/TerminalPanel.tsx` - Extracted and registered scroll timestamp ref
    - 6 integration points: PreviewContextMenu, ChatBubble (2 call sites), MermaidToolbar, MermaidDiagram, useImport
  - **Total: 3512 tests passing** (119 test files, +66 tests for scroll scheduler, +4 for completionTs)
  - Closes #52
- **Mermaid Toolbar Restructuring** (Dec 1, 2025):
  - Unified MermaidToolbar design with expand button integrated into direction container (issue #53)
  - **Structure**: Expand button now inside `.mermaid-toolbar-directions` container (rightmost position)
  - **Sizing**: Expand button resized from 28×28px to 24px height (matches direction buttons)
  - **Hover**: Unified lime hover (`--color-brand-lime`) for ALL buttons (direction + expand)
  - **Disabled state**: Active/disabled buttons protected from hover (violet background preserved)
  - Files changed:
    - `src/renderer/src/components/Editor/MermaidToolbar/MermaidToolbar.tsx` - Container restructure
    - `src/renderer/src/components/Editor/MermaidToolbar/MermaidToolbar.css` - Sizing and hover unification
    - `src/renderer/src/components/Editor/MermaidToolbar/MermaidToolbar.test.tsx` - Updated 3 tests
  - All 3426 tests passing (26 MermaidToolbar tests)
  - Closes #53
- **Flicker-Free Terminal Scroll Recovery** (Dec 1, 2025):
  - Eliminated visible flicker using xterm.js parser hooks for same-frame scroll restoration
  - **Before**: Recovery happened AFTER scroll jump was visible (flicker)
  - **After**: Parser intercepts ED 2/3 sequences BEFORE execution, restores via `queueMicrotask()` (no flicker)
  - Two-layer defense architecture:
    1. **Primary**: Parser hooks intercept CSI ED sequences, restore in same frame
    2. **Fallback**: Multi-signal detection (50ms interval, down from 100ms) for edge cases
  - Coordination mechanism prevents double-recovery when both layers trigger
  - New files:
    - `src/renderer/src/hooks/useTerminalParserHooks.ts` - xterm.js parser integration (271 lines)
    - `src/renderer/src/hooks/useTerminalParserHooks.test.ts` - 24 pure logic tests
  - Updated files:
    - `src/renderer/src/hooks/useScrollAnomalyRecovery.ts` - Added coordination via parserHandledRef
    - `src/renderer/src/utils/scrollAnomalyDetector.ts` - 50ms interval (was 100ms)
    - `src/renderer/src/components/Panels/TerminalPanel.tsx` - Parser hooks integration
    - Test mocks updated with `parser.registerCsiHandler()`
  - **Total: 3426 tests passing** (118 test files, 24 new parser hook tests)
  - Addresses Claude Code issues #826, #10769
  - See [docs/terminal/scroll-fixes.md](docs/terminal/scroll-fixes.md)
- **Git Status Light Colors** (Dec 1, 2025):
  - Added lighter, pastel-like color variants for git status indicators (40-50% lighter)
  - Context-specific usage strategy:
    - **Light variants**: File badges, file names, status bar counts (better readability)
    - **Original vibrant colors**: Folder dots (strong visual hierarchy)
  - Special Indigo fix: 100% lighter (#3F3FBA → #8F8FE5) to improve contrast for Renamed status
  - All light variants meet WCAG AA accessibility standard (4.5:1), most achieve AAA (7:1)
  - Files changed:
    - `src/renderer/src/styles/design-tokens.css` - Added 6 light variant tokens
    - `src/renderer/src/components/ProjectTree/ProjectTree.css` - Updated badges, file names, status bar
    - `docs/ui-style-guide.md` - Documented color strategy and usage contexts
  - No test changes needed (styling only, all 3426 tests passing)
  - See [docs/ui-style-guide.md](docs/ui-style-guide.md#git-status-colors)
- **Git Status Indicators in Project Tree** (Nov 30, 2025):
  - VS Code-style git status indicators showing file/folder modification state (issue #29)
  - Read-only visual badges: Modified (M/Amber), Untracked (U/Lime), Deleted (D/Coral), Staged (A/Violet), Conflicted (!/Magenta)
  - Folder status propagation with colored dots (horizontally aligned with badges)
  - Git status bar at bottom of Project Tree: branch name + colored status counts
  - Auto-refresh with 1s debounce, 2s cooldown, pauses when tab unfocused
  - Uses isomorphic-git library (pure JavaScript, no git CLI dependency)
  - Performance: 10,000 file cap for large repositories
  - UI polish: Brighter text for unchanged files, violet icons for markdown files
  - Brand palette colors for all git statuses (Qodeca brand alignment)
  - New files:
    - `src/shared/ipc/git-schema.ts`: Zod schemas for git status types
    - `src/main/services/GitStatusService.ts`: Service using isomorphic-git statusMatrix()
    - `src/main/ipc/git-handlers.ts`: IPC handler with path validation
    - `src/renderer/src/stores/useGitStore.ts`: Zustand store for git state
    - `src/renderer/src/hooks/useGitStatus.ts`: Hook with debounce/cooldown logic
    - `src/renderer/src/utils/gitStatus.logic.ts`: Pure logic for status mapping
    - `src/renderer/src/components/ProjectTree/GitStatusBadge.tsx`: File/folder status badge
    - `src/renderer/src/components/ProjectTree/GitStatusBar.tsx`: Status bar component
  - **Total: 3352 tests passing (117 test files)**
  - Closes #29
- **Fix: Git Status Not Updating After File Operations** (Nov 30, 2025):
  - Fixed multiple bugs where git status badges/counts wouldn't update after file operations
  - Root cause #1: Race condition in `withWatcherPause` - flag reset after watcher resumed
  - Root cause #2: Context menu commands didn't call git refresh (only toolbar did)
  - Root cause #3: Cooldown logic dropped rapid refresh requests instead of rescheduling
  - Solutions:
    - Reset `isInternalOperationRef` BEFORE resuming watcher
    - Add `onGitRefresh` callback to `MenuContext` and call in all mutating commands
    - Cooldown now always reschedules (latest request wins)
  - Known limitation: Global `.gitignore` files not supported (isomorphic-git limitation)
  - See: [Known Issues - Git Status](docs/known-issues.md#git-status-global-gitignore-not-supported)
- **Terminal Panel Requires Project** (Nov 30, 2025):
  - Terminal panel completely hidden when no project is loaded (issue #46)
  - ActivityBar config extended with `requiresProject?: boolean` field
  - Terminal config: `requiresProject: true` hides button on Welcome screen
  - Right activity bar returns `null` (hidden) when no panels to show
  - Terminal panel dynamically added/removed from SplitviewReact based on projectPath
  - Sash (resize handle) hidden when terminal panel is removed
  - Keyboard shortcut (Cmd+J) silently ignored when no project
  - `isSplitviewReady` state ensures terminal panel added after API ready (initial load fix)
  - Resize listener properly disposed on panel removal (memory leak prevention)
  - Files changed:
    - `src/renderer/src/components/ActivityBar/activityBarConfig.ts` - Added requiresProject field
    - `src/renderer/src/components/ActivityBar/ActivityBar.tsx` - Filter panels, return null when empty
    - `src/renderer/src/components/DockLayout/AppDockLayout.tsx` - Dynamic panel add/remove with proper cleanup
  - 46 new tests for ActivityBar filtering logic
  - Closes #46
- **Fix: Terminal AutoExecute Regression & Infinite Loop** (Nov 30, 2025):
  - Fixed issue #41: AutoExecute regression in context menu actions (Elaborate, Modify, Ask)
  - Root cause #1: Atomic write pattern didn't work reliably with PTY buffering
  - Solution: 200ms delay pattern - write text first, wait 200ms, then send Enter (`\r`)
  - PTY buffering + shell line discipline need time before Enter key is processed
  - Fixed infinite loop "Maximum update depth exceeded" in TerminalPortalContext
  - Root cause #2: `terminalControls` state in context caused re-render cycle
  - Solution: Ref-only approach - use getters for `terminalControls`/`isTerminalReady`
  - Files changed:
    - `src/renderer/src/stores/useTerminalStore.ts` - 200ms delay pattern
    - `src/renderer/src/context/TerminalPortalContext.tsx` - Ref-only approach
    - `src/renderer/src/utils/panelUtils.ts` - Debug logging
  - 3 new tests for autoExecute timing verification
  - Closes #41
- **Complete Style Guide Compliance Audit** (Nov 30, 2025):
  - Migrated all 23 CSS files to use design tokens (100% compliance)
  - All hardcoded colors, spacing, typography, borders now use `var(--*)` tokens
  - Dockview sash color changed to Qodeca Lime (`--color-accent-secondary`)
  - Dockview sash width reduced from 8px to 4px (thinner, cleaner)
  - Monaco syntax highlighting uses neutral grays for readability
  - See [docs/ui-style-guide.md](docs/ui-style-guide.md) for complete token reference
- **Fix: DiagramViewer Wrong Diagram on Expand** (Nov 29, 2025):
  - Fixed bug where expanding a Mermaid diagram in Preview sometimes opened a different diagram (issue #39)
  - Root cause: Position-based matching (20-line tolerance) caused false positives when diagrams <20 lines apart
  - Solution: Content-first identity with position tie-breaking:
    1. **Primary identity**: Content hash (`hashDiagramContent`) - survives line drift and external file reloads
    2. **Secondary identity**: Position proximity (10-line tolerance) - for edited content or identical diagrams
  - Content hash computed once at `openViewer()`, NEVER updated (stable identity)
  - Handles all scenarios: internal edits, external file changes, multiple identical diagrams
  - Store changes: Added `contentHash` and `originalEndLine` fields
  - 30 new regression tests for multi-diagram scenarios
  - **Total: 3003 tests passing (105 test files)**
  - Closes #39
- **Consolidate DiagramViewer Controls into Chat Panel** (Nov 29, 2025):
  - Moved toolbar controls into ChatBubble panel header (issue #37)
  - Removed 48px top toolbar, replaced with floating close button (28×28px, top-right)
  - Chat panel header now contains 3 control groups:
    1. Zoom controls: zoom in/out, zoom indicator, fit-to-view, reset
    2. Direction buttons: TB, LR, BT, RL (centered, for supported diagram types)
    3. Terminal controls: scroll-to-bottom, restart
  - FAB button icon changed from MessageCircle to Pencil (Edit diagram)
  - Removed close button from panel header (Escape or click outside to collapse)
  - Extended TerminalPortalContext with terminal control registration pattern
  - All keyboard shortcuts preserved (+, -, 0, F for zoom/fit)
  - Closes #37
- **Fix: DiagramViewer Refresh on Code Edit** (Nov 29, 2025):
  - Fixed bug where DiagramViewer would stop refreshing when diagram definition was modified (issue #38)
  - Root cause: Line number drift broke ID matching when user added/removed lines above diagram
  - Solution: Two-part matching strategy with `originalStartLine`:
    1. Store captures `originalStartLine` when viewer opens (NEVER updated)
    2. `updateDiagram` matches by `filePath` only (allows line drift)
    3. `MermaidDiagram` checks `startLine` within 20-line tolerance of `originalStartLine`
  - Now syncs `startLine`, `endLine`, and `diagramId` during updates
  - Works for edits within diagram block and when line numbers shift
  - Correctly handles multiple diagrams in same file (>20 lines apart)
  - Zoom/pan state still preserved during updates
  - Store changes: Added `originalStartLine` field
  - **Total: 2941 tests passing (104 test files)**
  - Closes #38
- **AI Chat Bubble in DiagramViewer** (Nov 28, 2025):
  - Floating chat bubble for contextual AI-assisted diagram modifications (issue #34)
  - FAB button in bottom-right corner of DiagramViewer, expands to slide-up panel
  - Auto-includes diagram context: Mermaid code, file path, line range
  - Cmd/Ctrl+Enter to send (matches PromptDialog pattern), Enter for newlines
  - Character limit: warning at 1000, max at 2000 characters
  - Click outside or Escape to collapse (preserves draft)
  - Input clears after send but panel stays expanded for follow-up messages
  - Zoom/pan state now persists across file changes (hasInitialized flag)
  - Pure logic extraction: `chatBubble.logic.ts` for testability
  - New files:
    - `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.tsx`: Chat component
    - `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.css`: Styles
    - `src/renderer/src/components/Editor/DiagramViewer/chatBubble.logic.ts`: Validation
    - `src/renderer/src/prompts/templates/mermaid-chat.md`: Prompt template
  - 66 new tests (38 logic + 28 component)
  - **Total: 2684 tests passing (94 test files)**
  - Closes #34

## Changes in v0.5.2
- **Mermaid Diagram Layout Direction Buttons** (Nov 28, 2025):
  - Add layout direction controls to Mermaid diagram hover toolbar (issue #32)
  - Unified toolbar: direction buttons + expand button appear on diagram hover
  - Comprehensive chart support: 7 Mermaid diagram types with direction capability:
    - flowchart/graph: TB, TD, BT, LR, RL (inline syntax)
    - stateDiagram, classDiagram, erDiagram, requirementDiagram: TB, BT, LR, RL (direction statement)
    - gitGraph: LR, TB, BT (colon syntax, LR default)
  - Current direction: disabled + highlighted (blue accent)
  - Clicking direction button executes prompt template with diagram context
  - Prompt includes file reference, line range, code, and target direction
  - Pure logic extraction: `mermaidDirections.ts` for testability
  - Helper functions: `usesDirectionStatement()`, `usesColonSyntax()` for syntax-aware prompts
  - New files:
    - `src/renderer/src/utils/mermaidDirections.ts`: Chart type detection, direction parsing
    - `src/renderer/src/components/Editor/MermaidToolbar/`: Unified toolbar component
    - `src/renderer/src/prompts/templates/mermaid-change-direction.md`: Prompt template
  - 151 new tests (125 logic + 26 component)
  - Closes #32

## Changes in v0.5.1
- **Mermaid Diagram Theming with Dark/Light Mode** (Nov 28, 2025):
  - Unified theming system for Mermaid diagrams with system preference detection
  - Consistent background colors between Preview and DiagramViewer components
  - Neutral/professional color palette optimized for readability in both modes
  - Auto-switching: Uses `prefers-color-scheme` media query with live updates
  - Architecture: Theme registry pattern for future theme expansion
  - New files:
    - `src/renderer/src/utils/mermaidThemes.ts`: Light/dark theme configurations
    - `src/renderer/src/stores/useThemeStore.ts`: System theme detection store
  - CSS updates: `@media (prefers-color-scheme: light)` blocks in MarkdownPreview.css and DiagramViewer.css
  - Fixed: DiagramViewer SVG had hardcoded white background (#ffffff) - now theme-aware
  - 43 new tests (22 for mermaidThemes, 21 for useThemeStore)
  - Closes #33
- **Fix: DiagramViewer Zoom Pixelation** (Nov 28, 2025):
  - Fixed Mermaid diagrams becoming pixelated when zooming (issue #31)
  - Root cause: CSS `transform: scale()` rasterizes SVG before scaling → pixelation
  - Solution: Scale SVG's width/height attributes directly (browser renders at target size natively)
  - Approach: Capture original dimensions → scale by zoom factor → CSS translate for panning
  - New pure functions for viewBox parsing (kept for potential future use)
  - Removed `will-change: transform` from CSS (no longer needed)
  - 51 new tests for viewBox functions
  - Closes #31
- **Full-Screen Mermaid Diagram Viewer** (Nov 27, 2025):
  - Expand Mermaid diagrams to full-screen overlay for detailed examination
  - Expand button appears on hover over diagrams (always visible on touch devices)
  - Zoom controls: mouse wheel zoom, +/- toolbar buttons
  - Pan support: click-drag to move diagram around viewport
  - Zoom indicator displays current zoom level percentage (e.g., "125%")
  - Fit-to-screen and reset buttons for quick navigation
  - Keyboard shortcuts: +/= (zoom in), - (zoom out), 0 (reset), F (fit), Escape (close)
  - Close via X button, Escape key, or backdrop click
  - Accessibility: ARIA labels, role="dialog", aria-modal, focus management, aria-live zoom indicator
  - Architecture: Pure logic extraction (`diagramViewer.logic.ts`) for testability
  - ViewBox-based zoom for crisp SVG scaling at any magnification level
  - SVG rendering uses same innerHTML injection as preview mode (Mermaid strict security)
  - Files: `src/renderer/src/components/Editor/DiagramViewer/`
  - 168 tests (128 logic + 40 component)
  - Closes #30

## Changes in v0.5.0 (was v0.4.8)
- **Smart Terminal File Links** (Nov 27, 2025):
  - Clickable file path links in terminal output with line:column support
  - Base feature: Detects absolute, relative, project-relative paths
  - Supports line:column notation (:42:10, (15,3))
  - Path validation with LRU cache (100 entries, 30s TTL)
  - Smart resolution: Falls back to filename search when exact path not found
  - FilePickerDialog: VS Code-style disambiguation when multiple files match
  - Keyboard navigation (Arrow Up/Down, Enter to select, Escape to cancel)
  - **Paths with spaces support** (VS Code-style fallback matchers):
    - Detects paths with spaces on their own line (e.g., `/Users/john/My Documents/report.pdf`)
    - Python error format: `File "/path/with spaces/file.py", line 42`
    - Windows paths: `C:\Program Files\My App\app.exe`
    - Bullet point lists: `- /path/to my/project/file.ts`
    - Based on VS Code Issue #97941 and PR #43733
  - Architecture: Pure logic extraction pattern for testability
    - `filenameIndex.ts`: Map-based O(1) filename lookup
    - `pathScoring.ts`: Candidate ranking algorithm
    - `smartPathResolver.logic.ts`: Resolution orchestration
    - `useFilenameIndex.ts`: Lazy index management hook
    - `FilePickerDialog.tsx`: Disambiguation UI component
    - `filePathLinks.logic.ts`: Fallback matchers for paths with spaces
  - 157 new tests for smart resolution and paths with spaces
  - Closes #26

## Changes in v0.4.7
- **Terminal Clipboard Support** (Nov 27, 2025):
  - Copy/paste operations in terminal panel via keyboard shortcuts and context menu
  - Smart Ctrl/Cmd+C: copies text when selected, sends SIGINT when no selection
  - Keyboard shortcuts: Ctrl+C/V (Windows/Linux), Cmd+C/V (macOS), Ctrl+Shift+C/V (explicit)
  - Right-click context menu with Copy (disabled when no selection) and Paste
  - Platform-specific shortcut display (⌘C/⌘V on macOS, Ctrl+C/Ctrl+V on Windows)
  - Selection preserved after copy (VS Code behavior), toast notification on success
  - Pure logic extraction pattern: `terminalClipboard.logic.ts` for testability
  - 103 new tests for clipboard functionality
  - Closes #28

## Changes in v0.4.6
- **VS Code-Inspired Watcher Performance** (Nov 25, 2025):
  - EventCoalescer, ThrottledWorker, AtomicSaveDetector, WatcherMetrics
  - 57 new tests for watcher components

## Changes in v0.4.5
- **File Watcher Selective Blacklist** (Nov 23, 2025):
  - Fixed issue #21: dotfolders like `.claude`, `.github` now properly watched
  - VS Code-style function-based ignore (more reliable than regex patterns)
  - Watches: `.claude/`, `.github/`, `.vscode/`, `.env`, dotfiles
  - Ignores (performance): `node_modules/`, `.venv/`, `.git/objects/`, build outputs
  - Closes #21
- **Unified Import System with Strategy Pattern** (Nov 23, 2025):
  - Refactored PDF import into extensible multi-file-type import architecture
  - Strategy Pattern: IConverter interface with PdfConverter, TextConverter implementations
  - Registry Pattern: ConverterRegistry maps extensions to converters
  - Factory Pattern: createConverterRegistry(), createImportService() for DI
  - Text file support: All UTF-8 files (txt, md, json, csv, xml, yaml, code files)
  - Text files keep original extension, PDFs convert to .md
  - Entry points: WelcomePanel "Import..." button, ProjectTree context menu
  - Architecture ready for future audio/video converters
  - Files: `src/main/services/import/` (types, converters/, ConverterRegistry, ImportService)
  - 296 new tests for import system (100% coverage)
- **Test Coverage**: **1923 tests passing (80 test files)**

## Changes in v0.4.4
- **PDF Import with AI-Assisted Organization** (Nov 22, 2025):
  - Import PDF files and convert to Markdown using @opendocsg/pdf2md
  - Output saved to `{project}/import/` directory (auto-created)
  - AI prompt auto-executes to help organize imported files
  - Error handling: Encrypted PDFs, empty PDFs, corrupted files, large files (>50MB warning)
  - Filename conflict resolution with auto-increment (file.md, file (1).md, etc.)
  - Closes #19
- **Organize-Import Prompt Enhancements** (Nov 22, 2025):
  - 7-step workflow: analyze document, analyze project conventions, suggest names/locations
  - 3-5 file name suggestions based on content and project conventions
  - 2-3 location suggestions with explanations
  - Cleanup option to delete original from import folder
  - Changed "Import PDF..." to "Import PDF" in menu
  - Closes #20

## Changes in v0.4.3
- **Terminal Scroll Auto-Recovery** (Nov 22, 2025):
  - Automatic detection and recovery from Claude Code Ink library scroll anomalies
  - Three-signal correlation: user scroll (300ms), data streaming (500ms), jump magnitude (≥10 lines)
  - `scrollAnomalyDetector.ts`: Pure detection logic (testable, no React)
  - `useScrollAnomalyRecovery.ts`: React hook integration with debounce
  - Complements existing "Scroll to Bottom" button with intelligent auto-recovery
  - 44 new tests (34 pure logic + 10 hook tests)
  - Closes #12
  - Files: `src/renderer/src/utils/scrollAnomalyDetector.ts`, `src/renderer/src/hooks/useScrollAnomalyRecovery.ts`

## Changes in v0.4.2
- **Chrome-style Dynamic Tabs** (Nov 22, 2025):
  - EditorTab component with dynamic sizing (min 80px, max 300px, flex 1 1 0)
  - Dirty indicator (filled circle) for unsaved changes
  - Close button with confirmation dialog for dirty files
  - Middle-click to close support
  - Context menu: Close, Close Others (with disabled state), Close All
  - Relative path tooltips from project root
  - Home/Welcome tab fixed at 41px (no scaling)
  - Hover indication on tabs
  - 62 new tests for tab functionality
  - Files: `src/renderer/src/components/Tabs/`
- **ContextMenu Disabled State** (Nov 22, 2025):
  - Added `disabled` property to ContextMenuItem interface
  - Disabled items are grayed out and non-clickable
- **implementing-issues skill** (Nov 22, 2025):
  - 11-phase workflow (Pre-flight → Release)
  - 3 complexity tiers with appropriate checkpoints
  - Agent orchestration with explicit Task tool examples
  - Templates for implementation plans and PR descriptions
  - Located in `.claude/skills/implementing-issues/`

## Changes in v0.4.0-0.4.1
- **ProjectManagementContext Singleton** (Nov 22, 2025):
  - Fixed duplicate toast issue when opening projects from Recent Projects
  - Both ProjectTree and WelcomePanel were creating separate useProjectManagement instances
  - Each registered their own IPC listeners causing duplicate "Project Opened" toasts
  - Solution: Context ensures only ONE instance, meaning ONE IPC listener and ONE toast per event
  - ISP-compliant hooks: `useProjectManagementContext()`, `useOpenProjectByPath()`, `useProjectChangedEffect()`
  - See `src/renderer/src/context/ProjectManagementContext.tsx`
- **Claude Code Skills** (Nov 22, 2025):
  - Added `managing-skills`: Guides through skill creation following best practices
  - Added `creating-issues`: Creates structured GitHub issues from user descriptions
  - Skills located in `.claude/skills/`

## Older Changes (v0.3.x)
See [docs/CHANGELOG.md](docs/CHANGELOG.md) for historical changelog entries (v0.3.0 - v0.3.9).

## Working Areas
- `src/renderer/src/components/` - UI components
- `src/main/services/` - Backend services
- `docs/` - Documentation files

## Testing
- Unit/Integration: Vitest workspace across renderer, main, preload (see docs/testing/README.md).
- Coverage: `npm run test:cov` (text + lcov + HTML under `coverage/<project>/`).
- Visual/MCP Scenarios: See docs/testing/ui-scenarios.md and docs/testing/interaction-scenarios.md.

## Project Switching Safeguards
- Unsaved editor prompt on open/close (Discard/Cancel)
- Terminal activity heuristic:
  - Per-terminal tracking, marks on input + output
  - 500ms warm-up ignore
  - 20s busy window
  - Clears on exit and after Ctrl+C if quiet
- Terminal initialization defers until panel is visible
- Watchers increment session tokens on switch; stale events dropped

## IPC Contracts
- Shared schemas/types: `src/shared/ipc/schema.ts` (zod)
- `project:changed` payload: `{ oldPath: string | null; newPath: string | null }`

## Important Notes
- node-pty may fail to build on Python 3.13 (use 3.12)
- electron-store requires dynamic import (ES module)
- CSP configured for security (no inline scripts)
- All dangerous HTML elements blocked in preview
