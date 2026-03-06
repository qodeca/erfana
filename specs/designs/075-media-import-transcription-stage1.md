# Design: Media import with transcription -- Stage 1

**Issue**: #75
**Spec**: spec-t4-009-media-import-transcription
**Scope**: Core audio import (MP3, WAV, M4A) with OpenAI transcription
**Date**: 2026-02-07

---

## 1. Architecture overview

Stage 1 adds audio transcription to the existing import system by:

1. Creating a **TranscriptionService** (main process) -- manages OpenAI API calls, chunking, retry, and temp file cleanup
2. Creating an **AudioConverter** -- implements `IConverter` and wires into `ConverterRegistry`
3. Extending **GlobalSettings** with a `transcription` section (backend selection, API key via safeStorage)
4. Adding **IPC streaming channels** for progress events (`transcription:progress`, `transcription:cancel`)
5. Extending the **SettingsOverlay** with a transcription configuration section
6. Creating a **TranscriptionProgressDialog** in the renderer for real-time progress display

The design follows the Strategy + Registry pattern established by PdfConverter/TextConverter, the service singleton pattern (ScreenshotService, CameraService), and the IPC streaming pattern (terminal:data).

---

## 2. New files to create

### 2.1 Shared types and schemas

#### `src/shared/ipc/transcription-schema.ts`

Zod schemas and TypeScript types for transcription IPC.

```typescript
import { z } from 'zod'

// Backend selection
export const TranscriptionBackendSchema = z.enum(['openai'])
export type TranscriptionBackend = z.infer<typeof TranscriptionBackendSchema>

// Language options
export const TranscriptionLanguageSchema = z.enum([
  'auto', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'zh', 'ko',
  'ar', 'cs', 'da', 'fi', 'el', 'he', 'hi', 'hu', 'id', 'ms', 'no', 'ro',
  'sk', 'sv', 'th', 'tr', 'uk', 'vi'
])
export type TranscriptionLanguage = z.infer<typeof TranscriptionLanguageSchema>

// Import request (renderer -> main)
export const TranscriptionImportRequestSchema = z.object({
  filePath: z.string().min(1),
  language: TranscriptionLanguageSchema
})
export type TranscriptionImportRequest = z.infer<typeof TranscriptionImportRequestSchema>

// Progress event (main -> renderer, streamed via webContents.send)
export interface TranscriptionProgress {
  /** Overall progress 0-100 */
  percent: number
  /** Current phase description */
  phase: string
  /** Current chunk (1-based) */
  currentChunk?: number
  /** Total chunks */
  totalChunks?: number
  /** Estimated seconds remaining */
  etaSeconds?: number
}

// Import result (main -> renderer, via ipcMain.handle response)
export interface TranscriptionImportResult {
  success: boolean
  outputPath?: string
  error?: string
  errorCode?: string
}

// Settings schema (embedded in GlobalSettings)
export const TranscriptionSettingsSchema = z.object({
  /** Selected transcription backend */
  backend: TranscriptionBackendSchema.default('openai'),
  /** Whether an API key has been stored (key itself in safeStorage) */
  openaiApiKeyStored: z.boolean().default(false)
})
export type TranscriptionSettings = z.infer<typeof TranscriptionSettingsSchema>
```

**Key decisions**:
- API key is NOT stored in settings JSON. Only a boolean flag `openaiApiKeyStored` indicates whether a key exists in Electron safeStorage.
- The actual key is encrypted via `safeStorage.encryptString()` and stored in a separate file at `~/.erfana/openai-api-key.enc`.
- Language enum covers the spec's required languages plus OpenAI's commonly supported languages.

#### `src/shared/ipc/transcription-channels.ts`

IPC channel constants (follows `git-watcher-channels.ts` pattern).

```typescript
export const TRANSCRIPTION_CHANNELS = {
  // Request/response (ipcMain.handle)
  IMPORT: 'transcription:import',
  CANCEL: 'transcription:cancel',
  VALIDATE: 'transcription:validate',

  // Streaming events (webContents.send)
  PROGRESS: 'transcription:progress',

  // API key management
  SET_API_KEY: 'transcription:setApiKey',
  HAS_API_KEY: 'transcription:hasApiKey',
  CLEAR_API_KEY: 'transcription:clearApiKey'
} as const
```

### 2.2 Main process services

#### `src/main/services/TranscriptionService.ts`

Core transcription service. Handles:
- OpenAI API integration (GPT-4o-transcribe primary, Whisper-1 fallback)
- File chunking for files >8 minutes
- Exponential backoff retry (max 3 attempts, base 1s, max 30s)
- Temp file cleanup (both on success and failure/cancel)
- Progress reporting via callback
- AbortSignal cancellation support
- Audio duration detection via native audio parsing (no ffmpeg)

```typescript
interface ITranscriptionService {
  transcribe(
    filePath: string,
    language: TranscriptionLanguage,
    onProgress: (progress: TranscriptionProgress) => void,
    signal?: AbortSignal
  ): Promise<TranscriptionResult>
}

interface TranscriptionResult {
  success: boolean
  transcript?: string
  duration?: number  // seconds
  language?: string
  error?: string
  errorCode?: ErrorCode
}
```

**Implementation details**:
- Uses `node:fs` streams to read audio files
- OpenAI API call via `fetch()` with `FormData` (multipart/form-data)
- No npm dependency on `openai` SDK -- direct HTTP calls for simplicity and control
- Chunking splits by byte offset at ~8-minute boundaries (calculated from file size and bitrate estimation)
- For chunking, uses file slicing (Buffer.slice) since MP3/WAV/M4A can be split at frame boundaries
- Chunk overlap of 0.5 seconds at boundaries to prevent word truncation
- Temp chunk files written to `os.tmpdir()` with prefix `erfana-transcription-chunk-`
- All temp files tracked in a Set and cleaned in a `finally` block

**Retry logic**:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (signal?.aborted) throw error
      if (attempt === maxAttempts) throw error
      if (!isRetryableError(error)) throw error

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
      await sleep(delay)
    }
  }
  throw new Error('Exhausted retries')  // unreachable
}
```

**Audio duration detection**:
- MP3: Parse ID3 tags or estimate from file size / bitrate (128-320 kbps typical)
- WAV: Parse RIFF header (sample rate * channels * bits per sample)
- M4A: Parse MP4 `mvhd` atom for duration

#### `src/main/services/ApiKeyService.ts`

Manages API key encryption/decryption using Electron safeStorage.

```typescript
interface IApiKeyService {
  storeKey(serviceName: string, key: string): Promise<void>
  getKey(serviceName: string): Promise<string | null>
  hasKey(serviceName: string): boolean
  clearKey(serviceName: string): Promise<void>
}
```

**Implementation**:
- `safeStorage.encryptString(key)` produces a Buffer
- Buffer is written to `~/.erfana/{serviceName}-api-key.enc`
- `safeStorage.decryptString(buffer)` reads it back
- `safeStorage.isEncryptionAvailable()` checked first; falls back to plaintext with warning log
- Service-agnostic design allows reuse for future API keys

#### `src/main/services/AudioMetadataService.ts`

Lightweight audio file metadata extraction without ffmpeg.

```typescript
interface IAudioMetadataService {
  getDuration(filePath: string): Promise<number>  // seconds
  getFormat(filePath: string): Promise<AudioFormat>
  validate(filePath: string): Promise<AudioValidationResult>
}

interface AudioFormat {
  extension: string
  mimeType: string
  bitrate?: number   // kbps
  sampleRate?: number // Hz
  channels?: number
}

interface AudioValidationResult {
  valid: boolean
  error?: string
  errorCode?: ErrorCode
  format?: AudioFormat
  durationSeconds?: number
  sizeInMB: number
}
```

**Implementation approach**:
- Uses `music-metadata` npm package (pure JS, no native deps, well-maintained)
- Parses MP3 (ID3v1/v2, MPEG frame headers), WAV (RIFF/PCM headers), M4A (MP4/AAC atoms)
- Extracts: duration, bitrate, sample rate, channels
- Validates file is actually audio (checks magic bytes)

#### `src/main/services/import/converters/AudioConverter.ts`

Implements `IConverter` interface for audio files. This is the glue between the import system and TranscriptionService.

```typescript
export class AudioConverter implements IConverter {
  readonly supportedExtensions = ['mp3', 'wav', 'm4a']
  readonly requiresConversion = true
  readonly category: FileTypeCategory = 'audio'

  // Injected dependencies
  constructor(
    private transcriptionService: ITranscriptionService,
    private audioMetadataService: IAudioMetadataService
  )

  async validate(filePath: string): Promise<ValidationResult>
  async convert(filePath: string): Promise<ConversionResult>
}
```

**Challenge**: The current `IConverter.convert()` signature is synchronous-result (no progress callback, no cancellation). For Stage 1, AudioConverter will NOT be used through the standard `import:process` IPC channel. Instead, a dedicated `transcription:import` channel handles the full workflow with progress.

The `convert()` method is still implemented for interface compliance but is intended for headless/batch usage without progress reporting. The primary path goes through `TranscriptionService.transcribe()` directly.

**Markdown output format**:
```markdown
---
source: /path/to/recording.mp3
duration: "5:30"
date: "2026-02-07T14:30:00Z"
language: en
transcription_backend: openai
---

[Transcript content here...]
```

### 2.3 IPC handlers

#### `src/main/ipc/transcription-handlers.ts`

Registers all transcription-related IPC handlers.

```typescript
export function registerTranscriptionHandlers(): void {
  // transcription:import -- Full import with progress streaming
  ipcMain.handle(TRANSCRIPTION_CHANNELS.IMPORT,
    async (event, request: TranscriptionImportRequest): Promise<TranscriptionImportResult> => {
      // 1. Validate request with Zod
      // 2. Check API key exists
      // 3. Validate audio file
      // 4. Get project path
      // 5. Create AbortController
      // 6. Call transcriptionService.transcribe() with progress callback
      //    that sends webContents.send(TRANSCRIPTION_CHANNELS.PROGRESS, progress)
      // 7. Write markdown to import/ directory
      // 8. Return result
    })

  // transcription:cancel -- Cancel active transcription
  ipcMain.handle(TRANSCRIPTION_CHANNELS.CANCEL, async () => {
    // Abort active AbortController
  })

  // transcription:validate -- Quick validation (file format, size)
  ipcMain.handle(TRANSCRIPTION_CHANNELS.VALIDATE,
    async (_event, filePath: string) => {
      // Validate file exists, is audio, get duration estimate
    })

  // transcription:setApiKey -- Store API key in safeStorage
  ipcMain.handle(TRANSCRIPTION_CHANNELS.SET_API_KEY,
    async (_event, apiKey: string) => {
      // Store via ApiKeyService
      // Update GlobalSettings.transcription.openaiApiKeyStored = true
    })

  // transcription:hasApiKey -- Check if API key exists
  ipcMain.handle(TRANSCRIPTION_CHANNELS.HAS_API_KEY, async () => {
    // Check via ApiKeyService
  })

  // transcription:clearApiKey -- Remove stored API key
  ipcMain.handle(TRANSCRIPTION_CHANNELS.CLEAR_API_KEY, async () => {
    // Clear via ApiKeyService
    // Update GlobalSettings.transcription.openaiApiKeyStored = false
  })
}
```

### 2.4 Renderer components

#### `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`

Modal dialog for audio import workflow. States:
1. **Language selection** -- dropdown with language options, "Start" button
2. **Progress** -- progress bar (0-100%), phase text, chunk indicator, ETA, cancel button
3. **Success** -- confirmation with "Open file" option
4. **Error** -- error message with retry/dismiss options

```typescript
interface TranscriptionDialogProps {
  filePath: string
  fileName: string
  onComplete: (outputPath: string) => void
  onCancel: () => void
}
```

**Accessibility**:
- `role="dialog"` with `aria-modal="true"`
- Progress bar with `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label`
- Focus trap within dialog
- Escape to cancel

#### `src/renderer/src/components/Transcription/TranscriptionDialog.css`

Follows `SettingsOverlay.css` design tokens: `var(--color-*)`, `var(--space-*)`, `var(--text-*)`.

#### `src/renderer/src/components/Transcription/TranscriptionDialog.test.tsx`

Tests: renders, language selection, progress updates, cancel, error states, accessibility attributes.

#### `src/renderer/src/components/Transcription/LanguageSelect.tsx`

Reusable language selector dropdown. Labels are human-readable (e.g., "English", "Polish").

### 2.5 Renderer store

#### `src/renderer/src/stores/useTranscriptionStore.ts`

Zustand store for transcription state.

```typescript
interface TranscriptionState {
  // Dialog state
  isDialogOpen: boolean
  filePath: string | null
  fileName: string | null

  // Progress state
  isTranscribing: boolean
  progress: TranscriptionProgress | null

  // Result state
  result: TranscriptionImportResult | null
  error: string | null

  // Actions
  openDialog: (filePath: string, fileName: string) => void
  closeDialog: () => void
  startTranscription: (language: TranscriptionLanguage) => Promise<void>
  cancelTranscription: () => Promise<void>

  // Internal
  _handleProgress: (progress: TranscriptionProgress) => void
}
```

---

## 3. Existing files to modify

### 3.1 `src/shared/ipc/global-settings-schema.ts`

**Add** `TranscriptionSettingsSchema` to `GlobalSettingsSchema`:

```typescript
import { TranscriptionSettingsSchema } from './transcription-schema'

export const GlobalSettingsSchema = z.object({
  // ... existing fields ...
  /** Transcription configuration */
  transcription: TranscriptionSettingsSchema.default(() => ({
    backend: 'openai' as const,
    openaiApiKeyStored: false
  }))
})
```

### 3.2 `src/shared/errors.ts`

**Add** transcription error codes to `ErrorCode` enum:

```typescript
// Transcription errors (Issue #75)
TRANSCRIPTION_NO_API_KEY = 'TRANSCRIPTION_NO_API_KEY',
TRANSCRIPTION_INVALID_API_KEY = 'TRANSCRIPTION_INVALID_API_KEY',
TRANSCRIPTION_API_ERROR = 'TRANSCRIPTION_API_ERROR',
TRANSCRIPTION_RATE_LIMITED = 'TRANSCRIPTION_RATE_LIMITED',
TRANSCRIPTION_NETWORK_ERROR = 'TRANSCRIPTION_NETWORK_ERROR',
TRANSCRIPTION_CANCELLED = 'TRANSCRIPTION_CANCELLED',
TRANSCRIPTION_INVALID_AUDIO = 'TRANSCRIPTION_INVALID_AUDIO',
TRANSCRIPTION_CHUNK_FAILED = 'TRANSCRIPTION_CHUNK_FAILED',
TRANSCRIPTION_TIMEOUT = 'TRANSCRIPTION_TIMEOUT',
TRANSCRIPTION_FAILED = 'TRANSCRIPTION_FAILED',
```

**Add** corresponding `ERROR_MESSAGES`:

```typescript
[ErrorCode.TRANSCRIPTION_NO_API_KEY]: 'No API key configured. Add your OpenAI API key in Settings.',
[ErrorCode.TRANSCRIPTION_INVALID_API_KEY]: 'Invalid API key. Please check your OpenAI API key in Settings.',
[ErrorCode.TRANSCRIPTION_API_ERROR]: 'OpenAI API error. Please try again.',
[ErrorCode.TRANSCRIPTION_RATE_LIMITED]: 'API rate limit reached. Retrying automatically.',
[ErrorCode.TRANSCRIPTION_NETWORK_ERROR]: 'Network error. Please check your connection and try again.',
[ErrorCode.TRANSCRIPTION_CANCELLED]: 'Transcription was cancelled',
[ErrorCode.TRANSCRIPTION_INVALID_AUDIO]: 'Invalid audio file. Supported formats: MP3, WAV, M4A.',
[ErrorCode.TRANSCRIPTION_CHUNK_FAILED]: 'Failed to process audio chunk. Retrying.',
[ErrorCode.TRANSCRIPTION_TIMEOUT]: 'Transcription request timed out',
[ErrorCode.TRANSCRIPTION_FAILED]: 'Transcription failed. Please try again.',
```

### 3.3 `src/shared/constants.ts`

**Add** `TRANSCRIPTION` constants block:

```typescript
/**
 * Transcription constants
 * Used by TranscriptionService for audio-to-text conversion
 *
 * @see TranscriptionService.ts
 * @see Issue #75 - Media import with transcription
 */
export const TRANSCRIPTION = {
  /** Chunk boundary in seconds (files >8 min are chunked) */
  CHUNK_BOUNDARY_SECONDS: 8 * 60,
  /** Overlap at chunk boundaries in seconds (prevents word truncation) */
  CHUNK_OVERLAP_SECONDS: 0.5,
  /** Maximum retry attempts for API calls */
  MAX_RETRY_ATTEMPTS: 3,
  /** Base delay for exponential backoff in ms */
  RETRY_BASE_DELAY_MS: 1000,
  /** Maximum delay for exponential backoff in ms */
  RETRY_MAX_DELAY_MS: 30000,
  /** API request timeout in ms (5 minutes per chunk) */
  API_TIMEOUT_MS: 5 * 60 * 1000,
  /** Temp file prefix for audio chunks */
  TEMP_PREFIX: 'erfana-transcription-chunk-',
  /** OpenAI API endpoint for audio transcription */
  OPENAI_API_URL: 'https://api.openai.com/v1/audio/transcriptions',
  /** Primary model */
  PRIMARY_MODEL: 'gpt-4o-transcribe',
  /** Fallback model */
  FALLBACK_MODEL: 'whisper-1',
  /** Maximum file size for single API call (25 MB, OpenAI limit) */
  MAX_API_FILE_SIZE: 25 * 1024 * 1024,
  /** API key encrypted file name */
  API_KEY_FILENAME: 'openai-api-key.enc'
} as const
```

### 3.4 `src/main/services/import/ConverterRegistry.ts`

**Modify** `registerBuiltInConverters()`:

```typescript
import { AudioConverter } from './converters/AudioConverter'
import { transcriptionService } from '../TranscriptionService'
import { audioMetadataService } from '../AudioMetadataService'

function registerBuiltInConverters(registry: ConverterRegistry): void {
  registry.register(new PdfConverter())
  registry.register(new TextConverter())
  registry.register(new AudioConverter(transcriptionService, audioMetadataService))
}
```

### 3.5 `src/main/services/import/index.ts`

**Add** AudioConverter export:

```typescript
export { AudioConverter } from './converters/AudioConverter'
```

### 3.6 `src/main/index.ts`

**Add** handler registration:

```typescript
import { registerTranscriptionHandlers } from './ipc/transcription-handlers'

// In app.whenReady():
registerTranscriptionHandlers()
```

### 3.7 `src/preload/index.ts`

**Add** `transcription` API section:

```typescript
import type {
  TranscriptionImportRequest,
  TranscriptionImportResult,
  TranscriptionProgress
} from '../shared/ipc/transcription-schema'

// Inside api object:
transcription: {
  import: (request: TranscriptionImportRequest): Promise<TranscriptionImportResult> =>
    ipcRenderer.invoke('transcription:import', request),

  cancel: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('transcription:cancel'),

  validate: (filePath: string): Promise<{
    valid: boolean; error?: string; durationSeconds?: number; sizeInMB: number
  }> => ipcRenderer.invoke('transcription:validate', filePath),

  setApiKey: (apiKey: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('transcription:setApiKey', apiKey),

  hasApiKey: (): Promise<boolean> =>
    ipcRenderer.invoke('transcription:hasApiKey'),

  clearApiKey: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('transcription:clearApiKey'),

  onProgress: (callback: (progress: TranscriptionProgress) => void): (() => void) => {
    const listener = (_event: unknown, data: TranscriptionProgress) => callback(data)
    ipcRenderer.on('transcription:progress', listener)
    return () => ipcRenderer.removeListener('transcription:progress', listener)
  }
}
```

### 3.8 `src/preload/index.d.ts`

**Add** matching type declarations for the `transcription` API (same signatures as index.ts).

### 3.9 `src/renderer/src/components/Settings/SettingsOverlay.tsx`

**Add** transcription settings section after the "Git status" section:

```tsx
<section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_TRANSCRIPTION}>
  <h2 className="settings-section-title">Transcription</h2>

  {/* Backend selection */}
  <div className="settings-row">
    <div className="settings-field">
      <label htmlFor="transcription-backend" className="settings-label">
        Backend
      </label>
      <p className="settings-description">
        Service used for audio-to-text transcription
      </p>
    </div>
    <select
      id="transcription-backend"
      className="settings-select"
      value={settings?.transcription.backend ?? 'openai'}
      onChange={(e) => updateTranscriptionBackend(e.target.value as TranscriptionBackend)}
      disabled={!settings}
      data-testid={TEST_IDS.SETTINGS_SELECT_TRANSCRIPTION_BACKEND}
    >
      <option value="openai">OpenAI</option>
    </select>
  </div>

  {/* API key management */}
  <div className="settings-row">
    <div className="settings-field">
      <label htmlFor="openai-api-key" className="settings-label">
        OpenAI API key
      </label>
      <p className="settings-description">
        {hasApiKey ? 'API key is configured' : 'Required for transcription'}
      </p>
    </div>
    <div className="settings-api-key-controls">
      {hasApiKey ? (
        <button className="settings-btn-secondary" onClick={handleClearApiKey}>
          Remove key
        </button>
      ) : (
        <input
          type="password"
          id="openai-api-key"
          className="settings-input"
          placeholder="sk-..."
          onBlur={handleSaveApiKey}
          data-testid={TEST_IDS.SETTINGS_INPUT_API_KEY}
        />
      )}
    </div>
  </div>
</section>
```

### 3.10 `src/renderer/src/components/Settings/SettingsOverlay.css`

**Add** styles for API key input and button:

```css
.settings-input {
  /* Same base styling as .settings-select */
  min-width: 200px;
  padding: var(--space-4) var(--space-6);
  background-color: var(--color-bg-tertiary);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: 0;
  color: var(--color-text-primary);
  font-size: var(--text-base);
  font-family: var(--font-sans);
}

.settings-btn-secondary {
  /* Secondary action button */
  padding: var(--space-4) var(--space-8);
  background-color: var(--color-bg-tertiary);
  border: var(--border-width) solid var(--color-border-default);
  border-radius: 0;
  color: var(--color-text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
}

.settings-api-key-controls {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}
```

### 3.11 `src/renderer/src/stores/useGlobalSettingsStore.ts`

**Add** transcription-related update methods:

```typescript
updateTranscriptionBackend: async (backend: TranscriptionBackend) => {
  await get()._updateSection('transcription', (current) => ({ ...current, backend }))
}
```

### 3.12 `src/renderer/src/constants/testids.ts`

**Add** transcription-related test IDs:

```typescript
// =========================================================================
// Settings Overlay - Transcription (4)
// =========================================================================

/** Transcription settings section */
SETTINGS_SECTION_TRANSCRIPTION: 'settings-section-transcription',
/** Backend select dropdown */
SETTINGS_SELECT_TRANSCRIPTION_BACKEND: 'settings-select-transcription-backend',
/** API key input field */
SETTINGS_INPUT_API_KEY: 'settings-input-api-key',
/** API key clear button */
SETTINGS_BTN_CLEAR_API_KEY: 'settings-btn-clear-api-key',

// =========================================================================
// Transcription Dialog (8)
// =========================================================================

/** Transcription dialog container */
TRANSCRIPTION_DIALOG: 'transcription-dialog',
/** Language select dropdown */
TRANSCRIPTION_LANGUAGE_SELECT: 'transcription-language-select',
/** Start transcription button */
TRANSCRIPTION_BTN_START: 'transcription-btn-start',
/** Cancel transcription button */
TRANSCRIPTION_BTN_CANCEL: 'transcription-btn-cancel',
/** Progress bar element */
TRANSCRIPTION_PROGRESS_BAR: 'transcription-progress-bar',
/** Progress percentage text */
TRANSCRIPTION_PROGRESS_TEXT: 'transcription-progress-text',
/** Phase/status description text */
TRANSCRIPTION_PHASE_TEXT: 'transcription-phase-text',
/** Error message area */
TRANSCRIPTION_ERROR: 'transcription-error',
```

Also update the Settings Overlay count comment from `(10)` to `(14)`.

### 3.13 `src/main/ipc/import-handlers.ts`

**Modify** file dialog filters to include audio files:

```typescript
// Add audio filter option
{ name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a'] },
```

---

## 4. Implementation steps (ordered)

### Phase A: Shared foundation (no dependencies)

| Step | Description | Files | Dependencies |
|------|-------------|-------|--------------|
| A1 | Create transcription Zod schemas and types | `src/shared/ipc/transcription-schema.ts` | None |
| A2 | Create transcription IPC channel constants | `src/shared/ipc/transcription-channels.ts` | None |
| A3 | Add transcription error codes to ErrorCode enum | `src/shared/errors.ts` (modify) | None |
| A4 | Add TRANSCRIPTION constants block | `src/shared/constants.ts` (modify) | None |
| A5 | Add TranscriptionSettings to GlobalSettingsSchema | `src/shared/ipc/global-settings-schema.ts` (modify) | A1 |
| A6 | Add transcription test IDs | `src/renderer/src/constants/testids.ts` (modify) | None |

### Phase B: Main process services (depends on A)

| Step | Description | Files | Dependencies |
|------|-------------|-------|--------------|
| B1 | Create ApiKeyService (safeStorage encryption) | `src/main/services/ApiKeyService.ts` | A3, A4 |
| B2 | Create ApiKeyService tests | `src/main/services/ApiKeyService.test.ts` | B1 |
| B3 | Create AudioMetadataService (duration, format detection) | `src/main/services/AudioMetadataService.ts` | A3 |
| B4 | Create AudioMetadataService tests | `src/main/services/AudioMetadataService.test.ts` | B3 |
| B5 | Create TranscriptionService (OpenAI API, chunking, retry) | `src/main/services/TranscriptionService.ts` | A1-A5, B1, B3 |
| B6 | Create TranscriptionService tests | `src/main/services/TranscriptionService.test.ts` | B5 |
| B7 | Create AudioConverter (IConverter implementation) | `src/main/services/import/converters/AudioConverter.ts` | B3, B5 |
| B8 | Create AudioConverter tests | `src/main/services/import/converters/AudioConverter.test.ts` | B7 |
| B9 | Register AudioConverter in ConverterRegistry | `src/main/services/import/ConverterRegistry.ts` (modify) | B7 |
| B10 | Export AudioConverter from import index | `src/main/services/import/index.ts` (modify) | B7 |

### Phase C: IPC layer (depends on B)

| Step | Description | Files | Dependencies |
|------|-------------|-------|--------------|
| C1 | Create transcription IPC handlers | `src/main/ipc/transcription-handlers.ts` | B1, B3, B5 |
| C2 | Create transcription IPC handler tests | `src/main/ipc/transcription-handlers.test.ts` | C1 |
| C3 | Register handlers in main/index.ts | `src/main/index.ts` (modify) | C1 |
| C4 | Add audio filter to import dialog | `src/main/ipc/import-handlers.ts` (modify) | B9 |

### Phase D: Preload bridge (depends on C)

| Step | Description | Files | Dependencies |
|------|-------------|-------|--------------|
| D1 | Add transcription API to preload/index.ts | `src/preload/index.ts` (modify) | A1, A2 |
| D2 | Add transcription types to preload/index.d.ts | `src/preload/index.d.ts` (modify) | A1, A2 |

### Phase E: Renderer (depends on D)

| Step | Description | Files | Dependencies |
|------|-------------|-------|--------------|
| E1 | Create useTranscriptionStore (Zustand) | `src/renderer/src/stores/useTranscriptionStore.ts` | A1 |
| E2 | Create useTranscriptionStore tests | `src/renderer/src/stores/useTranscriptionStore.test.ts` | E1 |
| E3 | Create LanguageSelect component | `src/renderer/src/components/Transcription/LanguageSelect.tsx` | A1 |
| E4 | Create TranscriptionDialog component | `src/renderer/src/components/Transcription/TranscriptionDialog.tsx` | E1, E3 |
| E5 | Create TranscriptionDialog CSS | `src/renderer/src/components/Transcription/TranscriptionDialog.css` | None |
| E6 | Create TranscriptionDialog tests | `src/renderer/src/components/Transcription/TranscriptionDialog.test.tsx` | E4 |
| E7 | Add transcription section to SettingsOverlay | `src/renderer/src/components/Settings/SettingsOverlay.tsx` (modify) | E1, A5 |
| E8 | Add settings input/button styles | `src/renderer/src/components/Settings/SettingsOverlay.css` (modify) | None |
| E9 | Add transcription update methods to useGlobalSettingsStore | `src/renderer/src/stores/useGlobalSettingsStore.ts` (modify) | A5 |
| E10 | Wire TranscriptionDialog into import workflow | (integration point -- connect to existing import flow) | E4, E1 |

---

## 5. IPC contract definitions

### Request/response channels (ipcMain.handle)

| Channel | Direction | Request payload | Response payload |
|---------|-----------|-----------------|------------------|
| `transcription:import` | R->M | `TranscriptionImportRequest` | `TranscriptionImportResult` |
| `transcription:cancel` | R->M | (none) | `{ success: boolean; error?: string }` |
| `transcription:validate` | R->M | `string` (filePath) | `{ valid: boolean; error?: string; durationSeconds?: number; sizeInMB: number }` |
| `transcription:setApiKey` | R->M | `string` (apiKey) | `{ success: boolean; error?: string }` |
| `transcription:hasApiKey` | R->M | (none) | `boolean` |
| `transcription:clearApiKey` | R->M | (none) | `{ success: boolean; error?: string }` |

### Streaming channels (webContents.send)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `transcription:progress` | M->R | `TranscriptionProgress` |

---

## 6. npm dependencies to add

| Package | Purpose | Size | Notes |
|---------|---------|------|-------|
| `music-metadata` | Audio file metadata parsing (duration, format, bitrate) | ~150KB | Pure JS, no native deps. Supports MP3, WAV, M4A, FLAC, OGG. Well-maintained (4.3M weekly downloads). |

No other new dependencies. OpenAI API is called via Node.js built-in `fetch()` (available in Node 18+, Electron 39 bundles Node 22).

---

## 7. Test strategy

### Coverage target: >80%

### Unit tests (main process)

| Test file | Component | Key scenarios |
|-----------|-----------|---------------|
| `ApiKeyService.test.ts` | ApiKeyService | Store/retrieve/clear key, safeStorage unavailable fallback, file I/O errors |
| `AudioMetadataService.test.ts` | AudioMetadataService | MP3/WAV/M4A duration extraction, invalid files, corrupt headers, missing files |
| `TranscriptionService.test.ts` | TranscriptionService | Single file transcription, chunked transcription, retry on rate limit, cancellation via AbortSignal, temp file cleanup on success, temp file cleanup on failure, fallback model on primary failure, progress callback invocation, network errors |
| `AudioConverter.test.ts` | AudioConverter | Validate audio files, convert with frontmatter, unsupported format, empty file |
| `transcription-handlers.test.ts` | IPC handlers | Import flow, cancel flow, API key management, validation, error responses, request schema validation |

### Unit tests (renderer)

| Test file | Component | Key scenarios |
|-----------|-----------|---------------|
| `useTranscriptionStore.test.ts` | Zustand store | State transitions, progress updates, dialog open/close, error handling |
| `TranscriptionDialog.test.tsx` | Dialog component | Language selection, progress bar rendering, cancel button, error display, ARIA attributes |
| `LanguageSelect.test.tsx` | Language selector | Renders options, selection callback, default value |

### Schema tests

| Test file | Component | Key scenarios |
|-----------|-----------|---------------|
| `transcription-schema.test.ts` | Zod schemas | Valid/invalid request parsing, language enum coverage, settings defaults |

### Integration mapping to acceptance criteria

| AC | Test | Type |
|----|------|------|
| AC-1 (MP3 produces markdown with frontmatter) | TranscriptionService.test.ts -- "produces markdown with YAML frontmatter" | Unit |
| AC-2 (Progress bar 0-100% with ETA) | TranscriptionDialog.test.tsx -- "updates progress bar" | Unit |
| AC-3 (Language selection affects output) | TranscriptionService.test.ts -- "passes language to API" | Unit |
| AC-4 (OpenAI authenticated calls) | TranscriptionService.test.ts -- "sends auth header" | Unit |
| AC-5 (Chunked with "Processing chunk N of M") | TranscriptionService.test.ts -- "chunks files >8 min" | Unit |
| AC-6 (Continuous transcript, no gaps) | TranscriptionService.test.ts -- "joins chunks without gaps" | Unit |
| AC-7 (Rate limit retry with backoff) | TranscriptionService.test.ts -- "retries on 429" | Unit |
| AC-8 (Temp files cleaned on success) | TranscriptionService.test.ts -- "cleans temp files after success" | Unit |
| AC-9 (Temp files cleaned on failure/cancel) | TranscriptionService.test.ts -- "cleans temp files after failure" | Unit |
| AC-10 (Invalid/corrupt media error) | AudioMetadataService.test.ts -- "rejects corrupt file" | Unit |
| AC-11 (Backend persists across restarts) | GlobalSettingsService.test.ts -- existing pattern covers this | Integration |
| AC-12 (Source path and duration in frontmatter) | TranscriptionService.test.ts -- "frontmatter includes source and duration" | Unit |
| AC-13 (UI responsive during transcription) | Architecture ensures this (async IPC, web worker not needed) | By design |
| AC-14 (Cancellation stops and cleans) | TranscriptionService.test.ts -- "AbortSignal cancels and cleans" | Unit |

---

## 8. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | `music-metadata` fails on certain M4A variants | Low | Medium | Fallback to file-size-based duration estimation; validate with test fixtures |
| R2 | OpenAI API changes endpoint or model names | Low | High | Constants-driven configuration makes updates trivial; fallback model exists |
| R3 | Chunking at arbitrary byte boundaries produces corrupted audio segments | Medium | High | Use `music-metadata` to find frame boundaries; overlap at chunk boundaries; test with real MP3/WAV files |
| R4 | safeStorage unavailable on some Linux configurations | Low | Medium | Fallback to plaintext storage with prominent warning log; documented in known issues |
| R5 | Large files (>1 hour) cause memory pressure from concatenated transcript | Low | Low | Stream transcript to disk incrementally; files >1 hour are edge case for Stage 1 |
| R6 | `IConverter` interface does not support progress callbacks | Known | Medium | Dedicated `transcription:import` IPC channel bypasses `import:process`; AudioConverter.convert() is for headless use only |
| R7 | Rate limiting from OpenAI during chunked transcription | Medium | Medium | Exponential backoff with configurable max retries; progress UI shows retry state |

---

## 9. Scope estimates

| Metric | Value |
|--------|-------|
| **Complexity** | Complex |
| **New files** | 14 |
| **Modified files** | 13 |
| **Test files** | 8 |
| **Total files affected** | 35 |

### New files breakdown

| # | File | Type |
|---|------|------|
| 1 | `src/shared/ipc/transcription-schema.ts` | Shared types |
| 2 | `src/shared/ipc/transcription-channels.ts` | Shared constants |
| 3 | `src/main/services/ApiKeyService.ts` | Service |
| 4 | `src/main/services/ApiKeyService.test.ts` | Test |
| 5 | `src/main/services/AudioMetadataService.ts` | Service |
| 6 | `src/main/services/AudioMetadataService.test.ts` | Test |
| 7 | `src/main/services/TranscriptionService.ts` | Service |
| 8 | `src/main/services/TranscriptionService.test.ts` | Test |
| 9 | `src/main/services/import/converters/AudioConverter.ts` | Converter |
| 10 | `src/main/services/import/converters/AudioConverter.test.ts` | Test |
| 11 | `src/main/ipc/transcription-handlers.ts` | IPC handlers |
| 12 | `src/main/ipc/transcription-handlers.test.ts` | Test |
| 13 | `src/renderer/src/components/Transcription/TranscriptionDialog.tsx` | Component |
| 14 | `src/renderer/src/components/Transcription/TranscriptionDialog.css` | Styles |
| 15 | `src/renderer/src/components/Transcription/TranscriptionDialog.test.tsx` | Test |
| 16 | `src/renderer/src/components/Transcription/LanguageSelect.tsx` | Component |
| 17 | `src/renderer/src/stores/useTranscriptionStore.ts` | Store |
| 18 | `src/renderer/src/stores/useTranscriptionStore.test.ts` | Test |
| 19 | `src/shared/ipc/transcription-schema.test.ts` | Test |

### Modified files breakdown

| # | File | Change scope |
|---|------|-------------|
| 1 | `src/shared/errors.ts` | Add 10 error codes + messages |
| 2 | `src/shared/constants.ts` | Add TRANSCRIPTION block |
| 3 | `src/shared/ipc/global-settings-schema.ts` | Add transcription section |
| 4 | `src/main/services/import/ConverterRegistry.ts` | Register AudioConverter |
| 5 | `src/main/services/import/index.ts` | Export AudioConverter |
| 6 | `src/main/index.ts` | Register transcription handlers |
| 7 | `src/main/ipc/import-handlers.ts` | Add audio filter to dialog |
| 8 | `src/preload/index.ts` | Add transcription API |
| 9 | `src/preload/index.d.ts` | Add transcription types |
| 10 | `src/renderer/src/components/Settings/SettingsOverlay.tsx` | Add transcription section |
| 11 | `src/renderer/src/components/Settings/SettingsOverlay.css` | Add input/button styles |
| 12 | `src/renderer/src/stores/useGlobalSettingsStore.ts` | Add transcription methods |
| 13 | `src/renderer/src/constants/testids.ts` | Add transcription test IDs |

---

## 10. Verification criteria (Phase 8 checklist)

- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run lint` passes with no warnings
- [ ] `npm run test` passes with all new tests green
- [ ] `npm run test:cov` shows >80% coverage for new files
- [ ] AudioConverter registered and discoverable via `converterRegistry.getConverter('mp3')`
- [ ] GlobalSettings loads with transcription defaults (`backend: 'openai'`, `openaiApiKeyStored: false`)
- [ ] API key can be stored and retrieved via safeStorage
- [ ] Settings overlay shows transcription section with backend select and API key management
- [ ] TranscriptionDialog renders with language selector, progress bar, and cancel button
- [ ] Mock transcription flow: language select -> progress updates -> markdown written to import/
- [ ] Cancellation via AbortSignal stops transcription and cleans temp files
- [ ] Retry on 429 HTTP status (mocked) succeeds after backoff
- [ ] Markdown output has correct YAML frontmatter (source, duration, date, language)
- [ ] Chunked file produces continuous transcript with chunk progress indicators
- [ ] Invalid audio file shows actionable error message with error code
- [ ] No API key in log output (verify logger.debug/info calls don't include key)

---

## 11. Implementation split recommendation

This design supports splitting between two developers:

**software-developer (main process)**: Phases A + B + C
- Shared types, schemas, constants, error codes
- ApiKeyService, AudioMetadataService, TranscriptionService
- AudioConverter, ConverterRegistry registration
- IPC handlers

**react-developer (renderer)**: Phases D + E
- Preload bridge
- TranscriptionDialog, LanguageSelect components
- useTranscriptionStore, useGlobalSettingsStore extensions
- SettingsOverlay transcription section
- CSS styles

Phase D (preload) depends on Phase A (schemas/types) being complete. The split point is clean because the IPC contract is fully defined in this document.
