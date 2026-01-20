# BRS-015: Requirements

## Functional requirements

### FR-001: Open images from project tree
Users can click on image files in the project tree to open them in a new tab. Supported formats: PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO.

### FR-002: Image tab display
Each opened image appears in its own tab with the filename displayed. The tab shows a distinctive icon indicating it's an image file.

### FR-003: Image rendering
Images are rendered in the panel with proper aspect ratio preservation. By default, images are scaled to fit the container while maintaining aspect ratio.

### FR-004: Zoom in functionality
Users can zoom in on images using:
- Toolbar zoom in button
- Keyboard shortcut (+/=)
- Mouse scroll wheel up
Zoom increments: 10%, 25%, 50%, 75%, 100%, 125%, 150%, 200%, 300%, 400%

### FR-005: Zoom out functionality
Users can zoom out using:
- Toolbar zoom out button
- Keyboard shortcut (-)
- Mouse scroll wheel down
Minimum zoom: 10%

### FR-006: Reset zoom
Users can reset zoom to 100% using:
- Clicking the zoom percentage display
- Keyboard shortcut (0)

### FR-007: Fit to container
Users can fit the image to the container using:
- Toolbar fit button
- Keyboard shortcut (F)
Image scales to fit within the visible area while maintaining aspect ratio.

### FR-008: Pan functionality
When an image is zoomed beyond the container size, users can pan using:
- Click and drag with mouse
- Arrow keys
Cursor changes to indicate pan capability (grab/grabbing).

### FR-009: Full-screen mode
Users can enter full-screen viewing mode using:
- Toolbar full-screen button
- The image displays in a modal overlay
- Escape key exits full-screen
- Toolbar remains accessible at bottom

### FR-010: Image metadata display
The toolbar displays:
- Image dimensions (width × height in pixels)
- File size (human-readable: KB, MB)
- Image format (PNG, JPG, etc.)

### FR-011: Zoom level indicator
The current zoom level is displayed as a percentage in the toolbar (e.g., "100%", "150%").

### FR-012: Mouse wheel zoom at cursor
When zooming with the mouse wheel, zoom centers on the cursor position, not the image center.

### FR-013: Double-click zoom toggle
Double-clicking the image toggles between fit-to-container and 100% zoom.

### FR-014: Loading state
While an image is loading, display a centered spinner. Show error state if loading fails.

### FR-015: Tab close behavior
Closing an image tab does not prompt for save (read-only view).

### FR-016: Multiple image tabs
Users can have multiple image tabs open simultaneously, each with independent zoom/pan state.

## Non-functional requirements

### NFR-001: Performance
Images up to 20MB must load within 2 seconds. Zoom and pan operations must be smooth (60fps).

### NFR-002: Memory management
Large images should not cause memory issues. Consider using native image scaling when possible.

### NFR-003: Accessibility
- All controls must be keyboard accessible
- Zoom buttons must have appropriate ARIA labels
- Focus must be trapped in full-screen mode
- Support reduced motion preference for animations

### NFR-004: Visual consistency
Use existing design tokens from design-tokens.css. Match the visual style of DiagramViewer toolbar.

### NFR-005: Responsive layout
Image viewer must work correctly when panel is resized. Fit-to-container recalculates on resize.
