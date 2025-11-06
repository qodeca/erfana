# Project Context

## Purpose

**ERFANA** is an Electron-based markdown IDE designed for developers and technical writers who need an integrated environment for markdown editing, project management, and terminal access.

### Goals
- **Unified Workspace**: Combine markdown editing, file management, and terminal in a single application
- **Developer Experience**: Provide VS Code-style UX patterns (drag-drop, keyboard shortcuts, context menus)
- **AI-Powered Workflows**: Template-driven text operations for AI-assisted writing (Elaborate, Modify, Ask)
- **Performance**: Fast, responsive UI with proper state management and optimized rendering
- **Cross-Platform**: Support macOS, Windows, and Linux with native builds

### Key Features
1. **Markdown Editor**: Monaco-based editor with live preview, scroll sync, and Mermaid diagram support
2. **Project Tree**: File explorer with drag-drop reorganization, markdown filtering, and context menu operations
3. **Integrated Terminal**: xterm.js with PTY backend, clean initialization, and scroll position preservation
4. **Prompt Templates**: YAML frontmatter-driven templates for AI text operations with auto-execution

## Tech Stack

### Core Framework
- **Electron 33.2.0**: Desktop app framework (Chromium 130 + Node.js 20)
- **React 18.3.1**: UI library with functional components and hooks
- **TypeScript 5.7.2**: Strict mode enabled for type safety
- **Electron Vite 2.3.0**: Build tool with HMR support

### UI Components & Layout
- **@dnd-kit/core 6.3.1**: Drag-and-drop system for file reorganization
- **@monaco-editor/react 4.6.0**: Code editor component
- **dockview 1.16.4**: Tabbed panel system (editor tabs)
- **xterm 5.5.0**: Terminal emulator with WebGL rendering
- **lucide-react 0.468.0**: Icon library
- **react-markdown 9.0.1**: Markdown rendering with remark/rehype plugins

### Backend & Services
- **node-pty 1.0.0**: PTY (pseudo-terminal) for terminal backend
- **chokidar 4.0.1**: File system watcher
- **electron-store 10.0.0**: Persistent settings storage
- **zod 3.24.1**: Runtime schema validation for IPC contracts

### Testing & Quality
- **Vitest 2.1.8**: Test runner with workspace support
- **@testing-library/react 16.1.0**: React component testing
- **@vitest/ui 2.1.8**: Web-based test UI
- **ESLint 9.15.0**: Linting with TypeScript support
- **Prettier**: Code formatting (via ESLint integration)

### Build & Distribution
- **electron-builder 25.1.8**: Packaging for macOS/Windows/Linux
- **DMG**: macOS universal binary (Apple Silicon + Intel)
- **NSIS**: Windows installer
- **AppImage/deb/snap**: Linux distributions

## Project Conventions

### Code Style

#### TypeScript
- **Strict mode enabled**: All strict compiler options active
- **Explicit types**: Avoid `any`, use `unknown` when necessary
- **Interface over type**: Use interfaces for object shapes, types for unions/intersections
- **No implicit any**: All function parameters and return types must be typed

#### Naming Conventions
- **Files**: PascalCase for components (`ProjectTree.tsx`), camelCase for utilities (`fileHelpers.ts`)
- **Components**: PascalCase React functional components
- **Hooks**: Prefix with `use` (`useProjectManagement`, `useFileOperations`)
- **Stores**: Prefix with `use` for Zustand stores (`useProjectStore`, `useClipboardStore`)
- **Services**: PascalCase with `Service` suffix (`FileService`, `TerminalService`)
- **Interfaces**: PascalCase, prefix with `I` for service contracts (`IFileService`)
- **Constants**: UPPER_SNAKE_CASE for global constants
- **CSS classes**: kebab-case with BEM-like structure

#### React Patterns
- **Functional components only**: No class components
- **Hooks for state**: useState, useEffect, custom hooks
- **Zustand for global state**: Avoid prop drilling, use stores for shared state
- **Controlled components**: Forms use controlled inputs
- **Event handlers**: Prefix with `handle` (`handleClick`, `handleDragStart`)
- **Props interfaces**: Named `<ComponentName>Props`

#### File Organization
```
Component.tsx                    # Main component
Component.css                    # Component styles
Component.test.tsx              # Component tests
useComponentHook.ts             # Custom hook
useComponentHook.logic.ts       # Extracted pure logic
useComponentHook.logic.test.ts  # Pure logic tests
```

### Architecture Patterns

#### SOLID Principles
- **Single Responsibility**: Each service/component has one reason to change
  - `FileService` handles file I/O only
  - `TerminalService` handles PTY management only
  - Separate concerns: validation, UI, business logic

- **Open/Closed**: Extensible without modification
  - Dialog system accepts new dialog types via context
  - Context menu uses Factory pattern for new commands
  - Prompt system supports new templates without code changes

- **Liskov Substitution**: Subtypes must be substitutable
  - All dialogs implement `BaseDialog` contract
  - Services implement interfaces (`IFileService`, `ITerminalService`)

- **Interface Segregation**: No forced dependencies
  - Services expose only methods clients need
  - Preload API organized by feature area (file, terminal, settings)

- **Dependency Inversion**: Depend on abstractions
  - Hooks depend on service interfaces, not implementations
  - Test mocks implement same interfaces as real services

#### Design Patterns Applied
- **Service Locator**: IPC handlers route to services (main process)
- **Factory Pattern**: Context menu command creation based on node type
- **Strategy Pattern**: Prompt template selection and rendering
- **Observer Pattern**: File watchers → events → UI updates
- **Bootstrap Pattern**: Terminal initialization with marker-based handoff
- **HOC Pattern**: `withWatcherPause` wraps operations to coordinate watchers
- **Command Pattern**: Context menu actions as command objects

#### IPC Communication Pattern
```
Renderer (React)
  ↓ window.api.file.readFile(path)
Preload (Context Bridge)
  ↓ ipcRenderer.invoke('file:read', path)
IPC Handler (file-handlers.ts)
  ↓ fileService.readFile(path)
Service (FileService.ts)
  ↓ fs.promises.readFile(path)
```

- **Type Safety**: Zod schemas validate IPC payloads
- **Error Handling**: Errors serialized and thrown in renderer
- **Events**: `ipcMain.on` + `webContents.send` for async events

#### State Management
- **Zustand stores**: Global state (projects, terminals, clipboard, activity bar)
- **React hooks**: Local component state
- **Custom hooks**: Shared stateful logic (useProjectManagement, useFileOperations)
- **Pure logic extraction**: Extract to `.logic.ts` for testability

### Testing Strategy

#### Test Organization
- **Vitest Workspace**: 3 separate test contexts (main, preload, renderer)
- **Co-location**: Tests live next to source files (*.test.ts)
- **Naming**: `Component.test.tsx`, `service.test.ts`, `hook.logic.test.ts`

#### Test Patterns
1. **Pure Logic Extraction** (preferred):
   ```typescript
   // useHook.logic.ts - Pure functions
   export function calculateSomething(input: string): number { ... }

   // useHook.logic.test.ts - Fast unit tests
   describe('calculateSomething', () => {
     it('returns correct value', () => {
       expect(calculateSomething('test')).toBe(4)
     })
   })
   ```
   - Benefits: Fast (~24ms for 173 tests), deterministic, reusable

2. **Component Testing**:
   - Use `@testing-library/react` for user-centric tests
   - Test behavior, not implementation
   - Mock external dependencies (window.api, Zustand stores)

3. **Service Testing**:
   - Mock filesystem (fs-extra) for isolation
   - Test error handling and edge cases
   - Verify IPC handler integration

#### Coverage Requirements
- **Target**: 80%+ coverage for critical paths
- **Reports**: HTML + lcov + text-summary in `coverage/<project>/`
- **Command**: `npm run test:cov`

#### Test Utilities
- **Fixtures**: Factory functions for mock data (`mockPromptVariables`, `TEST_TEMPLATES`)
- **Mocks**: Reusable mocks (`createMockWindowApi`, `resetStores`)
- **Helpers**: Test utilities for common setup/teardown

### Git Workflow

#### Branching Strategy
- **main**: Production-ready code, always stable
- **feature/***: Feature development branches
- **fix/***: Bug fix branches
- **chore/***: Maintenance tasks (docs, deps, refactoring)

#### Commit Conventions
- **Format**: `<type>: <description>` (no scope, lowercase description)
- **Types**:
  - `feat`: New feature
  - `fix`: Bug fix
  - `refactor`: Code restructuring without behavior change
  - `test`: Adding or updating tests
  - `docs`: Documentation updates
  - `chore`: Maintenance (deps, build config)
  - `perf`: Performance improvements

- **Examples**:
  - `feat: add drag-drop file reorganization`
  - `fix: prevent terminal scroll jumping during streaming`
  - `refactor: extract pure logic from useProjectManagement hook`
  - `test: add 320 tests for ProjectTree refactoring`
  - `docs: split terminal.md into subfolder structure`

#### Release Strategy
- **Versioning**: Semantic versioning (MAJOR.MINOR.PATCH)
- **Tags**: Annotated tags with release notes (`git tag -a v0.3.8 -m "..."`)
- **Build Artifacts**: DMG for macOS, NSIS for Windows, AppImage for Linux

## Domain Context

### Electron Application Architecture
- **Three Processes**: Main (Node.js backend), Preload (secure bridge), Renderer (Chromium UI)
- **Security**: Context isolation enabled, no node integration in renderer
- **IPC**: All communication via context bridge (preload) using typed contracts

### Markdown Ecosystem
- **Syntax**: CommonMark + GFM (GitHub Flavored Markdown)
- **Extensions**: YAML frontmatter, Mermaid diagrams, task lists
- **Rendering**: remark (parsing) → rehype (transformation) → React components
- **Preview**: Synchronized scrolling between editor and preview panes

### Terminal Integration
- **PTY Backend**: node-pty provides pseudo-terminal (pty.spawn)
- **Terminal Emulator**: xterm.js renders ANSI escape sequences
- **Bootstrap Pattern**: Clean initialization without visible artifacts
- **Shell Detection**: Auto-detect user shell from $SHELL environment variable

### File System Operations
- **Watching**: chokidar for efficient file/directory watching
- **Symlinks**: Detected but not followed by watchers (prevents infinite loops)
- **Auto-Numbering**: Conflict resolution via automatic numbering (file.txt → file (2).txt)
- **Rollback**: Backup and restore on failed operations

### AI Workflow Integration
- **Prompt Templates**: YAML frontmatter + markdown body
- **Variables**: `{{selection}}`, `{{clipboard}}`, custom inputs
- **Auto-Execute**: Automatically send to terminal after rendering (200ms delay)
- **Claude Code Integration**: Designed to work with Claude Code CLI

## Important Constraints

### Technical Constraints
- **Node.js Version**: 18+ required (Electron 33 ships with Node.js 20)
- **Python Version**: 3.12 required for node-pty compilation (3.13 fails)
- **Memory**: Monaco Editor + xterm.js requires ~100MB base memory
- **File Size**: Individual markdown files should be <10MB for smooth rendering
- **Directory Depth**: Watcher depth configurable (default: 5 levels) to prevent performance issues

### Platform Constraints
- **macOS**: Universal binary (Apple Silicon + Intel), requires code signing for distribution
- **Windows**: NSIS installer, requires admin privileges for installation
- **Linux**: AppImage (no dependencies), deb/snap (system integration)
- **File Paths**: Must handle case-sensitive (Linux/macOS) and case-insensitive (Windows) filesystems

### Security Constraints
- **CSP**: Content Security Policy blocks inline scripts, `eval()`, unsafe protocols
- **Dangerous Protocols**: Block `javascript:`, `data:`, `vbscript:`, `file://` in markdown links
- **XSS Prevention**: Sanitize all HTML in markdown preview
- **Path Traversal**: Validate all file paths before filesystem operations
- **IPC Validation**: Zod schemas validate all cross-process communication

### Performance Constraints
- **Startup Time**: Target <2s from launch to first render
- **File Tree**: Should handle 10,000+ files without lag (virtualization not yet implemented)
- **Terminal Scrollback**: Limited to 1000 lines (configurable via xterm.js options)
- **Watcher Debouncing**: 100ms debounce on directory changes to prevent cascades

### Business Constraints
- **Offline-First**: All core features must work without internet
- **No Telemetry**: No usage tracking or analytics
- **Open Source**: MIT license, all code publicly available
- **No Vendor Lock-in**: Plain markdown files, no proprietary formats

## External Dependencies

### Critical Dependencies (Cannot Function Without)
- **node-pty**: PTY backend for terminal (native Node.js module)
  - Requires Python 3.12 + build tools for compilation
  - Optional graceful degradation if unavailable

- **electron-store**: Settings persistence
  - Uses encrypted storage on macOS/Windows

- **chokidar**: File system watching
  - Native fsevents on macOS, fs.watch on Windows/Linux

### UI Dependencies
- **Monaco Editor**: Code editor component
  - Large bundle size (~5MB minified)
  - Requires web workers for syntax highlighting

- **xterm.js**: Terminal emulator
  - WebGL addon for GPU-accelerated rendering
  - Web links addon for clickable URLs

- **Mermaid.js**: Diagram rendering
  - Dynamically imported only when diagrams detected
  - Error recovery if rendering fails

### Build Dependencies
- **electron-builder**: Creates platform-specific installers
  - macOS: DMG creation requires macOS host
  - Windows: NSIS on any platform
  - Linux: AppImage on any platform

### Optional Integrations
- **Claude Code CLI**: AI assistant integration via terminal auto-execute
- **Git**: Version control awareness (future feature)
- **Language Servers**: LSP support for markdown linting (future feature)

## Development Environment

### Required Tools
- **Node.js 18+**: Runtime and build tool
- **Python 3.12**: For node-pty native module compilation
- **Git**: Version control
- **macOS**: For building DMG files (optional for development)

### Recommended Tools
- **VS Code**: IDE with TypeScript + ESLint integration
- **React DevTools**: Browser extension for React debugging
- **Electron DevTools**: Built-in Chromium DevTools

### Environment Variables
- **Development**: `NODE_ENV=development` enables HMR and DevTools
- **Production**: `NODE_ENV=production` optimizes bundle and disables DevTools
- **Testing**: `NODE_ENV=test` for Vitest test runs

## Documentation Standards

### File Organization
- **Location**: `/docs/` directory
- **Length**: ≤500 lines per file (Claude Code token efficiency)
- **Structure**: README.md + topical files in subfolders
- **Format**: GitHub Flavored Markdown

### Documentation Types
1. **Architecture Docs**: System design, patterns, decisions (`docs/architecture.md`)
2. **Feature Docs**: Implementation details by feature (`docs/drag-drop/`, `docs/terminal/`)
3. **Testing Docs**: Test patterns, coverage, strategies (`docs/testing/`)
4. **Troubleshooting**: Known issues, workarounds (`docs/known-issues.md`)

### Update Triggers
- **Code Changes**: Update relevant docs when refactoring
- **New Features**: Add feature documentation before PR merge
- **Bug Fixes**: Document workarounds in known-issues.md
- **Breaking Changes**: Update CLAUDE.md with version notes
