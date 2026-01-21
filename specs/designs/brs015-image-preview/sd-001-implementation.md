# BRS-015 Image Preview Viewer - Implementation Design

## Overview

This design document outlines the implementation approach for the Image Preview Viewer feature, which enables users to view image files directly within Erfana tabs with zoom, pan, and full-screen capabilities.

## Architecture

### Component Hierarchy

```
AppDockLayout.tsx
  |
  +-- editorComponents (registry)
  |     +-- editor: MarkdownEditorPanel
  |     +-- welcome: WelcomePanel
  |     +-- imageViewer: ImageViewerPanel  <-- NEW
  |
  +-- tabComponents (registry)
        +-- welcomeTab: WelcomeTab
        +-- editorTab: EditorTab
        +-- imageTab: ImageTab  <-- NEW
```

### New Files

| File | Purpose |
|------|---------|
| `src/renderer/src/components/Panels/ImageViewerPanel.tsx` | Main image viewer component |
| `src/renderer/src/components/Panels/ImageViewerPanel.module.css` | Component styles |
| `src/renderer/src/components/Panels/ImageViewerPanel.test.tsx` | Unit tests |
| `src/renderer/src/components/Panels/imageViewer.logic.ts` | Pure logic functions |
| `src/renderer/src/components/Panels/imageViewer.logic.test.ts` | Logic tests |
| `src/renderer/src/components/Tabs/ImageTab.tsx` | Tab header component |
| `src/renderer/src/components/Tabs/ImageTab.css` | Tab styles |
| `src/renderer/src/utils/imageUtils.ts` | Image format detection utility |
| `src/renderer/src/utils/imageUtils.test.ts` | Utility tests |

### Modified Files

| File | Change |
|------|--------|
| `src/renderer/src/components/DockLayout/AppDockLayout.tsx` | Register ImageViewerPanel and ImageTab |
| `src/renderer/src/components/Panels/ProjectPanel.tsx` | Add image file detection in handleFileSelect |
| `src/renderer/src/utils/fileUtils.ts` | Add `isImageFile()` function |
| `src/renderer/src/components/Tabs/index.ts` | Export ImageTab |

## Component Design

### ImageViewerPanel

**Props (via Dockview params):**
```typescript
interface ImageViewerPanelParams {
  filePath: string;    // Absolute path to image file
  panelId: string;     // Unique panel identifier
}
```

**Internal State:**
```typescript
interface ImageViewerState {
  // Image data
  imageUrl: string | null;        // data: URL or file: URL
  dimensions: { width: number; height: number } | null;
  fileSize: number;
  format: string;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Transform state (per-instance, not in store)
  transform: {
    scale: number;
    translateX: number;
    translateY: number;
  };

  // UI state
  isFitMode: boolean;             // True when "fit to container" is active
  isFullScreen: boolean;          // Full-screen modal open
}
```

**State Management Decision:**
- Transform state is LOCAL (useState) per panel instance
- No Zustand store needed (unlike DiagramViewer which needs cross-component updates)
- Rationale: Each image tab is independent; no need to sync state between components

### ImageTab

**Props (via Dockview):**
```typescript
interface ImageTabParams {
  filePath: string;
  panelId: string;
}
```

**Differences from EditorTab:**
- No dirty indicator (images are read-only)
- Image icon instead of file icon
- Simpler close logic (no save confirmation)
- Context menu: Close, Close Others, Close All (reuse useTabContextMenu)

### Logic Module (imageViewer.logic.ts)

**Reusable from diagramViewer.logic.ts:**
- `getKeyboardAction()` - keyboard shortcut mapping
- `getZoomButtonStates()` - disable states
- `formatZoomLevel()` - "100%" display
- `clampScale()` - bounds checking
- `ZOOM_CONFIG` - min/max/step values

**New functions:**
```typescript
// Zoom levels for stepped zoom (FR-004)
export const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// Get next zoom level (stepped)
export function getNextZoomLevel(current: number, direction: 'in' | 'out'): number;

// Calculate fit scale for container
export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number
): number;

// Calculate zoom centered on cursor position (FR-012)
export function calculateCursorCenteredZoom(
  currentTransform: Transform,
  cursorX: number,
  cursorY: number,
  containerRect: DOMRect,
  newScale: number
): Transform;

// Format file size (human-readable)
export function formatFileSize(bytes: number): string;

// Parse image format from extension/mime
export function getImageFormat(filePath: string): string;
```

### Image Utilities (imageUtils.ts)

```typescript
// Supported image extensions
export const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'
] as const;

// Check if file is an image
export function isImageFile(filePath: string): boolean;

// Get image metadata via main process
export async function getImageMetadata(filePath: string): Promise<{
  width: number;
  height: number;
  size: number;
  format: string;
}>;
```

## IPC Contracts

### New IPC Method: `file:getImageMetadata`

**Request:**
```typescript
{ filePath: string }
```

**Response:**
```typescript
{
  success: boolean;
  width?: number;
  height?: number;
  size?: number;
  format?: string;
  error?: string;
}
```

**Implementation:** FileService reads image dimensions using native Node.js `fs.stat` for size and simple header parsing for dimensions (or use existing image-size npm package if available).

### Image Loading Strategy

**Option A: data: URL (selected)**
- Read file as base64 via IPC
- Create `data:image/png;base64,...` URL
- Pros: Works in sandboxed renderer, no file:// protocol issues
- Cons: Large images load slower, memory usage

**Option B: file:// protocol**
- Construct `file://${filePath}` URL
- Requires protocol handling in Electron
- Not recommended due to CSP complications

## UI Layout

### Panel Layout
```
+----------------------------------------+
| Image content area                     |
| (centered, scrollable when zoomed)     |
+----------------------------------------+
| Toolbar:                               |
| [dim] [size] [fmt] | [-] 100% [+] [F] [fs] |
+----------------------------------------+
```

### Full-Screen Modal
```
+----------------------------------------+
|                               [X]       |
|                                         |
|           Image (centered)              |
|                                         |
+----------------------------------------+
| [-] 100% [+] [F] | dim x size x format |
+----------------------------------------+
```

## Implementation Sequence

### Phase 1: Core Infrastructure (Steps 1-4)
1. Create `imageUtils.ts` with `isImageFile()` and `IMAGE_EXTENSIONS`
2. Create `imageViewer.logic.ts` with zoom/pan logic
3. Add IPC handler for image metadata
4. Add IPC handler for reading image as base64

### Phase 2: Components (Steps 5-8)
5. Create `ImageViewerPanel.tsx` - basic structure with loading/error states
6. Create `ImageViewerPanel.module.css` - styles using design tokens
7. Create `ImageTab.tsx` - tab header with icon and close button
8. Create `ImageTab.css` - tab styles

### Phase 3: Integration (Steps 9-11)
9. Register components in `AppDockLayout.tsx`
10. Update `ProjectPanel.tsx` to detect images and open ImageViewerPanel
11. Export ImageTab from `Tabs/index.ts`

### Phase 4: Features (Steps 12-16)
12. Implement zoom controls (buttons, keyboard, wheel)
13. Implement pan (drag, arrow keys)
14. Implement fit-to-container with resize handling
15. Implement full-screen modal with focus trapping
16. Implement double-click toggle (fit <-> 100%)

### Phase 5: Polish (Steps 17-19)
17. Add loading spinner and error states
18. Add metadata display in toolbar
19. Write unit tests

## Zoom Implementation Details

### Discrete Zoom Levels (FR-004, FR-005)
```typescript
const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
```
- Button click/keyboard: Jump to next/prev level
- Wheel zoom: Continuous within bounds (0.1 to 4)

### Cursor-Centered Zoom (FR-012)
When zooming with wheel, zoom should center on cursor position:
```typescript
function calculateCursorCenteredZoom(
  currentTransform: Transform,
  cursorX: number,
  cursorY: number,
  containerRect: DOMRect,
  newScale: number
): Transform {
  const { scale, translateX, translateY } = currentTransform;

  // Cursor position relative to container center
  const cx = cursorX - containerRect.left - containerRect.width / 2;
  const cy = cursorY - containerRect.top - containerRect.height / 2;

  // Adjust translation to keep point under cursor stationary
  const scaleFactor = newScale / scale;
  const newTranslateX = cx - scaleFactor * (cx - translateX);
  const newTranslateY = cy - scaleFactor * (cy - translateY);

  return {
    scale: newScale,
    translateX: newTranslateX,
    translateY: newTranslateY
  };
}
```

## Accessibility

- All toolbar buttons have ARIA labels
- Keyboard navigation: Tab through buttons, +/-/0/F for zoom
- Focus trapping in full-screen mode
- `aria-live="polite"` on zoom indicator
- `role="img"` with `alt` attribute on image
- Reduced motion: Disable animations when `prefers-reduced-motion`

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Large images cause memory issues | Medium | Medium | Use native scaling, don't load full resolution for zoom <100% |
| SVG security (embedded scripts) | Low | High | Render SVG as `<img>` not `innerHTML`, CSP blocks scripts |
| Animated GIF performance | Low | Low | No special handling needed, browser handles natively |
| File:// protocol CSP issues | Medium | Medium | Use data: URLs instead |

## Test Strategy

### Unit Tests (imageViewer.logic.test.ts)
- `getNextZoomLevel()` - boundary cases
- `calculateFitScale()` - various aspect ratios
- `calculateCursorCenteredZoom()` - zoom centering math
- `formatFileSize()` - KB/MB formatting
- `getImageFormat()` - extension parsing

### Component Tests (ImageViewerPanel.test.tsx)
- Renders loading state
- Renders image when loaded
- Renders error state
- Zoom buttons update scale
- Keyboard shortcuts work
- Fit button calculates correct scale
- Full-screen modal opens/closes

### Integration Tests
- Click image in project tree opens ImageViewerPanel
- Multiple image tabs have independent state
- Tab close works without confirmation
- Panel resize triggers fit recalculation

### Coverage Target
- 80% line coverage
- Focus on logic module (100% coverage target)

## Patterns to Follow

1. **Functional components with hooks** (no class components)
2. **CSS modules** for component styles
3. **Design tokens** from `design-tokens.css`
4. **Test IDs** from `constants/testids.ts`
5. **Logger** from `utils/logger.ts`
6. **Error boundaries** for isolation

## Patterns to Avoid

1. **Global state** for per-panel data (use local state)
2. **Inline styles** (use CSS modules)
3. **Magic numbers** (use constants)
4. **innerHTML for SVG** (use `<img src>` for security)

## Verification Criteria

1. All supported formats (PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO) open correctly
2. Zoom controls work via buttons, keyboard, and wheel
3. Pan works via drag and arrow keys
4. Full-screen mode has focus trapping
5. Metadata displays correctly
6. Multiple tabs maintain independent state
7. Tab closes without save prompt
8. Panel resize recalculates fit
9. Tests pass with >80% coverage
10. Keyboard navigation works throughout
