# Overview

## Summary

Camera photo capture enables users to take photos using their computer's built-in or external camera directly from the Terminal Panel toolbar. This feature complements the existing screenshot functionality by providing an alternative capture method for situations where a camera photo is more appropriate than a screen capture.

## Purpose

Users working in the terminal often need to quickly capture visual content for documentation, communication, or reference purposes. While the existing screenshot feature handles screen captures, there are scenarios where capturing a photo of physical objects, whiteboards, documents, or the user's environment is necessary. This feature eliminates the need to switch to external camera applications by integrating photo capture directly into the workflow.

### User scenarios

1. **Algorithm sketch capture**: A developer working on a complex algorithm sketches the solution on paper. They need to photograph the handwritten notes to transcribe into code or attach to documentation.

2. **Whiteboard meeting notes**: After a design meeting, a user photographs the whiteboard diagrams and requirements before they're erased, immediately having the file path available to commit to the project.

3. **Hardware documentation**: A developer debugging IoT hardware photographs the physical setup, wiring, or error LEDs to include in bug reports or documentation.

4. **Receipt/invoice capture**: A user photographs a physical receipt or invoice to attach to an expense report or project documentation.

## Scope

### In scope

- Camera icon button in Terminal Panel toolbar (alongside existing screenshot button)
- Modal dialog for camera interaction
- Camera device enumeration and selection (for systems with multiple cameras)
- Live video preview from selected camera
- Single-frame photo capture functionality
- Photo file saving to the same location as screenshots (system temporary directory)
- Automatic insertion of saved file path to terminal input
- Camera permission request and handling
- Cross-platform support for Windows, macOS, and Linux

### Out of scope

- Video recording (only single-frame photo capture)
- Image editing or post-processing
- Cloud upload or sharing functionality
- Camera settings adjustment (exposure, focus, white balance)
- Batch photo capture or timer/burst modes
- Webcam overlay or picture-in-picture during editing

## Key integration points

1. **Terminal Panel toolbar**: Button placement follows existing screenshot button pattern
2. **Dialog system**: Uses existing modal dialog infrastructure
3. **File system**: Integrates with FileService for saving captured photos
4. **Terminal input**: Uses existing path insertion mechanism (same as screenshot feature)

## Target platforms

| Platform | Camera API | Notes |
|----------|-----------|-------|
| macOS | navigator.mediaDevices.getUserMedia | Full support expected |
| Windows | navigator.mediaDevices.getUserMedia | Full support expected |
| Linux | navigator.mediaDevices.getUserMedia | Dependent on system camera drivers |

## Success criteria

1. Users can capture a photo within 3 clicks from terminal context
2. Camera preview displays with minimal latency (<500ms to first frame)
3. Captured photo path is immediately available in terminal for use in commands
4. Feature works consistently across all three supported platforms
5. No camera permission prompts after initial grant (per session)
