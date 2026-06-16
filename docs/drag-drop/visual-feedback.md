# Visual Feedback & UX Patterns

> CSS styling, visual indicators, and accessibility for drag-drop operations

[← Back to Drag-Drop Overview](./README.md)

## Visual Feedback

### Drag States

**Dragging item** (opacity reduction):
```css
/* ProjectTree.css:292-295 */
.project-tree-item[data-dragging="true"] {
  opacity: 0.4;
  cursor: grabbing !important;
}
```

**Drop target folder** (VS Code-style blue highlight):
```css
/* ProjectTree.css:308-312 */
.project-tree-item[data-drop-target="true"].directory {
  background-color: rgba(79, 193, 255, 0.2);
  border-radius: 4px;
  position: relative;
}
```

**Auto-expand pulse animation** (indicates 1s countdown):
```css
/* ProjectTree.css:315-319 */
.project-tree-node[data-drop-highlight="true"] > .project-tree-item.directory {
  background-color: rgba(79, 193, 255, 0.2);
  border-radius: 4px;
  animation: dropPulse 1s ease-in-out;
}

@keyframes dropPulse {
  0%, 100% { background-color: rgba(79, 193, 255, 0.2); }
  50% { background-color: rgba(79, 193, 255, 0.3); }
}
```

**Children area highlight** (expanded folders):
```css
/* ProjectTree.css:331-346 */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children {
  position: relative;
  background-color: rgba(79, 193, 255, 0.05);
  border-radius: 0 0 4px 0;
}

/* Visual left border using pseudo-element (no layout shift) */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background-color: rgba(79, 193, 255, 0.3);
}
```

**Note**: The `::before` pseudo-element approach ensures the 2px border indicator doesn't cause layout shifts. Previous implementation used `border-left: 2px`, `margin-left: 8px`, `padding-left: 8px` which added 18px total and caused visible horizontal movement.

**Invalid drop** (red background):
```css
/* ProjectTree.css:349-352 */
.project-tree-item[data-drop-invalid="true"] {
  background-color: rgba(244, 135, 113, 0.2);
  border-radius: 4px;
  cursor: not-allowed;
}
```

**Cut item** (dimmed with dashed underline):
```css
/* ProjectTree.css:347-366 */
.project-tree-item[data-clipboard-cut="true"] {
  opacity: 0.6;
  position: relative;
}

.project-tree-item[data-clipboard-cut="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: repeating-linear-gradient(
    90deg,
    #858585,
    #858585 4px,
    transparent 4px,
    transparent 8px
  );
}
```

### CSS Layout Shift Fix (v0.3.6)

**Problem**: File/folder names shifted 18px to the right when dragging items over folders.

**Root Cause**: CSS properties on `.project-tree-children` drop highlight:
- `border-left: 2px solid` (2px)
- `margin-left: 8px` (8px)
- `padding-left: 8px` (8px)
- Total: 18px added to layout

**Solution**: Replaced layout-affecting properties with absolutely positioned `::before` pseudo-element:

```css
/* Before (caused layout shift): */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children {
  background-color: rgba(79, 193, 255, 0.05);
  border-left: 2px solid rgba(79, 193, 255, 0.3);
  margin-left: 8px;
  padding-left: 8px;
  border-radius: 0 0 4px 0;
}

/* After (no layout shift): */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children {
  position: relative;
  background-color: rgba(79, 193, 255, 0.05);
  border-radius: 0 0 4px 0;
}

.project-tree-node[data-drop-highlight="true"] > .project-tree-children::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background-color: rgba(79, 193, 255, 0.3);
}
```

**Result**:
- Visual feedback preserved (blue background + left border)
- Zero layout shifts or horizontal movement
- Common CSS technique for overlays that don't affect layout flow

**Reference**: Commit `11d015a` (Nov 1, 2025)

### Drag Overlay

Ghost element following cursor during drag:

```css
/* ProjectTree.css:369-382 */
.drag-overlay {
  background: #252526;
  border: 1px solid #4fc1ff;
  border-radius: 4px;
  padding: 4px 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  cursor: grabbing;
  opacity: 0.95;
}

.drag-overlay .file-name {
  color: #cccccc;
  font-weight: 500;
}
```

### Auto-Scroll Behavior

Smooth scrolling when dragging near edges:

```typescript
// ProjectTree.tsx:177-188
const startAutoScroll = (direction: 'up' | 'down') => {
  if (autoScrollIntervalRef.current) return
  const container = treeContainerRef.current
  if (!container) return

  autoScrollIntervalRef.current = window.setInterval(() => {
    const scrollAmount = direction === 'up' ? -5 : 5
    container.scrollTop += scrollAmount
  }, 16) // ~60fps
}
```

**Parameters**:
- **Threshold**: 50px from top/bottom edge
- **Speed**: 5px per frame (~60fps = 300px/sec)
- **Activation**: Automatic when cursor enters threshold zone
- **Deactivation**: Stops when cursor leaves threshold zone

## Accessibility

### ARIA Live Announcements

Screen reader announcements for all operations:

```typescript
// ProjectTree.tsx:48-57
const announceToScreenReader = (message: string) => {
  const liveRegion = document.getElementById('drag-drop-announcer')
  if (liveRegion) {
    liveRegion.textContent = '' // Clear first to force re-announcement
    setTimeout(() => {
      liveRegion.textContent = message
    }, 100)
  }
}
```

**Announcements**:
- "Dragging [filename]" on drag start
- "Moved [filename] to [folder]" on successful drop
- "Cut [filename]" on keyboard cut
- "Copied [filename]" on keyboard copy
- "Pasted [filename] into [folder]" on paste
- "Invalid drop: cannot move folder into itself" on validation failure

### ARIA Live Region

```typescript
// ProjectTree.tsx (in render):
<div
  id="drag-drop-announcer"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px' }}
/>
```

**Why off-screen?** Visually hidden but accessible to screen readers.

### Keyboard Navigation

Full keyboard support matching mouse operations:
- `Ctrl+X` / `Cmd+X` - Cut (announces "Cut [filename]")
- `Ctrl+C` / `Cmd+C` - Copy (announces "Copied [filename]")
- `Ctrl+V` / `Cmd+V` - Paste (announces "Pasted [filename] into [folder]")
- `Escape` - Cancel drag or close dialog

See [clipboard.md](./clipboard.md) for keyboard shortcut details.

### Focus Management

Focus handling during operations:
- Focus remains on dragged item during drag
- Focus moves to destination folder after successful drop
- Focus returns to original item on cancel
- Dialog focus trapped during confirmation

## VS Code UX Patterns

Implementation matches VS Code Explorer behavior:

### Root Folder Node
- Project root appears as first collapsible tree item
- Always-visible drop target for moving items to root
- All files/folders are children of root
- Matches VS Code Explorer panel exactly

### Folder Highlighting
- Background highlight on entire folder row (not just outline)
- Expanded folders highlight children area too
- Blue color scheme matching VS Code's accent color
- Subtle pulse during auto-expand countdown

### Auto-Expand
- 1 second hover delay before auto-expand
- Pulse animation indicates countdown
- Prevents accidental expansions on quick drags
- Matches VS Code timing

### Auto-Scroll
- 50px threshold from edges
- Smooth scrolling at 60fps
- Works during both mouse drag and keyboard operations

## Visual States Summary

| State | Visual Indicator | CSS Class | User Action |
|-------|-----------------|-----------|-------------|
| Dragging | 40% opacity, grabbing cursor | `data-dragging="true"` | Drag started |
| Drop target | Blue background, pulse animation | `data-drop-target="true"` | Hovering over valid folder |
| Invalid drop | Red background, not-allowed cursor | `data-drop-invalid="true"` | Hovering over invalid location |
| Cut | 60% opacity, dashed underline | `data-clipboard-cut="true"` | Ctrl+X pressed |
| Auto-expand | Pulse animation (1s) | `data-drop-highlight="true"` | Hovering over folder for 1s |
| Children highlight | Light blue background, left border | `data-drop-highlight="true"` | Folder expanded during drag |

## Related Files

- **CSS**: [src/renderer/src/components/ProjectTree/ProjectTree.css](/src/renderer/src/components/ProjectTree/ProjectTree.css)
- **Drag Overlay**: [src/renderer/src/components/ProjectTree/DropIndicator.tsx](/src/renderer/src/components/ProjectTree/DropIndicator.tsx)
- **Auto-Scroll**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](/src/renderer/src/components/ProjectTree/ProjectTree.tsx) (lines 177-188)
- **Accessibility**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](/src/renderer/src/components/ProjectTree/ProjectTree.tsx) (ARIA live region)
