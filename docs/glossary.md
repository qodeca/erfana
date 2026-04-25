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
| **LiteParse** | @llamaindex/liteparse – parser library for 50+ document formats with spatial text extraction |
| **OCR** | Optical character recognition – text extraction from images/scanned documents via Tesseract.js |
| **Tesseract.js** | JavaScript OCR engine used by LiteParse for local text extraction (no external API calls) |
| **tessdata** | Pre-trained Tesseract language models bundled in `resources/tessdata/` for offline OCR |

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
| **LocalWhisperService** | Offline transcription via whisper.cpp child process. Phase 4: macOS universal + Windows x64. Argv hardening (`validateAudioPath`), pre-flight CPU probe (`checkCpuSupport`), TOCTOU close via pre-spawn `verifyInstalledBinary()`, forensic INFO log per spawn |
| **WhisperModelManager** | Downloads/manages whisper.cpp binary and GGML models under `{userData}/whisper/`. Phase 4: 9-step install flow (manifest sig → SHA pin → downgrade block → verify), `verifyInstalledBinary()` returns `VerifiedBinary` `{spec, mainSha, revisionIndex}` |
| **whisper-assets** | `src/main/services/whisper-assets.ts` — pinned `whisper-build-*` release tag, per-platform SHAs, `classifyPlatform()`, `LAST_SEEN_REVISION_FILENAME` |
| **whisper-pubkeys** | `src/main/services/whisper-pubkeys.ts` — two embedded minisign pubkeys (primary + offline rotation); dual-pubkey trust chain per [ADR 0003](./adrs/0003-dual-pubkey-trust-primary-rotation.md) |
| **verifyManifest / secureDownloader / zipArchive / tarArchive** | Phase 4 main-process utilities under `src/main/utils/`. Trust-chain building blocks — see [`windows/whisper-trust-chain.md`](./windows/whisper-trust-chain.md) |
| **VerifiedBinary** | Return type of `verifyInstalledBinary()`: `{spec, mainSha, revisionIndex}`. Consumed by `LocalWhisperService.runWhisper()` for the forensic spawn log |
| **lastSeenRevision** | Monotonic sentinel in `{userData}/whisper/.last-seen-revision`. Phase 4 downgrade-block defense; see [`windows/whisper-trust-chain.md`](./windows/whisper-trust-chain.md) Layer 4 |
| **TOCTOU close** | Time-Of-Check To Time-Of-Use race mitigation. Per-spawn binary + sidecar re-hash in `LocalWhisperService.runWhisper()` ([ADR 0004](./adrs/0004-per-spawn-toctou-rehash.md)) |
| **AudioMetadataService** | Extracts duration, format, bitrate from audio files using music-metadata |
| **AudioExtractionService** | Extracts audio tracks from video files using ffmpeg for transcription pipeline input |
| **ApiKeyService** | Encrypts/decrypts API keys using Electron safeStorage |
| **ImportService** | Orchestrates document import – routes files to converters, manages progress and cancellation |
| **LiteParseConverter** | Document converter backed by @llamaindex/liteparse for 50+ formats (PDF, Office, images) with local OCR |
| **DependencyDetector** | Async detection of optional system tools (LibreOffice, ImageMagick) with 5s timeout and session caching |

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
| **UAT** | User Acceptance Testing |

## Windows parity (Phase 2)

| Term | Definition |
|------|------------|
| **flakeGuard** | Shared vitest setup helper (`tests/setup/flakeGuard.ts`) loaded by all three projects – surfaces post-teardown unhandled rejections / uncaught exceptions with scope label + stack trace so flaky tests point at the true source |
| **validateFilename** | Two-contract filename validation module (`src/main/utils/validateFilename.ts`) – `assertValidUserFilename` throws on invalid input (user-facing), `deriveSafeFilename` is total (never throws, returns safe fallback) |
| **deriveSafeFilename** | Pure function from `validateFilename.ts` that sanitises strings for use as filenames without throwing – used by `DocxService` and `PdfService` for generated export filenames |
| **INVALID_FILENAME_MARKER** | Shared sentinel string exported from `src/shared/errors.ts` – embedded in every `AppError` message thrown by `assertValidUserFilename`; renderer tests match on this marker instead of the human-readable message text so UX copy changes do not break IPC contract tests |
| **WindowsBootstrapBuilder** | Strategy interface in `src/main/services/WindowsTerminalBootstrap.ts` that abstracts the shell-specific bootstrap handshake on Windows. Current implementations (precedence order): `PowerShellBootstrapBuilder` → `GitBashBootstrapBuilder` → `CmdExeBootstrapBuilder`. Each has a `canHandle(shell)` predicate and `build({shell, cwd, marker})` that emits the `shellArgs` for node-pty plus a Windows-specific ConPTY buffer clear (CSI 2J/3J/H via `printf`, `[Console]::Write`, or `cls`). WSL adds a new builder instead of branching in `TerminalService` |
| **markerDetector** | Local function inside `TerminalService.createTerminal` that parses PTY output for the bootstrap handshake marker and flips the terminal to "ready" once detected – the reason bootstrap output stays invisible to the user |
| **PauseController** | Utility in `src/main/utils/PauseController.ts` providing pause/resume with a safety-timeout auto-resume so a paused file-watcher cannot stall indefinitely if the consumer forgets to resume |

---

See: [Architecture](./architecture.md) | [Getting Started](./getting-started.md) | [Windows enablement](./windows/README.md)
