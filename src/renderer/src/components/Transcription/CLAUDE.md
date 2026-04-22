# Transcription components

Media import dialog for audio/video transcription – dual backend: OpenAI API (cloud) or local whisper.cpp (offline, macOS only today; Windows parity tracked under Phase 4 [#165](https://github.com/qodeca/erfana/issues/165) – avoid hardcoding `darwin`-only assumptions in new code).

## Architecture

```
TranscriptionDialog.tsx  ← composes on BaseDialog (see ../Dialog/CLAUDE.md)
LanguageSelect.tsx       ← select dropdown, 31 languages
useTranscriptionStore.ts ← Zustand store (stores/)
```

## Key design decisions

- **BaseDialog with `closeOnEscape={false}` and `closeOnBackdrop={false}`**: Custom Escape handler – cancels transcription when active, closes dialog otherwise
- **Tab-cycling focus trap**: Implemented manually via `handleFocusTrap` (BaseDialog only auto-focuses, doesn't cycle)
- **`onClose={handleClose}`**: Safety guard – uses cancel-aware handler, not raw `closeDialog`
- **Video detection**: Checks file extension against `VIDEO_IMPORT.SUPPORTED_EXTENSIONS` to show FileVideo icon and "Transcribe video" title
- **Done button post-actions**: `handleDone` auto-opens the transcript file in an editor tab and triggers the organize-import prompt in the terminal (#113)

## IPC flow

```
renderer                          main
   │                                │
   ├─ transcription:import ────────►│ routes by backend setting:
   │                                │   openai → TranscriptionService.transcribe()
   │                                │   local  → LocalWhisperService.transcribe()
   │◄─ transcription:progress ──────┤ (streamed events)
   │◄─ result ──────────────────────┤
   │                                │
   ├─ transcription:cancel ────────►│ AbortController.abort()
   │                                │
   Video files:                     │
   │────────────────────────────────►│ AudioExtractionService.extractAudio()
   │                                │ → then route by backend (as above)
   │                                │
   Whisper model management:        │
   ├─ whisper:ensureBinary ────────►│ WhisperModelManager.ensureBinary()
   ├─ whisper:ensureModel ─────────►│ WhisperModelManager.ensureModel()
   ├─ whisper:listModels ──────────►│ WhisperModelManager.listInstalledModels()
   ├─ whisper:deleteModel ─────────►│ WhisperModelManager.deleteModel()
   │◄─ whisper:downloadProgress ────┤ (streamed during downloads)
```

## State management

`useTranscriptionStore` (Zustand) manages all dialog state:
- `openDialog(filePath, fileName)` – opens dialog, resets transient state
- `startTranscription(language)` – subscribes to progress events, invokes IPC
- `cancelTranscription()` – unsubscribes, sends cancel IPC
- `lastLanguage` – persists language selection within session (not across restarts)

## Known tech debt

- `htmlFor="transcription-lang"` references non-existent `id` on `<select>` – add `id="transcription-lang"` to LanguageSelect
- `zIndex={10000}` hardcoded – should use dialog stack manager or `var(--z-dialog)` token
- Focus trap logic should move to BaseDialog (benefits all dialogs)
- `background-size: 12px` hardcoded in language select dropdown arrow (same pattern exists in Dialog.css)

## Related files

- `src/shared/ipc/transcription-schema.ts` – Zod schemas (`TranscriptionLanguage`, `WhisperModelSchema`, `TranscriptionBackendSchema`)
- `src/shared/ipc/transcription-channels.ts` – IPC channel constants (transcription + whisper model management)
- `src/shared/constants.ts` – `VIDEO_IMPORT.SUPPORTED_EXTENSIONS`, `LOCAL_WHISPER` (version, model sizes, timeouts)
- `src/main/services/TranscriptionService.ts` – OpenAI backend transcription
- `src/main/services/LocalWhisperService.ts` – Local whisper.cpp backend (macOS only today; Phase 4 [#165](https://github.com/qodeca/erfana/issues/165) adds Windows)
- `src/main/services/WhisperModelManager.ts` – Binary and model download management
- `src/main/services/AudioExtractionService.ts` – Video → audio extraction
- `src/main/ipc/transcription-handlers.ts` – IPC handlers (backend routing, whisper model management)
