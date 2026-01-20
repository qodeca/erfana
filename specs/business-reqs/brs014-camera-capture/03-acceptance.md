# Acceptance criteria

## Test cases

### AC-001: Toolbar button visibility and interaction

**Traces to:** FR-001

**Preconditions:**
- Application is running
- A project is open
- Terminal panel is visible

**Test steps:**
1. Observe the Terminal Panel toolbar
2. Locate the camera button (camera icon)
3. Hover over the button
4. Click the button

**Expected results:**
- Camera button is visible in toolbar near screenshot button
- Tooltip displays on hover (e.g., "Capture photo")
- Button click opens camera dialog
- Button has consistent styling with other toolbar buttons

---

### AC-002: Camera dialog structure

**Traces to:** FR-002

**Preconditions:**
- Camera button clicked
- At least one camera is connected

**Test steps:**
1. Observe dialog layout
2. Identify all UI elements
3. Check dialog positioning
4. Test Cancel button

**Expected results:**
- Dialog is centered on screen
- Camera selector dropdown is present
- Preview area is visible (minimum 640x480)
- "Capture" and "Cancel" buttons are present
- Cancel closes dialog without side effects
- Dialog blocks interaction with main window (modal)

---

### AC-003: Device enumeration

**Traces to:** FR-003

**Preconditions:**
- Multiple cameras connected (if testing multi-camera)
- Camera dialog is open

**Test steps:**
1. Open camera selector dropdown
2. Count listed devices
3. Compare with system device manager

**Expected results:**
- All connected cameras appear in dropdown
- Device labels are shown (or generic "Camera N" if unavailable)
- Default camera is pre-selected
- Dropdown is scrollable if many devices

---

### AC-004: Live preview functionality

**Traces to:** FR-004

**Preconditions:**
- Camera dialog is open
- Camera permission granted

**Test steps:**
1. Observe initial preview load time
2. Move object in front of camera
3. Switch to different camera (if available)
4. Observe preview update

**Expected results:**
- Preview appears within 500ms of dialog open
- Preview shows live feed (movement is visible)
- Camera switching updates preview within 1 second
- Aspect ratio is maintained (no stretching)

---

### AC-005: Photo capture execution

**Traces to:** FR-005

**Preconditions:**
- Camera dialog open with live preview
- Camera permission granted

**Test steps:**
1. Position recognizable object in frame
2. Click "Capture" button
3. Observe visual feedback
4. Check that dialog closes

**Expected results:**
- Visual feedback occurs (flash/animation)
- Capture completes within 500ms
- Dialog closes automatically after successful capture
- No error messages for successful capture

---

### AC-006: File saving

**Traces to:** FR-006

**Preconditions:**
- Photo captured via AC-005

**Test steps:**
1. Navigate to expected save location
2. Locate captured file
3. Verify filename format
4. Open and verify image content

**Expected results:**
- File exists at expected location
- Filename matches pattern: `camera-YYYY-MM-DD-HHMMSS.jpg`
- File is valid JPEG image
- Image content matches what was in preview at capture time
- Image resolution is appropriate (camera native up to 4K)

---

### AC-007: Terminal path insertion

**Traces to:** FR-007

**Preconditions:**
- Photo capture completed successfully
- Terminal panel is active

**Test steps:**
1. Observe terminal input after capture
2. Check inserted path
3. Verify path validity

**Expected results:**
- File path appears in terminal input
- Path is absolute
- Path is quoted if contains spaces
- Path points to actual saved file
- File at path can be opened/used

---

### AC-008: Permission handling

**Traces to:** FR-008

**Preconditions:**
- Camera permission not yet granted (fresh install or reset)

**Test steps:**
1. Click camera button for first time
2. Observe permission prompt
3. Deny permission
4. Observe error handling
5. Reset and grant permission
6. Verify functionality

**Expected results:**
- System permission prompt appears on first access
- Denied permission shows clear error message in dialog
- Error message includes guidance on granting permission
- Granted permission enables full functionality
- Subsequent uses don't prompt again (same session)

---

### AC-009: Cross-platform compatibility

**Traces to:** NFR-001

**Preconditions:**
- Application installed on target platform
- Camera connected and working at OS level

**Test steps (per platform: macOS, Windows, Linux):**
1. Launch application
2. Open camera dialog
3. Verify preview works
4. Capture and save photo
5. Verify path insertion

**Expected results:**
- All steps complete successfully on each platform
- No platform-specific crashes or hangs
- Consistent user experience across platforms
- Any platform limitations are communicated clearly

---

### AC-010: Performance benchmarks

**Traces to:** NFR-002

**Preconditions:**
- Application running
- Camera connected

**Test steps:**
1. Measure time from button click to first preview frame
2. Observe preview frame rate (visual smoothness)
3. Measure time from capture click to file saved
4. Monitor memory usage during extended preview

**Expected results:**
- Dialog open to preview: <500ms
- Preview frame rate: >=15 FPS (smooth motion)
- Capture to save: <500ms
- Memory increase during preview: <100MB

---

### AC-011: Resolution handling

**Traces to:** NFR-003

**Preconditions:**
- Camera with known resolution connected
- Photo captured

**Test steps:**
1. Note camera's native resolution (from specs/system info)
2. Capture photo
3. Check captured image dimensions

**Expected results:**
- Image dimensions match camera native resolution
- If native >4K, image is downscaled to 4K maximum
- Image quality is acceptable (no excessive compression artifacts)

---

### AC-012: No camera available

**Traces to:** FR-009

**Preconditions:**
- System has no camera connected, or all cameras are disabled
- Application is running

**Test steps:**
1. Disconnect or disable all cameras
2. Click the camera button in Terminal Panel toolbar
3. Observe the dialog content
4. Connect a camera
5. Click the "Refresh" button
6. Observe the dialog update

**Expected results:**
- Dialog opens but shows error message: "No camera detected. Please connect a camera and try again."
- Capture button is disabled
- Refresh button is visible and clickable
- After connecting camera and clicking Refresh, camera appears in dropdown
- Preview starts after selecting the newly connected camera

---

### AC-013: Permission denied recovery

**Traces to:** FR-008

**Preconditions:**
- Camera permission was previously denied
- Application is running on each target platform

**Test steps:**
1. Open camera dialog after permission denial
2. Observe error message content
3. Verify platform-specific guidance is displayed
4. Follow guidance to grant permission in system settings
5. Return to app and retry

**Expected results:**
- macOS: Message includes "System Preferences > Security & Privacy > Privacy > Camera"
- Windows: Message includes "Settings > Privacy > Camera"
- Linux: Message includes guidance about camera drivers and system settings
- After granting permission externally, re-opening dialog allows camera access

---

### AC-014: Keyboard accessibility

**Traces to:** FR-011

**Preconditions:**
- Camera dialog is open
- Camera is connected and permission granted

**Test steps:**
1. Note initial focus position when dialog opens
2. Press Tab repeatedly to cycle through all controls
3. Press Escape to close dialog
4. Re-open dialog
5. Use Enter to activate Capture button
6. Use arrow keys to navigate dropdown (if multiple cameras)

**Expected results:**
- Focus starts on Capture button when preview is active
- Tab cycles through: Capture → Cancel → Device dropdown (and loops)
- Escape closes dialog without capturing
- Enter on Capture button takes photo
- Arrow keys navigate dropdown options
- Focus never leaves dialog while open (focus trap)
- Screen reader announces all controls with meaningful labels

---

### AC-015: Camera hot-plug handling

**Traces to:** FR-010

**Preconditions:**
- Camera dialog is open with live preview
- Camera is connected via USB (removable)

**Test steps:**
1. Open dialog with camera preview active
2. Physically disconnect the active camera
3. Observe preview area and controls
4. Connect a different camera (or same camera)
5. Use Refresh or dropdown to select new camera

**Expected results:**
- Preview stops immediately on disconnect
- Error message displays: "Camera disconnected"
- Capture button becomes disabled
- Device dropdown updates to show remaining cameras (or empty)
- Connecting new camera and refreshing/selecting shows new camera
- New camera preview starts successfully

---

## Definition of done

- [ ] All functional requirements (FR-001 through FR-011) implemented
- [ ] All non-functional requirements (NFR-001 through NFR-003) met
- [ ] All acceptance criteria (AC-001 through AC-015) pass
- [ ] Code follows existing project patterns (see ScreenshotService for reference)
- [ ] TypeScript types properly defined
- [ ] No ESLint errors or warnings
- [ ] Unit tests written for service layer
- [ ] E2E tests written for happy path (camera capture workflow)
- [ ] Accessibility testing completed (keyboard navigation, screen reader)
- [ ] Performance profiling completed (verify NFR-002 metrics)
- [ ] Manual testing completed on macOS, Windows, and Linux
- [ ] Code reviewed and approved
- [ ] Documentation updated (if needed)
- [ ] Feature flag or configuration option available (if needed for staged rollout)
