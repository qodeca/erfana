# Troubleshooting & Performance

> Performance considerations, known limitations, and future enhancements

[← Back to Drag-Drop Overview](./README.md)

## Performance Considerations

### Tree Flattening
- **Memoized** via `useMemo(() => flattenTree(files), [files])`
- Only recalculates when files array changes (after operations)
- Typical project (500 files) flattens in <5ms

### Watcher Pause/Resume
- **Duration**: Typically <100ms for small operations
- **Trade-off**: Prevents race conditions at cost of brief delay
- Alternative (no pause): Risk of stale data, ghost files, duplicate entries

### Drag Sensor Configuration
- **Activation distance**: 5px (prevents accidental drags on click)
- **Collision detection**: closestCenter (better performance than closestCorners)

```typescript
// ProjectTree.tsx:530-532
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
)
```

## Implemented Enhancements (v0.6.5)

- **Auto-expand folders on hover** - Folders expand after 1 second hover during drag
- **Auto-scroll** - 50px edge threshold with 60fps smooth scrolling during drag

## Known Limitations

1. **No undo/redo** - File operations are immediate and permanent
2. **No drag preview customization** - Uses default browser drag image
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

6. **Progress Indicators**
   - Show progress bar for large folder copies
   - Cancelable operations
   - Background operation queue

