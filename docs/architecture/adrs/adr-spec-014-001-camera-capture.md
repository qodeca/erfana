---
spec_id: 14
document_type: technical_adr
sequence: 1
---

# ADR-Spec014-001: Camera photo capture architecture

**Date:** 2026-01 | **Status:** Proposed

## Context

Spec #014 specifies a camera photo capture feature for the Terminal Panel toolbar. Users need to quickly capture photos of physical objects (whiteboards, hardware, notes) and have the file path immediately available in the terminal for use in commands.

### Requirements summary

From Spec #014, the key requirements are:

- **FR-001 to FR-011**: Toolbar button, modal dialog, device enumeration, live preview (15+ FPS), photo capture, file saving, path insertion, permission handling, no-camera handling, device disconnection, keyboard accessibility
- **NFR-001**: Cross-platform support (macOS, Windows, Linux)
- **NFR-002**: Performance (<500ms to first frame, <100MB memory during preview)
- **NFR-003**: Resolution (native up to 4K, preview capped at 1080p)

### Architectural challenge

The primary architectural decision is where camera logic should reside:

1. **Main process approach** (like ScreenshotService): Use native Electron APIs or external binaries
2. **Renderer-only approach**: Use Web APIs (`navigator.mediaDevices.getUserMedia()`) directly in React

This is different from the existing ScreenshotService because:
- ScreenshotService uses macOS-only `screencapture` binary (no Web API equivalent)
- Camera capture has cross-platform Web APIs available in all browsers/Electron
- Camera needs continuous video stream, not one-time capture

## Decision drivers

1. **Cross-platform support** (HIGH) - Must work on macOS, Windows, and Linux without platform-specific code
2. **Web API maturity** (HIGH) - `getUserMedia()` is mature, well-documented, and Electron-native
3. **Simplicity** (HIGH) - Minimize complexity; reuse existing patterns where possible
4. **Performance** (MEDIUM) - Meet 15 FPS preview, <500ms to first frame
5. **Memory efficiency** (MEDIUM) - Stay under 100MB during preview
6. **Existing patterns** (MEDIUM) - Align with codebase conventions (BaseDialog, TerminalToolbar)

## Considered options

### Option 1: Main process CameraService (like ScreenshotService)

| Pros | Cons |
|------|------|
| Consistent with ScreenshotService pattern | Requires IPC for video stream (complex) |
| Main process has full system access | No cross-platform native camera API |
| | Would need FFmpeg or platform-specific binaries |
| | Significant complexity for video streaming |

### Option 2: Renderer-only with Web APIs (recommended)

| Pros | Cons |
|------|------|
| Cross-platform by default (Web API) | Different pattern than ScreenshotService |
| No IPC for video stream | Renderer has direct camera access |
| Simpler implementation | |
| Well-documented, mature API | |
| Full React/hooks integration | |

### Option 3: Hybrid (renderer capture + main save)

| Pros | Cons |
|------|------|
| Main process handles file I/O | Mixed responsibility |
| Renderer handles camera | Two process coordination |
| Reuses FileService patterns | More complex than pure renderer |

## Decision outcome

**Chosen option: Option 2 - Renderer-only with Web APIs**

The camera feature will use `navigator.mediaDevices.getUserMedia()` in the renderer process exclusively. The main process is only involved for file saving via the existing IPC patterns.

### Rationale

1. **Web API is cross-platform**: Works identically on macOS, Windows, and Linux
2. **No IPC complexity for video**: Streaming video through IPC would add latency and complexity
3. **Electron supports Web APIs**: `getUserMedia()` works in Electron's renderer process
4. **Simpler architecture**: One-way IPC only for file save (renderer -> main)
5. **React-friendly**: Hooks can manage stream lifecycle naturally

This differs from ScreenshotService because:
- ScreenshotService uses platform-specific binary (`screencapture` on macOS)
- Screenshot has no Web API equivalent for system-level capture
- Camera capture has excellent Web API support

## Architecture design

### Component architecture

```
TerminalPanel
    |
    +-- TerminalToolbar
    |       |
    |       +-- [Camera Button] (new)
    |
    +-- CameraDialog (new)
            |
            +-- useCameraCapture (new hook)
            |       |
            |       +-- navigator.mediaDevices.getUserMedia()
            |       +-- navigator.mediaDevices.enumerateDevices()
            |       +-- MediaStream management
            |
            +-- CameraPreview (new)
            |       |
            |       +-- <video> element with stream
            |
            +-- Device selector dropdown
            +-- Capture/Cancel buttons
```

### Data flow

```
1. USER CLICKS CAMERA BUTTON
   TerminalToolbar -> setCameraDialogOpen(true)

2. DIALOG OPENS, HOOK INITIALIZES
   useCameraCapture:
     - enumerateDevices() -> list cameras
     - getUserMedia({ video: constraints }) -> MediaStream
     - Attach stream to <video> element

3. USER SELECTS DIFFERENT CAMERA
   useCameraCapture:
     - Stop current stream tracks
     - getUserMedia() with new deviceId
     - Update video element srcObject

4. USER CLICKS CAPTURE
   useCameraCapture:
     - Create canvas from video dimensions
     - drawImage(video) to canvas
     - canvas.toBlob('image/jpeg', 0.92)
     - Send blob to main process via IPC
     - Main: Write file to temp directory
     - Main: Return file path
     - Renderer: Insert path to terminal
     - Close dialog

5. DIALOG CLOSES
   useCameraCapture:
     - Stop all stream tracks
     - Release camera resource
```

### File structure

**New files:**

```
src/renderer/src/components/
    Dialog/
        CameraDialog.tsx        # Modal dialog component
        CameraDialog.css        # Styling (design tokens)
    Panels/TerminalPanel/
        hooks/
            useCameraCapture.ts # Camera logic hook

src/shared/ipc/
    camera-schema.ts            # Zod schemas for IPC

src/main/ipc/
    camera-handlers.ts          # File save handler
```

**Modified files:**

```
src/renderer/src/components/
    Dialog/index.ts             # Export CameraDialog
    Panels/TerminalPanel/
        components/
            TerminalToolbar.tsx # Add camera button
        types.ts                # Add camera types

src/renderer/src/constants/
    testids.ts                  # Add camera testids

src/shared/
    errors.ts                   # Add camera error codes
    constants.ts                # Add camera constants

src/preload/index.ts           # Expose camera IPC
src/preload/index.d.ts         # Type declarations

src/main/index.ts              # Register camera handlers
```

### Key technical decisions

#### 1. Video constraints for preview vs capture

```typescript
// Preview constraints (memory efficient)
const previewConstraints: MediaTrackConstraints = {
  deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
  width: { ideal: 1280, max: 1920 },  // Max 1080p
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 }
}

// Capture uses native resolution from current stream
// No separate high-res stream needed - capture from preview
```

**Rationale**: NFR-002 requires preview capped at 1080p for memory. Capture uses the preview stream's resolution which is sufficient (1080p is high quality for photos). Native 4K would require a separate stream request at capture time, adding complexity and latency.

#### 2. JPEG-only output

```typescript
const blob = await new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(
    (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
    'image/jpeg',
    0.92  // Quality 92%
  )
})
```

**Rationale**: Per Solution Architect review, JPEG-only simplifies implementation and produces smaller files. PNG support can be added later if needed.

#### 3. Device persistence via localStorage

```typescript
const STORAGE_KEY = 'erfana.camera.lastDeviceId'

// On mount, try to restore last device
const lastDeviceId = localStorage.getItem(STORAGE_KEY)
if (lastDeviceId && devices.some(d => d.deviceId === lastDeviceId)) {
  setSelectedDeviceId(lastDeviceId)
}

// On device selection
localStorage.setItem(STORAGE_KEY, deviceId)
```

**Rationale**: Users with multiple cameras (e.g., laptop + external) shouldn't need to reselect their preferred camera each time. localStorage is simple and persistent.

#### 4. File saving via existing patterns

The main process handles file I/O using the established pattern:

```typescript
// src/shared/ipc/camera-schema.ts
export const CameraSaveRequestSchema = z.object({
  imageData: z.string(),  // Base64-encoded JPEG
  filename: z.string().optional()  // Auto-generated if not provided
})

export const CameraSaveResponseSchema = z.object({
  success: z.boolean(),
  filePath: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.enum(['CAMERA_SAVE_FAILED']).optional()
})
```

```typescript
// src/main/ipc/camera-handlers.ts
ipcMain.handle('camera:save', async (_event, request) => {
  const { imageData, filename } = CameraSaveRequestSchema.parse(request)

  const buffer = Buffer.from(imageData, 'base64')
  const finalFilename = filename || `camera-${formatTimestamp()}.jpg`
  const filePath = join(tmpdir(), finalFilename)

  await writeFile(filePath, buffer)
  return { success: true, filePath }
})
```

#### 5. Permission handling strategy

```typescript
// useCameraCapture.ts
const requestCameraAccess = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: constraints })
    setPermissionState('granted')
    return stream
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        setPermissionState('denied')
        setError(getPlatformPermissionMessage())
      } else if (error.name === 'NotFoundError') {
        setError('No camera found')
      } else {
        setError(`Camera error: ${error.message}`)
      }
    }
    return null
  }
}

const getPlatformPermissionMessage = (): string => {
  const platform = window.api.utils.getPlatform()
  switch (platform) {
    case 'darwin':
      return 'Camera access denied. Open System Settings > Privacy & Security > Camera and enable access for Erfana.'
    case 'win32':
      return 'Camera access denied. Open Settings > Privacy > Camera and enable camera access for desktop apps.'
    default:
      return 'Camera not accessible. Ensure your camera is connected and drivers are installed.'
  }
}
```

#### 6. Device disconnection handling

```typescript
// Listen for device changes
useEffect(() => {
  const handleDeviceChange = async () => {
    const devices = await enumerateVideoDevices()
    setAvailableDevices(devices)

    // Check if current device is still available
    if (selectedDeviceId && !devices.some(d => d.deviceId === selectedDeviceId)) {
      setError('Camera disconnected')
      stopStream()
    }
  }

  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
  return () => {
    navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }
}, [selectedDeviceId])
```

### IPC contracts

#### camera:save

```typescript
// Request
{
  imageData: string  // Base64-encoded JPEG data
  filename?: string  // Optional filename (auto-generated if not provided)
}

// Response (success)
{
  success: true
  filePath: "/var/folders/.../camera-2026-01-20-143052.jpg"
}

// Response (error)
{
  success: false
  error: "Failed to write file"
  errorCode: "CAMERA_SAVE_FAILED"
}
```

### UI components

#### CameraDialog structure

```tsx
<BaseDialog
  isOpen={isOpen}
  onClose={handleClose}
  zIndex={10000}
  closeOnEscape={true}
  closeOnBackdrop={true}
  ariaLabelledBy="camera-dialog-title"
>
  <div className="camera-dialog">
    <div className="dialog-header-with-icon">
      <Camera size={20} />
      <h3 id="camera-dialog-title">Capture photo</h3>
    </div>

    <div className="camera-dialog-body">
      {/* Device selector */}
      {devices.length > 1 && (
        <select
          value={selectedDeviceId}
          onChange={handleDeviceChange}
          data-testid={TEST_IDS.CAMERA_DEVICE_SELECT}
        >
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      )}

      {/* Preview area */}
      <div className="camera-preview-container">
        {error ? (
          <div className="camera-error">
            <AlertCircle size={32} />
            <p>{error}</p>
            {!hasCamera && (
              <button onClick={handleRefresh}>Refresh</button>
            )}
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            data-testid={TEST_IDS.CAMERA_PREVIEW}
          />
        )}
      </div>
    </div>

    <div className="dialog-actions">
      <button
        className="dialog-btn dialog-btn-secondary"
        onClick={handleClose}
        data-testid={TEST_IDS.CAMERA_BTN_CANCEL}
      >
        Cancel
      </button>
      <button
        className="dialog-btn dialog-btn-primary"
        onClick={handleCapture}
        disabled={!isReady || capturing}
        data-testid={TEST_IDS.CAMERA_BTN_CAPTURE}
      >
        {capturing ? 'Capturing...' : 'Capture'}
      </button>
    </div>
  </div>
</BaseDialog>
```

#### Styling (design tokens)

```css
/* CameraDialog.css */
.camera-dialog {
  width: 720px;
  max-width: 90vw;
}

.camera-preview-container {
  width: 640px;
  min-height: 480px;
  background: var(--color-bg-secondary);
  border: var(--border-width) solid var(--color-border-default);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.camera-preview-container video {
  width: 100%;
  height: auto;
  object-fit: contain;
}

.camera-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-8);
  color: var(--color-text-secondary);
}

.camera-error svg {
  color: var(--color-error);
}
```

### Test IDs

```typescript
// Add to testids.ts
CAMERA_DIALOG: 'camera-dialog',
CAMERA_DEVICE_SELECT: 'camera-device-select',
CAMERA_PREVIEW: 'camera-preview',
CAMERA_BTN_CAPTURE: 'camera-btn-capture',
CAMERA_BTN_CANCEL: 'camera-btn-cancel',
CAMERA_BTN_REFRESH: 'camera-btn-refresh',
CAMERA_ERROR: 'camera-error',
TERMINAL_BTN_CAMERA: 'terminal-btn-camera',
```

## Consequences

### Positive

- **Cross-platform by default**: Web APIs work identically on all platforms
- **Simpler architecture**: No complex IPC for video streaming
- **Familiar patterns**: Reuses BaseDialog, hooks pattern, design tokens
- **Mature API**: `getUserMedia()` is well-documented with good browser support
- **Natural React integration**: Hooks manage stream lifecycle cleanly
- **Memory efficient**: Preview capped at 1080p per NFR-002

### Negative

- **Different pattern than ScreenshotService**: May confuse developers expecting consistency
- **Renderer has camera access**: Security consideration (mitigated by Electron permissions)
- **No native resolution capture**: Capped at preview resolution (1080p max)

### Neutral

- **LocalStorage for device persistence**: Simple but not synced across devices
- **JPEG-only**: Simpler but less flexible (PNG can be added later)
- **Base64 for IPC**: Standard approach, slight overhead for large images

## Migration considerations

This is a new feature with no existing code to migrate. However:

1. **Toolbar button placement**: Should follow existing screenshot button pattern
2. **Dialog patterns**: Must align with BaseDialog infrastructure
3. **IPC patterns**: Must follow Zod schema validation pattern
4. **Test patterns**: Must follow existing test coverage standards

## Enforcement

- **Code review**: Verify Web API usage follows best practices (stream cleanup)
- **TypeScript**: Strict types for all camera-related interfaces
- **Lint**: No direct DOM manipulation outside hooks
- **E2E tests**: Camera workflow with mock device (Playwright)

## References

- Spec #014 overview (archived)
- Spec #014 requirements (archived)
- Spec #014 acceptance criteria (archived)
- [MDN: MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MDN: MediaDevices.enumerateDevices()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
- [Electron: Media Permissions](https://www.electronjs.org/docs/latest/tutorial/security#15-handle-session-permission-requests-from-remote-content)
