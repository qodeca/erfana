# Glossary

Project-specific terminology used in Erfana documentation and code.

## Architecture

| Term | Definition |
|------|------------|
| **Main process** | Electron's Node.js process that manages windows, file system, and native APIs |
| **Renderer process** | Electron's browser process that runs the React UI |
| **Preload** | Bridge script that exposes safe APIs from main to renderer via contextBridge |
| **IPC** | Inter-Process Communication between main and renderer processes |
| **Hybrid layout** | SplitviewReact for outer panels + DockviewReact for editor tabs |

## Components

| Term | Definition |
|------|------------|
| **Activity bar** | Vertical icon bar on the far left (project, settings icons) |
| **Sidebar** | Left panel containing Project Tree and Settings |
| **Project Tree** | File explorer showing project directory structure |
| **Terminal Panel** | xterm.js terminal at the bottom of the window |
| **Editor Tabs** | DockviewReact tabs for open markdown files |
| **Split View** | Side-by-side editor and preview with scroll sync |

## Features

| Term | Definition |
|------|------------|
| **Bootstrap pattern** | Clean terminal initialization without visible artifacts |
| **Scroll sync** | Bidirectional scrolling between editor and preview |
| **Design tokens** | CSS custom properties defining colors, spacing, typography |
| **Prompt templates** | AI-powered text operations via context menu |
| **AutoExecute** | Automatically run prompt in terminal after generation |
| **Git status indicators** | VS Code-style badges (M/U/D/A/!) on files |

## Services

| Term | Definition |
|------|------------|
| **FileService** | Handles file read/write operations |
| **TerminalService** | Manages PTY instances for terminal emulation |
| **DirectoryWatcherService** | Monitors file system changes for auto-refresh |
| **FileWatcherService** | Watches individual files for external changes |
| **GitStatusService** | Tracks git status using isomorphic-git |
| **SettingsService** | Per-project settings persistence |
| **GlobalSettingsService** | Application-wide settings in `~/.erfana/` |
| **ProjectLockService** | File-based locking for multi-instance support |
| **TranscriptionService** | Audio-to-text transcription via OpenAI API (GPT-4o-transcribe, Whisper-1 fallback) |
| **AudioMetadataService** | Extracts duration, format, bitrate from audio files using music-metadata |
| **ApiKeyService** | Encrypts/decrypts API keys using Electron safeStorage |

## State Management

| Term | Definition |
|------|------------|
| **Zustand** | Lightweight React state management library |
| **Store** | Zustand state container (e.g., `useEditorStore`) |
| **Persist middleware** | Zustand middleware for localStorage persistence |

## Testing

| Term | Definition |
|------|------------|
| **Vitest** | Test runner for unit and integration tests |
| **Playwright** | E2E testing framework for Electron |
| **jsdom** | Browser environment simulation for React tests |
| **testid** | `data-testid` attribute for E2E element selection |

## Documentation

| Term | Definition |
|------|------------|
| **Spec** | Feature specification (requirements, acceptance criteria) |
| **ADR** | Architecture Decision Record |
| **Tier** | Spec complexity level (T1=trivial, T4=complex) |

## File Conventions

| Term | Definition |
|------|------------|
| **`.logic.ts`** | Pure functions extracted from hooks for testability |
| **`.test.ts`** | Unit test file |
| **`.e2e.ts`** | End-to-end test file |
| **`-handlers.ts`** | IPC handler file |

## Abbreviations

| Abbrev | Meaning |
|--------|---------|
| **PTY** | Pseudo-terminal (terminal emulator backend) |
| **CSP** | Content Security Policy |
| **EPIPE** | Error when writing to closed pipe |
| **ESRCH** | Error when process not found |
| **ENOENT** | Error when file not found |

---

See: [Architecture](./architecture.md) | [Getting Started](./getting-started.md)
