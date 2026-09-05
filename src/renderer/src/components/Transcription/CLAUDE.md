# Transcription components

Media import dialog for audio/video transcription – dual backend: OpenAI API (cloud) or local whisper.cpp (offline). Local whisper is available on **macOS universal + Windows x64**. Windows ARM64 is explicitly disabled in the Backend dropdown with ARM64-specific copy.

The Backend dropdown and its `isLocalWhisperSupported` platform gate live in `../Settings/SettingsOverlay.tsx`, **not** in this directory. Dialog state lives in `src/renderer/src/stores/useTranscriptionStore.ts`, also outside this directory.

## Key design decisions

- **BaseDialog with `closeOnEscape={false}` and `closeOnBackdrop={false}`**: Custom Escape handler – cancels transcription when active, closes dialog otherwise
- **Tab-cycling focus trap**: Provided by BaseDialog via the `trapFocus` prop. Do not reintroduce a local `handleFocusTrap`
- **`onClose={handleClose}`**: Safety guard – uses cancel-aware handler, not raw `closeDialog`
- **Local whisper trust chain**: anchored client-side; the layers and the granular `WHISPER_*` error codes are documented in [`docs/api-services-features.md` § WhisperModelManager / LocalWhisperService](../../../../../docs/api-services-features.md)
- **Per-spawn TOCTOU re-hash** in `src/main/services/WhisperModelManager.ts` is a *spawn-time* check ([ADR 0004](../../../../../docs/adrs/0004-per-spawn-toctou-rehash.md)), not a ninth step of the 8-step binary install flow
- **Platform gate in Backend dropdown**: `isLocalWhisperSupported = darwin || (win32 && x64)`. ARM64 Windows shows a disabled option with "Local (macOS / Windows x64 only – ARM64 not supported)". Uses the `window.api.utils.getArch()` preload helper

## Known tech debt

Tracked in [`docs/technical-debt.md`](../../../../../docs/technical-debt.md) – items **#9** and **#10** touch this directory. Check that file rather than tracking it here.
