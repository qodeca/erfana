<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Settings overlay – implementation notes

User controls, defaults and project options are in the [settings reference](./user-guide/reference/settings.md).

## Focus management

`SettingsOverlay.tsx` remembers the previously focused element when it opens, focuses the close button after the overlay renders, closes on Escape using a capture-phase document listener, and restores the earlier focus when it closes. This keeps keyboard users at their original place after inspecting settings.

## Credential and local model storage

**API key security**: Keys are encrypted using platform-native keychain (macOS Keychain, Linux libsecret, Windows DPAPI). The global settings JSON only stores a boolean `openaiApiKeyStored` flag, never the key itself. Plaintext fallback with warning if safeStorage unavailable.

**Local backend** (macOS universal + Windows x64 since Phase 4, #165, merged 2026-04-23 for 0.9.4): When backend is set to 'local', transcription runs entirely offline via whisper.cpp child process. The binary and model files are stored in the Electron `userData` directory. Binary + model downloads run through the Phase 4 trust chain — minisign-signed manifest (dual-pubkey), SHA-256 pin in `whisper-assets.ts`, pre-spawn TOCTOU re-hash, and monotonic `lastSeenRevision` downgrade block — progress is shown in the settings UI. Windows ARM64 shows a disabled "Local" option with ARM64-specific copy (upstream whisper.cpp has no ARM64 Windows binary). Downloads have a 10-minute timeout to prevent indefinite hangs. See [Whisper Trust Chain](./windows/whisper-trust-chain.md) for the full trust model.


## Remote-host approval storage

**Approved remote hosts are per-project, not global.** When a previewed page requests a remote host, you approve it once and the host is written to a versioned `htmlPreview.allowlist` in that project's `.erfana/settings.json`. The list is **one-way** (approve-only, no un-approve UI), capped at 200 hosts, and gated by `isApprovableHost`. It is deliberately stored **separately** from `ProjectSettingsSchema` (which reads it as `z.unknown().optional()`) so a malformed host entry can never block the project from loading. See [HTML preview](./html-preview/README.md) and the [security threat model](./security.md) for the full model.


## Storage

Settings persist to `~/.erfana/settings.json` via GlobalSettingsService.

## Implementation

**Location**: `src/renderer/src/components/Settings/SettingsOverlay.tsx`
**State**: `useSettingsStore` (open/close), `useGlobalSettingsStore` (values)
**Schema**: `src/shared/ipc/global-settings-schema.ts`

---

See: [Logging](./logging.md) | [File Watching](./file-watching/README.md) | [UI Components](./ui-components.md)
