<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Settings overlay – implementation notes

User controls, defaults and project options are in the [settings reference](./user-guide/reference/settings.md).

## Focus management

`SettingsOverlay.tsx` remembers the previously focused element when it opens and focuses the close button after the overlay renders (unless a section was asked for, which then focuses its own heading). It registers with the overlay stack (`useOverlayStackEntry`), whose capture-phase document listener closes Settings on Escape only while it is the topmost overlay. It restores the earlier focus when it closes. This keeps keyboard users at their original place after inspecting settings.

## Credential and local model storage

**API key security**: Keys are encrypted with Electron `safeStorage` and written as key files in `~/.erfana/`. The global settings JSON only stores a boolean `openaiApiKeyStored` flag, never the key itself. There is no plaintext fallback: when `safeStorage` cannot encrypt (for example Linux without a keyring, which falls back to `basic_text`), `ApiKeyService.storeKey` throws `ApiKeyEncryptionUnavailableError`, nothing is written, and Settings shows the reason under the key field.

**Local backend** (macOS universal + Windows x64): When the backend is set to `local`, transcription runs entirely offline via whisper.cpp child process. The binary and model files are stored in the Electron `userData` directory. Binary and model downloads run through the Phase 4 trust chain: a minisign-signed manifest (dual-pubkey), a SHA-256 pin in `whisper-assets.ts`, a pre-spawn TOCTOU re-hash, and a monotonic `lastSeenRevision` downgrade block. Download progress is shown in Settings. Windows ARM64 shows a disabled **Local (macOS / Windows x64 only – ARM64 not supported)** option (upstream whisper.cpp has no ARM64 Windows binary). A download in progress can be stopped with the **Cancel** button in Settings. See [Whisper trust chain](./windows/whisper-trust-chain.md) for the full trust model.

## Remote-host approval storage

**Approved remote hosts are per-project, not global.** When a previewed page requests a remote host, you approve it once and its origin is written to a versioned `htmlPreview.allowlist` in that project's `.erfana/settings.json`. The `origins` list is the truth; `hosts` is a copy kept for older builds. The list is **one-way** (approve-only, no un-approve UI), capped at 200 entries, and gated by `isApprovableHost`. It is deliberately stored **separately** from `ProjectSettingsSchema` (which reads it as `z.unknown().optional()`) so a malformed host entry can never block the project from loading. See [HTML preview](./html-preview/README.md) and the [security threat model](./security.md) for the full model.

## Storage

Settings persist to `~/.erfana/settings.json` via GlobalSettingsService. The file is read once, in `initialize()` at app start, and cached; every `setSetting` validates the whole cached object and writes it back in full, so a hand edit made while Erfana runs is overwritten by the next save.

**Parse strictness.** A global file that is not valid JSON, or that fails `GlobalSettingsSchema`, is treated as corrupt: it is copied to `settings.json.bak` and **every** setting is reset to its default. A project's `.erfana/settings.json` is read by `ProjectSettingsService` on every project open, and any failure there blocks the project from opening. Four blocks are therefore parsed leniently so that a mistake in them can do neither:

- `htmlPreview` in the project file – `z.unknown()`, parsed separately by `PreviewAllowlistStore` (see [Remote-host approval storage](#remote-host-approval-storage)).
- `terminal` in the global file (lens review [23]) – `TerminalSettingsSchema`: an unknown `screenReaderMode` becomes `auto`, and a malformed section becomes `{ screenReaderMode: 'auto' }`.
- `comments` in the global file (comments in HTML preview) – `CommentIdentitySettingsSchema`: the reviewer's `authorName` (at most 100 characters) and `authorEmail` (at most 254) and `identityNoticeSeen`; a value over its cap, of the wrong type or with a control or invisible character (the writer's own rule, `src/shared/htmlComments/identity.ts`) reads as unset, and a malformed section becomes `{ identityNoticeSeen: false }`. A **write** through `setSetting` is checked strictly instead (`CommentIdentityWriteSchema`): such a value is refused with `GLOBAL_SETTINGS_VALIDATION_FAILED` and a message naming the field, rather than silently saved as unset. App-level only, so a cloned project cannot preset who you are; main reads it at every Save.
- `files` in **both** files (#211) – the shared `FilesSettingsSchema` (`src/shared/ipc/files-exclude-schema.ts`): a non-array list becomes `[]`, a non-string entry becomes `''` (kept, so a rejection index still points at the user's line), and a malformed section becomes `{ exclude: [] }`. Entry rules (normalisation, caps, rejected shapes) are applied afterwards by `validateExcludeEntries` in `src/main/utils/excludeMatcher.ts`, per source.

## Exclude list (`files.exclude`)

Added in #211. `ProjectSettingsService` resolves the list on every project open: the global entries first (through a provider that `src/main/ipc/file-handlers.ts` wires to `globalSettingsService.getSetting('files').exclude`), then the project's, each source validated on its own and the accepted entries de-duplicated. The project list only adds; there is no `replace` mode. The result carries `excludePatterns` and `excludeRejections` (`{ source, index, reason }`, never the entry text). `ProjectService` logs the rejections and builds one `ProjectPathFilter` for the tree walk and the directory watcher. Syntax and limits for users: [settings reference § Excluded folders](./user-guide/reference/settings.md#excluded-folders); how it reaches the watcher: [File watching § Watched files](./file-watching/README.md#watched-files).

## Terminal screen-reader mode (`terminal.screenReaderMode`)

Added for lens review [23]. xterm.js draws output on a canvas, so a screen reader reads nothing unless xterm's `screenReaderMode` is on (an offscreen accessibility tree plus a live region). `useTerminalScreenReaderMode` (`src/renderer/src/hooks/`) resolves it: `on` and `off` win; `auto` follows `terminal:getScreenReaderSupport` and `terminal:screenReaderSupportChanged` (Electron's accessibility support, macOS and Windows only). `useXtermSession` passes the result to the `Terminal` constructor and sets `xterm.options.screenReaderMode` live, so a change in Settings or in the OS applies to running terminals without a restart. Chromium also reports some non-screen-reader tools that use the accessibility APIs, which is what `off` is for; on Linux, Auto stays off and `on` is the way in.

## Import tools section (#250)

`sections/ImportToolsSection.tsx` lists PDF and images as built in and Office documents by LibreOffice state (`found`, `missing`, `unsafe`), with a per-platform install hint (Homebrew command with a copy button on macOS, a **Download LibreOffice** button that opens `DOCUMENT_IMPORT.LIBREOFFICE_DOWNLOAD_URL` through `shell:openExternal` on Windows, the package name elsewhere). Opening the section reads the cached result from startup detection; **Check again** calls `import:toolStatus` with a recheck, which `ImportToolStatusService` throttles to one probe per `DOCUMENT_IMPORT.TOOL_RECHECK_MIN_INTERVAL_MS` (3 s). The import refusal's **Open import tools** button calls `openSettings({ section: 'import-tools' })`, which scrolls to the section and focuses its heading. Detection itself is `DependencyDetector` (see [glossary](./glossary.md#services)); the "unsafe" wording comes from `untrustedToolMessage` in `src/shared/errors.ts`, the same text a refused conversion uses.

## Implementation

**Location**: `src/renderer/src/components/Settings/SettingsOverlay.tsx`
**State**: `useSettingsStore` (open/close), `useGlobalSettingsStore` (values)
**Schema**: `src/shared/ipc/global-settings-schema.ts`

---

See: [Logging](./logging.md) | [File watching](./file-watching/README.md) | [UI components](./ui-components.md)
