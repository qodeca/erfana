# Transcription components

Media import dialog for audio/video transcription – dual backend: OpenAI API (cloud) or local whisper.cpp (offline). Local whisper is available on **macOS universal + Windows x64**. Windows ARM64 is explicitly disabled in the Backend dropdown with ARM64-specific copy.

The Backend dropdown and its `isLocalWhisperSupported` platform gate live in `../Settings/SettingsOverlay.tsx`, **not** in this directory. Dialog state lives in `src/renderer/src/stores/useTranscriptionStore.ts`, also outside this directory.

Dialog behaviour rules (focus trap, portal, the `trapFocus` prop) live in [`../Dialog/CLAUDE.md`](../Dialog/CLAUDE.md) and apply here.

## Key design decisions

- **BaseDialog with `closeOnEscape={false}` and `closeOnBackdrop={false}`**: Custom Escape handler – cancels transcription when active, closes dialog otherwise
- **`onClose={handleClose}`**: Safety guard – uses cancel-aware handler, not raw `closeDialog`
- **Local whisper trust chain**: anchored client-side; the layers and the granular `WHISPER_*` error codes are documented in [`docs/api-services-features.md` § WhisperModelManager / LocalWhisperService](../../../../../docs/api-services-features.md)
- **Platform gate in Backend dropdown**: `isLocalWhisperSupported = darwin || (win32 && x64)`. ARM64 Windows shows a disabled option with "Local (macOS / Windows x64 only – ARM64 not supported)". Uses the `window.api.utils.getArch()` preload helper
