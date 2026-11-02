# Troubleshooting & Performance

> Performance considerations, known limitations, and future enhancements

[← Back to Drag-Drop Overview](./README.md)

## Performance Considerations

### Tree Flattening
- **Memoized** inside `useDragDropTree` – a single `flattenInto` pass builds the flattened list and the path→node index together, recomputed only when `files` changes (after operations)
- The pass is timed (flatten timing instrumentation, covered in `useDragDropTree.test.ts`); measure on your own project rather than relying on a fixed figure

### Watcher Pause/Resume
- **Duration**: the pause lasts as long as the operation plus its tree refresh; a pause never resumed is ended by the 10 s safety timeout (`PAUSE_CONTROLLER.SAFETY_TIMEOUT_MS`)
- **Trade-off**: Prevents race conditions at cost of brief delay
- Alternative (no pause): Risk of stale data, ghost files, duplicate entries

### Drag Sensor Configuration
- **Activation distance**: `DRAG_DROP.ACTIVATION_DISTANCE` (5px, `ProjectTree/constants.ts`) – prevents accidental drags on click
- **Collision detection**: a custom `treeCollisionDetection` function in `ProjectTree.tsx`, passed to `DndContext` (not dnd-kit's `closestCenter`)

```typescript
// ProjectTree.tsx – sensor setup
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DROP.ACTIVATION_DISTANCE } })
)
```

## Implemented Enhancements (v0.6.5)

- **Auto-expand folders on hover** - Folders expand after 1 second hover during drag
- **Auto-scroll** - scrolling near the edges during a drag; since the tree was virtualised this is dnd-kit's own `DndContext` auto-scroll, driven by the live pointer (the `AUTO_SCROLL` constants in `ProjectTree/constants.ts` are no longer used)

## Known Limitations

1. **No undo/redo** - File operations are immediate and permanent
2. **Drag preview** - A custom dnd-kit `<DragOverlay>` ghost (`.drag-overlay`, the dragged item's name) follows the cursor; it is not further customisable (no icon, no multi-item count)
3. **No multi-select drag** - Can only drag one item at a time
4. **No drop between items** - Only drop into folders or at root level
5. **No drag reordering** - File order determined by alphabetical sort, not manual position

## Future Enhancements

1. **Undo/Redo System**
   - Track file operation history
   - Reverse operations (move back, delete copies)
   - Store original paths and timestamps

2. **Multi-Select Drag**
   - Shift+Click for range selection
   - Ctrl+Click for individual selection
   - Drag all selected items together

3. **Custom Drag Previews**
   - Show file icon + name in drag preview
   - Show count for multi-select ("3 items")
   - Semi-transparent overlay

4. **Drop Between Items**
   - Reorder files manually (override alphabetical sort)
   - Persist custom order in project settings
   - Visual indicator between items

5. **Progress Indicators**
   - Show progress bar for large folder copies
   - Cancelable operations
   - Background operation queue

