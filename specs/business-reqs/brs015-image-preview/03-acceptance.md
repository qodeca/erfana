# BRS-015: Acceptance criteria

## Test cases

### AC-001: Open image from project tree
**Given** a project with image files
**When** user clicks on a PNG file in the project tree
**Then** a new tab opens with the image displayed
**And** the tab shows the filename

### AC-002: Open multiple image formats
**Given** a project with various image formats
**When** user opens PNG, JPG, GIF, WebP, SVG files
**Then** all formats display correctly in their respective tabs

### AC-003: Zoom in with button
**Given** an image open at 100% zoom
**When** user clicks the zoom in button
**Then** zoom increases to next level (125%)
**And** zoom indicator updates

### AC-004: Zoom out with button
**Given** an image open at 100% zoom
**When** user clicks the zoom out button
**Then** zoom decreases to previous level (75%)
**And** zoom indicator updates

### AC-005: Zoom with keyboard
**Given** an image tab is focused
**When** user presses + key
**Then** zoom increases
**When** user presses - key
**Then** zoom decreases
**When** user presses 0
**Then** zoom resets to 100%

### AC-006: Fit to container
**Given** an image larger than the container
**When** user clicks fit button or presses F
**Then** image scales to fit within container
**And** aspect ratio is preserved

### AC-007: Pan zoomed image
**Given** an image zoomed beyond container size
**When** user clicks and drags
**Then** image pans in drag direction
**And** cursor shows grab/grabbing states

### AC-008: Mouse wheel zoom
**Given** an image displayed in the viewer
**When** user scrolls mouse wheel up over the image
**Then** zoom increases centered on cursor position
**When** user scrolls down
**Then** zoom decreases

### AC-009: Full-screen mode
**Given** an image in the viewer
**When** user clicks full-screen button
**Then** image displays in full-screen modal
**And** toolbar is accessible at bottom
**When** user presses Escape
**Then** full-screen mode exits

### AC-010: Metadata display
**Given** an image file (1920×1080, 245KB, PNG)
**When** image opens in viewer
**Then** toolbar shows "1920×1080 · 245 KB · PNG"

### AC-011: Double-click toggle
**Given** an image at fit-to-container zoom
**When** user double-clicks the image
**Then** zoom changes to 100%
**When** user double-clicks again
**Then** zoom returns to fit-to-container

### AC-012: Loading state
**Given** user opens a large image
**When** image is loading
**Then** spinner displays in center
**When** loading completes
**Then** spinner disappears and image shows

### AC-013: Error state
**Given** a corrupted or invalid image file
**When** user attempts to open it
**Then** error message displays instead of image

### AC-014: Independent tab state
**Given** two image tabs open
**When** user zooms in on first image
**Then** second image zoom remains unchanged

### AC-015: Panel resize
**Given** an image in fit-to-container mode
**When** user resizes the panel
**Then** image re-fits to new container size

### AC-016: Keyboard accessibility
**Given** image viewer focused
**When** user navigates with Tab key
**Then** all toolbar buttons are reachable
**And** buttons have visible focus indicators

## Definition of done

- [ ] All functional requirements implemented
- [ ] All acceptance tests pass
- [ ] Unit tests for ImageViewerPanel component
- [ ] Unit tests for useImageViewerStore
- [ ] Manual testing of all supported image formats
- [ ] Keyboard navigation verified
- [ ] Performance tested with 20MB image
- [ ] Code reviewed
- [ ] Documentation updated (if needed)
