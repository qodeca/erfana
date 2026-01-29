# Requirements

## Functional requirements

### FR-001: Toolbar button

**Priority:** High

A camera icon button shall be added to the Terminal Panel toolbar, positioned near the existing screenshot button. The button shall use a recognizable camera icon (e.g., Lucide `Camera` icon) consistent with the application's icon style.

**Acceptance:** Button is visible in toolbar and clickable when terminal is active.

**Traces to:** AC-001

---

### FR-002: Camera dialog

**Priority:** High

Clicking the camera toolbar button shall open a modal dialog containing:
- Camera device selector dropdown (if multiple cameras available)
- Live video preview area
- "Capture" button to take photo
- "Cancel" button to close without capturing
- Status/error message area

The dialog shall be centered on screen with dimensions of 720x560 pixels (preview area 640x480 minimum). When the dialog is closed (via Cancel button, X button, or Escape key), the camera stream shall be stopped immediately to release the camera resource and respect user privacy.

**Acceptance:** Dialog opens on button click with all specified elements visible.

**Traces to:** AC-002

---

### FR-003: Device enumeration

**Priority:** High

The system shall enumerate all available video input devices using the MediaDevices API. The device list shall be displayed in a dropdown selector, showing device labels when available or generic names ("Camera 1", "Camera 2") when labels are not accessible.

**Acceptance:** All connected cameras appear in dropdown; default camera is pre-selected.

**Traces to:** AC-003

---

### FR-004: Live preview

**Priority:** High

The dialog shall display a live video feed from the currently selected camera. When the user switches cameras via the dropdown, the preview shall update to show the new camera's feed. The preview shall maintain aspect ratio and fit within the designated preview area.

**Acceptance:** Live video displays within 500ms of dialog open; camera switching works smoothly.

**Traces to:** AC-004

---

### FR-005: Photo capture

**Priority:** High

When the user clicks the "Capture" button, the system shall:
1. Capture the current video frame
2. Convert it to a standard image format (JPEG or PNG)
3. Trigger the file save process
4. Close the dialog upon successful save

A brief visual feedback (flash effect or shutter animation) should indicate capture occurred.

**Acceptance:** Capture produces a valid image file matching the preview content.

**Traces to:** AC-005

---

### FR-006: File saving

**Priority:** High

Captured photos shall be saved to the same location as screenshots (system temporary directory) with auto-generated filenames following the pattern: `camera-{timestamp}.{format}` (e.g., `camera-2026-01-20-143052.jpg`). The saved file path is inserted into terminal for immediate use. This mirrors the existing screenshot feature's behavior.

The save format shall be JPEG by default with configurable quality (default: 92%).

**Acceptance:** File is saved to expected location with correct filename and valid image content.

**Traces to:** AC-006

---

### FR-007: Path insertion

**Priority:** High

After successful photo capture and save, the absolute file path shall be automatically inserted at the terminal's current cursor position. The path shall be properly quoted if it contains spaces. This mirrors the existing screenshot feature's behavior.

**Acceptance:** File path appears in terminal input after capture; path is correct and usable.

**Traces to:** AC-007

---

### FR-008: Permission handling

**Priority:** High

On first camera access attempt, the system shall:
1. Request camera permission via Electron's permission handler
2. Display appropriate messaging if permission is denied
3. Provide platform-specific guidance on how to grant permission if initially denied
4. Remember permission grant for the session

Platform-specific permission guidance messages:
- **macOS**: "Camera access denied. Open System Preferences > Security & Privacy > Privacy > Camera and enable access for Erfana."
- **Windows**: "Camera access denied. Open Settings > Privacy > Camera and enable camera access for desktop apps."
- **Linux**: "Camera not accessible. Ensure your camera is connected and drivers are installed. Check system settings for camera permissions."

If camera permission is denied, the dialog shall display the appropriate error message and disable the capture functionality while still allowing the user to close the dialog.

**Acceptance:** Permission prompt appears on first use; denied permission shows platform-specific helpful error message.

**Traces to:** AC-008

---

### FR-009: No camera available handling

**Priority:** High

If no camera devices are detected when the user clicks the camera button, the system shall:
1. Display a clear error message: "No camera detected. Please connect a camera and try again."
2. Provide a "Refresh" button to re-scan for devices without closing the dialog
3. Disable the Capture button until a camera is detected

This ensures graceful degradation on systems without cameras or with disconnected cameras.

**Acceptance:** Error message displays on systems with no camera; Refresh button rescans for devices.

**Traces to:** AC-012

---

### FR-010: Device disconnection handling

**Priority:** Medium

If the active camera is disconnected while the dialog is open:
1. The preview shall stop and display an error message: "Camera disconnected"
2. The Capture button shall be disabled
3. The device dropdown shall be updated to reflect available devices
4. If other cameras are available, user can select an alternative
5. If no cameras remain, fall back to FR-009 behavior

**Acceptance:** Camera disconnection during preview shows error and updates UI appropriately.

**Traces to:** AC-015

---

### FR-011: Keyboard accessibility

**Priority:** High

The camera dialog shall be fully operable via keyboard:
1. Tab key navigates between all interactive elements (dropdown, Capture, Cancel)
2. Enter key activates the focused button or opens the dropdown
3. Escape key closes the dialog (equivalent to Cancel)
4. Arrow keys navigate dropdown options
5. Focus shall move to Capture button when dialog opens (with preview active)
6. Focus trap shall keep focus within the dialog while open

All controls shall have appropriate ARIA labels for screen reader compatibility.

**Acceptance:** All dialog functions accessible via keyboard; screen reader announces controls correctly.

**Traces to:** AC-014

---

## Non-functional requirements

### NFR-001: Cross-platform support

**Priority:** High

The camera capture feature shall work consistently on:
- macOS (10.15+)
- Windows (10/11)
- Linux (Ubuntu 20.04+, Fedora 35+)

Platform-specific differences in camera API behavior shall be handled gracefully with appropriate fallbacks or error messages.

**Acceptance:** Feature functions on all three platforms with no platform-specific crashes.

**Traces to:** AC-009

---

### NFR-002: Performance

**Priority:** Medium

Performance requirements:
- Camera preview shall achieve minimum 15 FPS
- Time from capture click to file saved shall be under 500ms
- Dialog open to first preview frame shall be under 500ms
- Memory usage during preview shall not exceed 100MB additional
- Preview resolution shall be constrained to maximum 1080p (1920x1080) to manage memory; full camera resolution used only for capture

**Acceptance:** Performance metrics meet or exceed specified thresholds.

**Traces to:** AC-010

---

### NFR-003: Resolution

**Priority:** Medium

Photos shall be captured at the camera's native resolution by default. If the native resolution exceeds 4K (3840x2160), the capture may be downscaled to 4K to manage file sizes. Users may configure preferred resolution in future iterations.

**Acceptance:** Captured image resolution matches camera capability (up to 4K limit).

**Traces to:** AC-011
