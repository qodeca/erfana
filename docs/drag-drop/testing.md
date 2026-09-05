# Testing strategy

> Where drag-drop behaviour is covered, and what is left to manual checks

[← Back to Drag-Drop Overview](./README.md)

## Automated coverage

All of the suites below are implemented and green. Counts were measured with
`npx vitest run <file>`; re-measure rather than trusting them if the code has
moved on.

| Suite | Tests | Covers |
|---|---|---|
| `src/main/services/FileService.moveItem.test.ts` | 20 | Basic move operations, validation constraints, rename during move, name-conflict handling, error handling, cross-filesystem (EXDEV) fallback, `replaceExisting` |
| `src/main/services/FileService.copyItem.test.ts` | 13 | Basic copy operations, auto-numbering for name conflicts, validation constraints, error handling, copy to the same location |
| `src/main/services/FileService.copyItem.limit.test.ts` | 2 | `MAX_COPY_ATTEMPTS` overflow guard |
| `src/renderer/src/hooks/useDragDropTree.test.ts` | 46 | `flattenTree` (incl. invariant guard and at-scale behaviour, #60), `buildTree`, `isDescendant`, `getProjection` (with and without the optional node index), the node index itself, flatten timing instrumentation, `canMoveItem` |
| `src/renderer/src/stores/useClipboardStore.test.ts` | 21 | `cut`, `copy`, `paste` (incl. the `replaceExisting` parameter), `clear`, `hasClipboard`, `getOperation` |
| `src/renderer/src/components/ProjectTree/ProjectTree.lookup.test.tsx` | 13 | Node lookup used by the tree's drag targets |

The overflow guard lives in its own file because its mocks hoist to module
scope; see the test-file split policy in
[`docs/windows/contributing.md`](../windows/contributing.md).

Run everything at once:

```bash
npx vitest run \
  src/main/services/FileService.moveItem.test.ts \
  src/main/services/FileService.copyItem.test.ts \
  src/main/services/FileService.copyItem.limit.test.ts \
  src/renderer/src/hooks/useDragDropTree.test.ts \
  src/renderer/src/stores/useClipboardStore.test.ts \
  src/renderer/src/components/ProjectTree/ProjectTree.lookup.test.tsx
```

## Gaps

- **No end-to-end drag-drop spec.** None of the 30 spec files in `e2e/` drives an
  actual drag gesture over the project tree, so the pointer-level interaction
  (folder highlight, drag overlay, result toasts) is only covered by the unit
  tests behind it. The scenarios below therefore stay manual.
- **Terminal drag-drop** (dropping paths into the terminal) is a separate
  feature with its own coverage in
  `src/renderer/src/components/Panels/TerminalPanel/hooks/useTerminalDragDrop.test.ts`
  – see [Terminal](../terminal/README.md).

## Manual test scenarios

**Drag-drop operations**:

1. Drag a file onto a folder (moves the file into the folder)
2. Drag a folder onto a folder (moves the folder into the folder)
3. Drag a folder into its own subfolder (shows an error)
4. Drag an item and drop it in the same location (does nothing)
5. Drag while the watcher is active (pauses and resumes correctly)
6. Drag a file to root level (horizontal drag left)
7. Drag a file to a nested level (horizontal drag right)

**Keyboard shortcuts**:

1. Select file, Ctrl+X, select folder, Ctrl+V (moves)
2. Select file, Ctrl+C, select folder, Ctrl+V twice (copies twice with numbering)
3. Select folder, Ctrl+X, select its parent, Ctrl+V (moves out)
4. No selection, Ctrl+X (does nothing)
5. Cut an item, change selection, Ctrl+V (pastes at the new location)

**Conflict resolution**:

1. Copy a file where the name already exists (auto-numbers)
2. Move a file where the name already exists (shows the confirm dialog)
3. Cancel the confirm dialog (aborts the operation)
4. Confirm overwrite (replaces the file)
5. Copy past the attempt limit (hits the overflow guard)

**Cross-platform**:

1. Move a file on the same volume (uses `fs.rename`)
2. Move a file across volumes (uses the copy + delete fallback)
3. Case-insensitive conflict (`README.md` vs `readme.md` on macOS)
