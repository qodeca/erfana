# Transcription components

Media import dialog for audio/video transcription via OpenAI API.

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

## IPC flow

```
renderer                          main
   │                                │
   ├─ transcription:import ────────►│ TranscriptionService.transcribe()
   │◄─ transcription:progress ──────┤ (streamed events)
   │◄─ result ──────────────────────┤
   │                                │
   ├─ transcription:cancel ────────►│ AbortController.abort()
   │                                │
   Video files:                     │
   │────────────────────────────────►│ AudioExtractionService.extractAudio()
   │                                │ → then TranscriptionService.transcribe()
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

- `src/shared/ipc/transcription-schema.ts` – Zod schemas, `TranscriptionLanguage` type
- `src/shared/ipc/transcription-channels.ts` – IPC channel constants
- `src/shared/constants.ts` – `VIDEO_IMPORT.SUPPORTED_EXTENSIONS`
- `src/main/services/TranscriptionService.ts` – backend transcription
- `src/main/services/AudioExtractionService.ts` – video → audio extraction
- `src/main/ipc/transcription-handlers.ts` – IPC handlers
