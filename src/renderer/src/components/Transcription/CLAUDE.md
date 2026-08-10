# Transcription components

Media import dialog for audio/video transcription – dual backend: OpenAI API (cloud) or local whisper.cpp (offline). Local whisper is available on **macOS universal + Windows x64**. Windows ARM64 is explicitly disabled in the Backend dropdown with ARM64-specific copy.

## Architecture

```
TranscriptionDialog.tsx         ← composes on BaseDialog (see ../Dialog/CLAUDE.md)
LanguageSelect.tsx              ← select dropdown, 31 languages
useTranscriptionStore.ts        ← Zustand store (stores/)
../Settings/SettingsOverlay.tsx ← Transcription settings section; owns the Backend
                                  dropdown and its `isLocalWhisperSupported` platform gate
```

## Key design decisions

- **BaseDialog with `closeOnEscape={false}` and `closeOnBackdrop={false}`**: Custom Escape handler – cancels transcription when active, closes dialog otherwise
- **Tab-cycling focus trap**: Provided by BaseDialog via the `trapFocus` prop (#42). The local `handleFocusTrap` this dialog used to carry was deleted – do not reintroduce one
- **`onClose={handleClose}`**: Safety guard – uses cancel-aware handler, not raw `closeDialog`
- **Video detection**: Checks file extension against `VIDEO_IMPORT.SUPPORTED_EXTENSIONS` to show FileVideo icon and "Transcribe video" title
- **Done button post-actions**: `handleDone` auto-opens the transcript file in an editor tab and triggers the organize-import prompt in the terminal (#113)
- **Local whisper trust chain (Phase 4)**: Trust is anchored client-side — manifest minisign signature (dual-pubkey) → artifact SHA-256 pin → pre-spawn re-hash (TOCTOU close) → monotonic `lastSeenRevision` downgrade block. Error codes are granular: `WHISPER_MANIFEST_INVALID`, `WHISPER_DOWNGRADE_BLOCKED`, `WHISPER_SOURCE_PIN_DRIFT`, `WHISPER_BINARY_TAMPERED`, `WHISPER_CPU_UNSUPPORTED`, `WHISPER_INVALID_PATH`. Full documentation: [`docs/api-services-features.md` § WhisperModelManager / LocalWhisperService](../../../../../docs/api-services-features.md).
- **Platform gate in Backend dropdown**: `isLocalWhisperSupported = darwin || (win32 && x64)`, defined in `../Settings/SettingsOverlay.tsx` (not in this directory). ARM64 Windows shows disabled option with "Local (macOS / Windows x64 only – ARM64 not supported)". Uses `window.api.utils.getArch()` preload helper.

## IPC flow

```
renderer                                       main
   │                                             │
   ├─ transcription:import ─────────────────────►│ routes by backend setting:
   │                                             │   openai → TranscriptionService.transcribe()
   │                                             │   local  → LocalWhisperService.transcribe()
   │◄─ transcription:progress ───────────────────┤ (streamed events)
   │◄─ result ───────────────────────────────────┤
   │                                             │
   ├─ transcription:cancel ─────────────────────►│ AbortController.abort()
   │                                             │
   Video files:                                  │
   │────────────────────────────────────────────►│ AudioExtractionService.extractAudio()
   │                                             │ → then route by backend (as above)
   │                                             │
   Whisper model management:                     │
   ├─ transcription:whisperEnsureBinary ────────►│ WhisperModelManager.ensureBinary()
   ├─ transcription:whisperEnsureModel ─────────►│ WhisperModelManager.ensureModel()
   ├─ transcription:whisperListModels ──────────►│ WhisperModelManager.listInstalledModels()
   ├─ transcription:whisperDeleteModel ─────────►│ WhisperModelManager.deleteModel()
   │◄─ transcription:whisperDownloadProgress ────┤ (streamed during downloads)
```

## State management

`useTranscriptionStore` (Zustand) manages all dialog state:
- `openDialog(filePath, fileName)` – opens dialog, resets transient state
- `startTranscription(language)` – subscribes to progress events, invokes IPC
- `cancelTranscription()` – unsubscribes, sends cancel IPC
- `lastLanguage` – persists language selection within session (not across restarts)

## Known tech debt

Two open items in [`docs/technical-debt.md`](../../../../../docs/technical-debt.md) touch this directory: **#9** (`TranscriptionDialog` hardcoded `zIndex={10000}`) and **#10** (the chevron dropdown-arrow background is copied into `TranscriptionDialog.css:71` and four other stylesheets). Check that file for current status rather than tracking it here.

## Related files

- `src/shared/ipc/transcription-schema.ts` – Zod schemas (`TranscriptionLanguageSchema` – the exported `TranscriptionLanguage` is its inferred type – plus `WhisperModelSchema`, `TranscriptionBackendSchema`)
- `src/shared/ipc/transcription-channels.ts` – IPC channel constants (transcription + whisper model management)
- `src/shared/constants.ts` – `VIDEO_IMPORT.SUPPORTED_EXTENSIONS`, `LOCAL_WHISPER` (version, model sizes, timeouts)
- `src/renderer/src/components/Settings/SettingsOverlay.tsx` – Transcription settings section: Backend dropdown, `isLocalWhisperSupported` gate, model management UI
- `src/main/services/TranscriptionService.ts` – OpenAI backend transcription
- `src/main/services/LocalWhisperService.ts` – Local whisper.cpp backend (macOS + Windows x64 since Phase 4); also exports `validateAudioPath` (argv hardening) and `checkCpuSupport` (pre-flight CPU probe)
- `src/main/services/WhisperModelManager.ts` – 9-step install flow with manifest sig → SHA → TOCTOU close → downgrade block; `verifyInstalledBinary()` returns `VerifiedBinary` shape `{spec, mainSha, revisionIndex}` for spawn-log correlation
- `src/main/services/whisper-assets.ts` – Pinned release tag `whisper-build-v1.8.4-erfana1`, per-platform specs, `classifyPlatform()`, `LAST_SEEN_REVISION_FILENAME` / `SCHEMA_SENTINEL_FILENAME`
- `src/main/services/whisper-pubkeys.ts` – Two embedded minisign pubkeys (primary in CI, rotation offline)
- `src/main/utils/{zipArchive,tarArchive,secureDownloader,verifyManifest}.ts` – Phase 4 trust-chain utility modules
- `src/main/services/AudioExtractionService.ts` – Video → audio extraction
- `src/main/ipc/transcription-handlers.ts` – IPC handlers (backend routing, whisper model management)
