# Transcription components

Media import dialog for audio/video transcription – dual backend: OpenAI API (cloud) or local whisper.cpp (offline). Local whisper is available on **macOS universal + Windows x64**. Windows ARM64 is explicitly disabled in the Backend dropdown with ARM64-specific copy.

The Backend dropdown and its `isLocalWhisperSupported` platform gate live in `../Settings/SettingsOverlay.tsx`, **not** in this directory.

## Key design decisions

- **BaseDialog with `closeOnEscape={false}` and `closeOnBackdrop={false}`**: Custom Escape handler – cancels transcription when active, closes dialog otherwise
- **Tab-cycling focus trap**: Provided by BaseDialog via the `trapFocus` prop (#42). Do not reintroduce a local `handleFocusTrap`
- **`onClose={handleClose}`**: Safety guard – uses cancel-aware handler, not raw `closeDialog`
- **Video detection**: Checks file extension against `VIDEO_IMPORT.SUPPORTED_EXTENSIONS` to show FileVideo icon and "Transcribe video" title
- **Done button post-actions**: `handleDone` auto-opens the transcript file in an editor tab and triggers the organize-import prompt in the terminal (#113)
- **Local whisper trust chain**: anchored client-side; the layers and the granular `WHISPER_*` error codes are documented in [`docs/api-services-features.md` § WhisperModelManager / LocalWhisperService](../../../../../docs/api-services-features.md)
- **Platform gate in Backend dropdown**: `isLocalWhisperSupported = darwin || (win32 && x64)`, defined in `../Settings/SettingsOverlay.tsx`. ARM64 Windows shows a disabled option with "Local (macOS / Windows x64 only – ARM64 not supported)". Uses the `window.api.utils.getArch()` preload helper

## Known tech debt

Tracked in [`docs/technical-debt.md`](../../../../../docs/technical-debt.md) – items **#9** and **#10** touch this directory. Check that file rather than tracking it here.

## Related files

- `src/renderer/src/stores/useTranscriptionStore.ts` – all dialog state (Zustand); lives under `stores/`, not in this directory. `lastLanguage` persists the language choice for the session only, not across restarts
- `src/main/services/LocalWhisperService.ts` – local whisper.cpp backend (macOS + Windows x64); also exports `validateAudioPath` (argv hardening) and `checkCpuSupport` (pre-flight CPU probe)
- `src/main/services/WhisperModelManager.ts` – **8**-step binary install flow (manifest signature → downgrade block → source-pin check → download → extract → MOTW strip → post-extraction SHA → schema sentinel). The per-spawn TOCTOU re-hash is a *spawn-time* check ([ADR 0004](../../../../../docs/adrs/0004-per-spawn-toctou-rehash.md)), not a ninth install step. `verifyInstalledBinary()` returns the `VerifiedBinary` shape `{spec, mainSha, revisionIndex}` for spawn-log correlation
- `src/main/services/whisper-assets.ts` – pinned release tag `whisper-build-v1.8.4-erfana1`, per-platform specs, `classifyPlatform()`, `LAST_SEEN_REVISION_FILENAME` / `SCHEMA_SENTINEL_FILENAME`
- `src/main/services/whisper-pubkeys.ts` – two embedded minisign pubkeys (primary used in CI, rotation held offline)
- `src/main/utils/{zipArchive,tarArchive,secureDownloader,verifyManifest}.ts` – trust-chain utility modules
- `src/shared/ipc/transcription-schema.ts` – Zod schemas; `TranscriptionLanguage` is the *inferred type* of `TranscriptionLanguageSchema`, alongside `WhisperModelSchema` and `TranscriptionBackendSchema`
- `src/shared/constants.ts` – `VIDEO_IMPORT.SUPPORTED_EXTENSIONS`, `LOCAL_WHISPER` (version, model sizes, timeouts)
