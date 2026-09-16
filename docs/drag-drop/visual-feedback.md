# Visual Feedback & UX Patterns

> CSS styling, visual indicators, and user feedback for drag-drop operations. The CSS below is quoted from the tokenised `ProjectTree.css` (design-system rules: `var(--color-*)` / `var(--space-*)` only, `border-radius: var(--border-radius)` = 0)

[← Back to Drag-Drop Overview](./README.md)

## Visual Feedback

### Drag States

**Dragging item** (opacity reduction):
```css
/* ProjectTree.css – "Dragging state" */
.project-tree-item[data-dragging="true"] {
  opacity: var(--opacity-disabled);
  cursor: grabbing !important;
}
```

**Drop target folder** (VS Code-style blue highlight):
```css
/* ProjectTree.css – "Highlight the folder row when it's a drop target" */
.project-tree-item[data-drop-target="true"].directory {
  background-color: var(--color-accent-drag-bg);
  border-radius: var(--border-radius);
  position: relative;
}
```

**Auto-expand highlight** (shown during the 1s countdown – there is no pulse keyframe; the `dropPulse` animation from the original design was never shipped):
```css
/* ProjectTree.css – "Folder highlighting during drag (auto-expand countdown)" */
.project-tree-node[data-drop-highlight="true"] > .project-tree-item.directory {
  background-color: var(--color-accent-drag-bg);
  border-radius: var(--border-radius);
}
```

**Children area highlight** (expanded folders):
```css
/* ProjectTree.css – "Highlight the children area for expanded folders" */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children {
  position: relative;
  background-color: var(--color-accent-drag-bg-subtle);
  border-radius: var(--border-radius);
}

/* Visual left border using pseudo-element (no layout shift) */
.project-tree-node[data-drop-highlight="true"] > .project-tree-children::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--border-width-thick);
  background-color: var(--color-accent-drag-border);
}
```

**Note**: The `::before` pseudo-element approach ensures the 2px border indicator doesn't cause layout shifts. Previous implementation used `border-left: 2px`, `margin-left: 8px`, `padding-left: 8px` which added 18px total and caused visible horizontal movement.

**Invalid drop** (red background):
```css
/* ProjectTree.css – "Invalid drop target" */
.project-tree-item[data-drop-invalid="true"] {
  background-color: var(--color-error-bg);
  border-radius: var(--border-radius);
  cursor: not-allowed;
}
```

**Cut item** (dimmed with dashed underline):
```css
/* ProjectTree.css – "Cut operation - dim item until paste" */
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
  height: var(--border-width);
  background: repeating-linear-gradient(
    90deg,
    var(--color-text-secondary),
    var(--color-text-secondary) 4px,
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

**Reference**: Commit `11d015a` (Nov 1, 2025) – pre-migration commit; it does not resolve in the public `qodeca/erfana` history, so treat it as provenance only. The `rgba(...)` / `4px` values in this before/after pair are the v0.3.6-era literals; the shipped rules now use the tokens quoted under § Drag States.

### Drag Overlay

Ghost element following the cursor during drag. It is rendered inline in `ProjectTree.tsx` as a dnd-kit `<DragOverlay dropAnimation={null}>` containing a `.drag-overlay` div with the dragged item's name (`DropIndicator.tsx` and `FolderDropHighlight.tsx` exist in the same folder but are rendered nowhere):

```css
/* ProjectTree.css – "Drag overlay (ghost element)" */
.drag-overlay {
  background: var(--color-bg-tertiary);
  border: var(--border-width) solid var(--color-accent-drag);
  border-radius: var(--border-radius);
  padding: var(--space-2) var(--space-4);
  box-shadow: var(--shadow-md);
  cursor: grabbing;
  opacity: 0.95;
  /* Allow elementFromPoint() to see through overlay to elements underneath (issue #85) */
  pointer-events: none;
}

.drag-overlay .file-name {
  color: var(--color-text-primary);
  font-weight: var(--font-medium);
}
```

### Auto-Scroll Behavior

Smooth scrolling when dragging near edges:

```typescript
// ProjectTree.tsx – startAutoScroll (constants from ProjectTree/constants.ts AUTO_SCROLL)
const startAutoScroll = (direction: 'up' | 'down') => {
  if (autoScrollIntervalRef.current) return // Already scrolling
  // ...
  autoScrollIntervalRef.current = window.setInterval(() => {
    const scrollAmount = direction === 'up' ? -AUTO_SCROLL.SCROLL_AMOUNT : AUTO_SCROLL.SCROLL_AMOUNT
    container.scrollTop += scrollAmount
  }, AUTO_SCROLL.SCROLL_INTERVAL) // ~60fps
}
```

**Parameters**:
- **Threshold**: 50px from top/bottom edge
- **Speed**: 5px per frame (~60fps = 300px/sec)
- **Activation**: Automatic when cursor enters threshold zone
- **Deactivation**: Stops when cursor leaves threshold zone

## Accessibility

### Operation feedback (toasts, not ARIA announcements)

There is **no** screen-reader announcer for drag-drop: no `announceToScreenReader` helper, no `#drag-drop-announcer` element and no `aria-live` region are rendered by `ProjectTree.tsx`. The only remnant of that design is an orphan `.drag-announcements` rule in `ProjectTree.css` that nothing references.

Feedback goes through the global toast service (`showGlobalToast` from `components/Toast/toastService`), from `ProjectTree.tsx` and the context-menu commands:

- "Cut" – `"<name>" ready to move` (keyboard cut and `CutCommand`)
- "Copied" – `"<name>" ready to paste` (keyboard copy and `CopyCommand`)
- "Success" – `Moved N file(s)` / `Copied N file(s)` after a drop, with `(N failed)` appended and a warning type when part of the batch failed
- "Symlink Moved" / "Symlink Copied" – info toast when the operated item was a symlink
- "Move failed" and other error toasts carry the `FileService` error message

### Keyboard Navigation

Keyboard support matching mouse operations:
- `Ctrl+X` / `Cmd+X` - Cut (toast "Cut")
- `Ctrl+C` / `Cmd+C` - Copy (toast "Copied")
- `Ctrl+V` / `Cmd+V` - Paste into the selected folder
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
- Same highlight held during the auto-expand countdown (no pulse animation ships)

### Auto-Expand
- 1 second hover delay before auto-expand
- Folder highlight indicates the countdown
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
| Drop target | Accent-drag background | `data-drop-target="true"` | Hovering over valid folder |
| Invalid drop | Red background, not-allowed cursor | `data-drop-invalid="true"` | Hovering over invalid location |
| Cut | 60% opacity, dashed underline | `data-clipboard-cut="true"` | Ctrl+X pressed |
| Auto-expand | Accent-drag background during the 1s countdown | `data-drop-highlight="true"` | Hovering over folder for 1s |
| Children highlight | Light blue background, left border | `data-drop-highlight="true"` | Folder expanded during drag |

## Related Files

- **CSS**: [src/renderer/src/components/ProjectTree/ProjectTree.css](../../src/renderer/src/components/ProjectTree/ProjectTree.css)
- **Drag Overlay**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](../../src/renderer/src/components/ProjectTree/ProjectTree.tsx) (inline `<DragOverlay>`; `DropIndicator.tsx` / `FolderDropHighlight.tsx` are unused)
- **Auto-Scroll**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](../../src/renderer/src/components/ProjectTree/ProjectTree.tsx) (`startAutoScroll`) and [constants.ts](../../src/renderer/src/components/ProjectTree/constants.ts) (`AUTO_SCROLL`)
- **Feedback toasts**: [src/renderer/src/components/ProjectTree/ProjectTree.tsx](../../src/renderer/src/components/ProjectTree/ProjectTree.tsx) and [context-menu/commands.tsx](../../src/renderer/src/components/ProjectTree/context-menu/commands.tsx)
