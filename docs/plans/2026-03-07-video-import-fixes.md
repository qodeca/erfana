# Video import fixes implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all issues identified in technical architect, solution architect, and test writer reviews for issue #110.

**Architecture:** Fixes are organized bottom-up: shared utilities first, then service-level code fixes, then test gaps. Each task is independent after Task 1 (shared utility extraction). TDD where applicable.

**Tech Stack:** TypeScript 5.7, Vitest, fluent-ffmpeg, Electron IPC

---

## Task 1: Extract shared `formatDuration` to `fileUtils.ts`

Consolidates the 2 copies of `formatDuration` into one shared utility. Also adds hour support (e.g., `1:30:00` for 90 minutes).

**Files:**
- Modify: `src/main/utils/fileUtils.ts` (add function)
- Modify: `src/main/utils/fileUtils.test.ts` (add tests)
- Modify: `src/main/ipc/transcription-handlers.ts:455-459` (replace local copy)
- Modify: `src/main/services/import/converters/VideoConverter.ts:217-221` (replace private method)

**Step 1: Write failing tests for `formatDuration` in `fileUtils.test.ts`**

Add to the end of `src/main/utils/fileUtils.test.ts`:

```typescript
describe('formatDuration', () => {
  it('should format zero seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  it('should format sub-minute duration', () => {
    expect(formatDuration(45)).toBe('0:45')
  })

  it('should format exact minutes', () => {
    expect(formatDuration(180)).toBe('3:00')
  })

  it('should pad seconds with zero', () => {
    expect(formatDuration(125)).toBe('2:05')
  })

  it('should format hour-length duration', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
  })

  it('should format hours with minutes and seconds', () => {
    expect(formatDuration(5425)).toBe('1:30:25')
  })

  it('should pad minutes when hours are present', () => {
    expect(formatDuration(3665)).toBe('1:01:05')
  })
})
```

Also add the import of `formatDuration` at the top of the test file.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/utils/fileUtils.test.ts`
Expected: FAIL – `formatDuration` not exported from `fileUtils.ts`

**Step 3: Implement `formatDuration` in `fileUtils.ts`**

Add to `src/main/utils/fileUtils.ts`:

```typescript
/**
 * Format duration in seconds to a human-readable string.
 *
 * - Under 1 hour: "M:SS" (e.g., "3:05")
 * - 1 hour or more: "H:MM:SS" (e.g., "1:30:25")
 */
export function formatDuration(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/utils/fileUtils.test.ts`
Expected: PASS

**Step 5: Replace local copy in `transcription-handlers.ts`**

- Remove the local `formatDuration` function (lines 455–459)
- Add import: `import { formatDuration } from '../utils/fileUtils'` (add to existing path import or new line)

**Step 6: Replace private method in `VideoConverter.ts`**

- Remove the private `formatDuration` method (lines 217–221)
- Change `this.formatDuration(durationSeconds)` at line 188 to `formatDuration(durationSeconds)`
- Add import: `import { formatDuration } from '../../../utils/fileUtils'`

**Step 7: Run full test suite**

Run: `npm run test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add src/main/utils/fileUtils.ts src/main/utils/fileUtils.test.ts \
  src/main/ipc/transcription-handlers.ts \
  src/main/services/import/converters/VideoConverter.ts
git commit -m "$(cat <<'EOF'
refactor: extract formatDuration to shared utility with hour support

Consolidates 2 copies of formatDuration (transcription-handlers.ts,
VideoConverter.ts) into fileUtils.ts. Adds hour formatting (H:MM:SS)
for videos longer than 60 minutes.
EOF
)"
```

---

## Task 2: Extract shared `ITranscriptionServiceLike` interface

Deduplicates the interface defined identically in AudioConverter and VideoConverter.

**Files:**
- Modify: `src/main/services/import/types.ts` (add interface)
- Modify: `src/main/services/import/converters/AudioConverter.ts:26-33` (replace local)
- Modify: `src/main/services/import/converters/VideoConverter.ts:27-35` (replace local)

**Step 1: Add interface to `types.ts`**

Add to `src/main/services/import/types.ts` before the `IConverter` interface:

```typescript
import type { TranscriptionResult } from '../../../shared/ipc/transcription-schema'

/** Interface for TranscriptionService dependency (used by audio/video converters) */
export interface ITranscriptionServiceLike {
  transcribe(
    filePath: string,
    language: 'auto' | string,
    onProgress: (progress: { percent: number; phase: string }) => void,
    signal?: AbortSignal
  ): Promise<TranscriptionResult>
}
```

**Step 2: Update AudioConverter.ts**

- Remove local `interface ITranscriptionServiceLike` (lines 26–33)
- Add to existing import from `../types`: `ITranscriptionServiceLike`

**Step 3: Update VideoConverter.ts**

- Remove local `interface ITranscriptionServiceLike` (lines 28–35)
- Remove the `import type { TranscriptionResult }` line (no longer needed directly)
- Add to existing import from `../types`: `ITranscriptionServiceLike`

**Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/main/services/import/types.ts \
  src/main/services/import/converters/AudioConverter.ts \
  src/main/services/import/converters/VideoConverter.ts
git commit -m "$(cat <<'EOF'
refactor: extract ITranscriptionServiceLike to shared types

Removes duplicate interface definitions from AudioConverter and
VideoConverter. Single source of truth in import/types.ts.
EOF
)"
```

---

## Task 3: Add `settled` flag and abort detection in `extractAudio`

Fixes the double-rejection race between timeout and error handler, and makes cancellation produce a distinguishable error instead of a generic ffmpeg crash message.

**Files:**
- Modify: `src/main/services/AudioExtractionService.ts:125-175` (refactor promise body)

**Step 1: Refactor `extractAudio` promise body**

Replace the entire promise body (lines 125–175) in `AudioExtractionService.ts`:

```typescript
    return new Promise<ExtractionResult>((resolve, reject) => {
      let settled = false

      const settle = (fn: typeof resolve | typeof reject, value: ExtractionResult | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        ;(fn as (v: unknown) => void)(value)
      }

      const command = Ffmpeg(filePath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('progress', (progress: { percent?: number }) => {
          if (onProgress && progress.percent != null) {
            onProgress(Math.min(progress.percent, 100))
          }
        })
        .on('end', () => {
          settle(resolve, { audioPath: outputPath, durationSeconds })
        })
        .on('error', async (err: Error) => {
          // Clean up temp file on error
          try {
            await unlink(outputPath)
          } catch {
            // File may not exist yet
          }
          // Distinguish cancellation from other errors
          if (signal?.aborted) {
            settle(reject, new Error('Audio extraction cancelled'))
          } else {
            settle(reject, err)
          }
        })
        .save(outputPath)

      // Handle abort signal
      let onAbort: (() => void) | undefined
      if (signal) {
        onAbort = (): void => {
          command.kill('SIGKILL')
        }
        if (signal.aborted) {
          command.kill('SIGKILL')
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      }

      // Timeout safety
      const timeout = setTimeout(() => {
        command.kill('SIGKILL')
        settle(reject, new Error('Audio extraction timed out'))
      }, VIDEO_IMPORT.EXTRACTION_TIMEOUT_MS)
    })
```

Key changes:
- `settled` flag prevents double-resolve/reject
- `settle()` helper centralizes cleanup (clear timeout, remove abort listener)
- Error handler checks `signal?.aborted` to produce "cancelled" vs original error
- Timeout goes through `settle()` so it can't race with `error` handler

**Step 2: Run existing tests**

Run: `npx vitest run src/main/services/AudioExtractionService.test.ts`
Expected: All 26 existing tests pass (no behavioral change for covered paths)

**Step 3: Commit**

```bash
git add src/main/services/AudioExtractionService.ts
git commit -m "$(cat <<'EOF'
fix: add settled flag and abort detection in extractAudio

Prevents double-rejection race between timeout and error handler.
Cancellation now produces 'Audio extraction cancelled' instead of
a generic ffmpeg crash message.
EOF
)"
```

---

## Task 4: Fix vacuous `isAvailable()` test

The test at line 525 asserts `true === true` – it doesn't exercise the guard.

**Files:**
- Modify: `src/main/services/AudioExtractionService.test.ts:525-540` (replace test)

**Step 1: Replace the test**

Replace the test "should reject with 'ffmpeg is not available' when not available" (lines 525–540) with:

```typescript
    it('should throw when ffmpeg is not available', async () => {
      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      // Spy on isAvailable to return false
      vi.spyOn(service, 'isAvailable').mockReturnValue(false)

      await expect(service.extractAudio('/path/to/video.mp4')).rejects.toThrow(
        'ffmpeg is not available'
      )
    })
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/main/services/AudioExtractionService.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/services/AudioExtractionService.test.ts
git commit -m "fix(test): replace vacuous isAvailable test with proper spy-based guard test"
```

---

## Task 5: Add timeout path test for `extractAudio`

Tests the 5-minute timeout safety that kills ffmpeg and rejects.

**Files:**
- Modify: `src/main/services/AudioExtractionService.test.ts` (add test in `extractAudio` describe)

**Step 1: Add the timeout test**

Add inside the `extractAudio` describe block:

```typescript
    it('should reject with timeout error when extraction exceeds timeout', async () => {
      vi.useFakeTimers()

      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      // Don't fire 'end' or 'error' – simulate a hung ffmpeg process
      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance) {
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const promise = service.extractAudio('/path/to/video.mp4')

      // Advance past the timeout (5 minutes)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)

      await expect(promise).rejects.toThrow('Audio extraction timed out')
      expect(mockKill).toHaveBeenCalledWith('SIGKILL')

      vi.useRealTimers()
    })
```

**Step 2: Run test**

Run: `npx vitest run src/main/services/AudioExtractionService.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/services/AudioExtractionService.test.ts
git commit -m "test: add timeout path test for extractAudio"
```

---

## Task 6: Add abort mid-flight test for `extractAudio`

Tests async abort (signal fires after extraction starts, not pre-aborted).

**Files:**
- Modify: `src/main/services/AudioExtractionService.test.ts` (add test in `extractAudio` describe)

**Step 1: Add the mid-flight abort test**

Add inside the `extractAudio` describe block:

```typescript
    it('should reject with cancellation error when abort fires mid-extraction', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const abortController = new AbortController()

      // When abort signal listener is registered, store the handler so we can trigger it
      // When 'error' is registered, store the handler so we can simulate ffmpeg crash after kill
      let errorHandler: ((err: Error) => void) | undefined

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (err?: Error) => void) {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      const promise = service.extractAudio('/path/to/video.mp4', undefined, abortController.signal)

      // Simulate: user aborts, which kills ffmpeg, which triggers error event
      abortController.abort()
      expect(mockKill).toHaveBeenCalledWith('SIGKILL')

      // Simulate ffmpeg error event after being killed
      errorHandler?.(new Error('ffmpeg was killed with signal SIGKILL'))

      await expect(promise).rejects.toThrow('Audio extraction cancelled')
    })
```

**Step 2: Run test**

Run: `npx vitest run src/main/services/AudioExtractionService.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/services/AudioExtractionService.test.ts
git commit -m "test: add mid-flight abort test for extractAudio"
```

---

## Task 7: Add missing `VideoConverter` test cases

Covers: language undefined fallback, errorCode propagation fallback, formatDuration edge cases via convert().

**Files:**
- Modify: `src/main/services/import/converters/VideoConverter.test.ts` (add tests)

**Step 1: Add language undefined test**

Add inside `convert – success` describe:

```typescript
    it('should default to "auto" language when transcription returns no language', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: true,
        transcript: 'Some text.',
        duration: 60,
        language: undefined
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(true)
      expect(result.content).toContain('language: auto')
    })
```

**Step 2: Add errorCode fallback test**

Add inside `convert – transcription failure` describe:

```typescript
    it('should fall back to IMPORT_CONVERSION_FAILED when errorCode is not a known ErrorCode', async () => {
      mockTranscriptionService.transcribe.mockResolvedValue({
        success: false,
        error: 'Unknown error',
        errorCode: 'SOME_UNKNOWN_CODE'
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe(ErrorCode.IMPORT_CONVERSION_FAILED)
    })
```

**Step 3: Add formatDuration edge case tests**

Add inside `convert – success` describe:

```typescript
    it('should format zero-duration video', async () => {
      mockAudioExtractionService.getVideoMetadata.mockResolvedValue({
        durationSeconds: 0,
        resolution: '640x480',
        videoCodec: 'h264',
        audioCodec: 'aac'
      })
      mockAudioExtractionService.extractAudio.mockResolvedValue({
        audioPath: '/tmp/erfana-video-audio-test.wav',
        durationSeconds: 0
      })

      const result = await converter.convert('/path/to/video.mp4')

      expect(result.content).toContain('duration: "0:00"')
    })

    it('should format hour-length video duration', async () => {
      mockAudioExtractionService.getVideoMetadata.mockResolvedValue({
        durationSeconds: 5425,
        resolution: '1920x1080',
        videoCodec: 'h264',
        audioCodec: 'aac'
      })
      mockAudioExtractionService.extractAudio.mockResolvedValue({
        audioPath: '/tmp/erfana-video-audio-test.wav',
        durationSeconds: 5425
      })

      const result = await converter.convert('/path/to/video.mp4')

      // 5425 seconds = 1:30:25
      expect(result.content).toContain('duration: "1:30:25"')
    })
```

**Step 4: Run tests**

Run: `npx vitest run src/main/services/import/converters/VideoConverter.test.ts`
Expected: PASS (the hour-length test will only pass after Task 1 is complete)

**Step 5: Commit**

```bash
git add src/main/services/import/converters/VideoConverter.test.ts
git commit -m "test: add missing VideoConverter test cases (language fallback, errorCode, duration edge cases)"
```

---

## Task 8: Add progress `null`/`undefined` percent guard test

**Files:**
- Modify: `src/main/services/AudioExtractionService.test.ts` (add test)

**Step 1: Add the test**

Add inside the `extractAudio` describe block:

```typescript
    it('should not call progress callback when percent is null or undefined', async () => {
      mockFfprobe.mockImplementation((_path: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          streams: [{ codec_type: 'audio', codec_name: 'aac' }],
          format: { duration: '60' }
        })
      })

      const onProgress = vi.fn()

      mockOn.mockImplementation(function(this: typeof mockFfmpegInstance, event: string, handler: (arg?: unknown) => void) {
        if (event === 'progress') {
          Promise.resolve().then(() => {
            handler({ percent: null })
            handler({ percent: undefined })
            handler({})
            handler({ percent: 50 }) // Only this one should trigger callback
          })
        }
        if (event === 'end') {
          Promise.resolve().then(() => Promise.resolve().then(() => handler()))
        }
        return this
      })

      const { AudioExtractionService } = await import('./AudioExtractionService')
      const service = new AudioExtractionService()

      await service.extractAudio('/path/to/video.mp4', onProgress)

      expect(onProgress).toHaveBeenCalledTimes(1)
      expect(onProgress).toHaveBeenCalledWith(50)
    })
```

**Step 2: Run test**

Run: `npx vitest run src/main/services/AudioExtractionService.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/services/AudioExtractionService.test.ts
git commit -m "test: add progress null/undefined percent guard test"
```

---

## Task 9: Add `useImport` uppercase extension test

**Files:**
- Modify: `src/renderer/src/hooks/useImport.test.ts` (add test in video routing section)

**Step 1: Add the test**

Add inside the video routing describe block (near the other format-specific tests):

```typescript
    it('should route uppercase .MP4 extension to TranscriptionDialog', async () => {
      mockSelectFile.mockResolvedValue({
        path: '/path/to/VIDEO.MP4',
        name: 'VIDEO.MP4',
        sizeInMB: 10,
        extension: 'MP4'
      })

      const { result } = renderHook(() => useImport(), { wrapper })
      await act(async () => {
        await result.current.importFile()
      })

      expect(mockOpenDialog).toHaveBeenCalledWith('/path/to/VIDEO.MP4', 'VIDEO.MP4')
    })
```

Note: Check how `mockSelectFile` and `mockOpenDialog` are named in the existing test file – use the exact same variable names.

**Step 2: Run test**

Run: `npx vitest run src/renderer/src/hooks/useImport.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/src/hooks/useImport.test.ts
git commit -m "test: add uppercase extension routing test for video import"
```

---

## Task 10: Final verification

**Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm run test`
Expected: All tests pass, 0 failures

**Step 4: Verify test count increase**

The test count should increase from 6598 to approximately 6612+ (7 new fileUtils tests + 1 timeout + 1 abort mid-flight + 1 isAvailable fix + 4 VideoConverter + 1 progress guard + 1 uppercase = ~16 new tests).

---

## Dependency graph

```
Task 1 (formatDuration) ──┬──→ Task 7 (VideoConverter tests – hour format depends on Task 1)
                           │
Task 2 (ITranscriptionServiceLike) ──→ independent
Task 3 (settled flag) ──→ Task 5 (timeout test) ──→ Task 6 (abort test)
Task 4 (isAvailable test) ──→ independent
Task 8 (progress guard test) ──→ independent
Task 9 (uppercase extension test) ──→ independent
Task 10 (final verification) ──→ depends on ALL above
```

**Parallelizable groups:**
- Group A: Tasks 1, 2, 3, 4, 8, 9 (all independent)
- Group B: Tasks 5, 6 (depend on Task 3)
- Group C: Task 7 (depends on Task 1)
- Group D: Task 10 (depends on all)
