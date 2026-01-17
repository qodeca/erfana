# Acceptance criteria

## Test cases

### TC-001: External drag detection

**Traces to**: FR-001

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Open Finder and navigate to a file | File visible in Finder |
| 2 | Start dragging file from Finder | Drag operation begins |
| 3 | Drag file over Erfana project tree | Project tree activates drop zone styling |
| 4 | Observe DataTransfer event | `dataTransfer.files` contains dragged file info |

---

### TC-002: Visual drop indicators

**Traces to**: FR-002

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drag external file over project tree | Tree shows drop zone border |
| 2 | Hover over a folder | Folder highlights as valid target |
| 3 | Hover over a file | File shows invalid drop cursor |
| 4 | Move cursor away from tree | Drop indicators disappear |

---

### TC-003: Hover-to-expand collapsed folder

**Traces to**: FR-003

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Ensure a folder is collapsed | Folder shows collapse indicator |
| 2 | Drag external file over collapsed folder | Folder highlights |
| 3 | Hold hover for less than 1 second | Folder remains collapsed |
| 4 | Continue holding hover past 1 second | Folder expands showing contents |
| 5 | Drag into newly visible subfolder | Subfolder highlights as valid target |

---

### TC-004: Drop mode dialog appears

**Traces to**: FR-004

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drag external file over a folder | Folder highlights |
| 2 | Drop file on folder | Dialog appears |
| 3 | Observe dialog contents | Shows source path, target path |
| 4 | Observe dialog options | Move, Copy, Import buttons visible |
| 5 | Press Cancel | Dialog closes, no file operation |

---

### TC-005: Move operation success

**Traces to**: FR-005

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop external file on target folder | Dialog appears |
| 2 | Select "Move" | Operation begins |
| 3 | Wait for completion | Success notification shown |
| 4 | Check target folder in project tree | File appears in target |
| 5 | Check source location in Finder | File no longer exists at source |

---

### TC-006: Copy operation success

**Traces to**: FR-006

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop external file on target folder | Dialog appears |
| 2 | Select "Copy" | Operation begins |
| 3 | Wait for completion | Success notification shown |
| 4 | Check target folder in project tree | File appears in target |
| 5 | Check source location in Finder | File still exists at source |

---

### TC-007: Import operation launches

**Traces to**: FR-007

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop external PDF file on any folder | Dialog appears |
| 2 | Select "Import" | Import flow launches |
| 3 | Observe import dialog | PDF import options shown |
| 4 | Complete import | Markdown file created in `import/` directory |
| 5 | Check dropped-on folder | No file created there (import ignores drop target) |

---

### TC-008: Drop on file rejected

**Traces to**: FR-008

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drag external file over a file (not folder) | Cursor shows "not allowed" |
| 2 | Attempt to drop | Drop is rejected |
| 3 | No dialog appears | Operation cancelled silently |

---

### TC-009: Drop outside project rejected

**Traces to**: FR-008

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drag external file over empty area of tree | No valid target highlighted |
| 2 | Attempt to drop | Drop is rejected |
| 3 | No dialog appears | Operation cancelled |

---

### TC-010: Multiple file drop

**Traces to**: FR-009

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Select 3 files in Finder | Multiple files selected |
| 2 | Drag all 3 files to project tree folder | Folder highlights |
| 3 | Drop files | Dialog shows "3 files" count |
| 4 | Select "Copy" | All 3 files processed |
| 5 | Check target folder | All 3 files appear |

---

### TC-011: Conflict resolution - replace

**Traces to**: FR-010

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop file with name matching existing file | Drop mode dialog appears |
| 2 | Select "Copy" | Conflict dialog appears |
| 3 | Select "Replace" | Existing file overwritten |
| 4 | Verify file content | Contains new file content |

---

### TC-012: Conflict resolution - keep both

**Traces to**: FR-010

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop file named "test.md" where "test.md" exists | Drop mode dialog appears |
| 2 | Select "Copy" | Conflict dialog appears |
| 3 | Select "Keep both" | New file auto-renamed |
| 4 | Check target folder | Contains "test.md" and "test (1).md" |

---

### TC-013: Batch conflict resolution - per file

**Traces to**: FR-010

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop 3 files, 2 have conflicts | Drop mode dialog shows 3 files |
| 2 | Select "Copy" | First conflict dialog appears |
| 3 | Select "Replace" for first conflict | First file replaced |
| 4 | Second conflict dialog appears | User prompted for second file |
| 5 | Select "Keep both" for second conflict | Second file auto-renamed |
| 6 | Third file (no conflict) copies normally | All 3 files processed individually |

---

### TC-014: Performance - smooth drag feedback

**Traces to**: NFR-001

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Enable performance monitor | Frame timing visible |
| 2 | Drag external file rapidly across tree | Observe frame times |
| 3 | Move over multiple folders quickly | Drop indicators follow cursor |
| 4 | Check for frame drops | No frames exceed 16ms |

---

### TC-015: Keyboard alternative - folder selected

**Traces to**: NFR-002

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Select target folder in project tree | Folder selected |
| 2 | Press Cmd+Shift+I | File picker dialog opens |
| 3 | Select external file | File selected |
| 4 | Confirm selection | Drop mode dialog appears |
| 5 | Complete operation via keyboard | File added to folder |

---

### TC-015b: Keyboard shortcut - no folder selected

**Traces to**: NFR-002

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Ensure no folder is selected (select a file or deselect all) | No folder selection |
| 2 | Press Cmd+Shift+I | Nothing happens |
| 3 | No dialog appears | Shortcut silently ignored |

---

### TC-016: Error - source file deleted during drag

**Traces to**: NFR-003

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Start dragging file from Finder | Drag begins |
| 2 | Delete source file via another window | Source removed |
| 3 | Drop on target folder | Error dialog appears |
| 4 | Observe error message | "Source file not found" with path |

---

### TC-017: Error - permission denied

**Traces to**: NFR-003

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Make target folder read-only | Permissions restricted |
| 2 | Drop external file on folder | Operation attempted |
| 3 | Observe error | "Permission denied" error shown |
| 4 | Error includes suggestion | "Check folder permissions" hint |

---

### TC-018: Security - symlink validation

**Traces to**: NFR-004

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Create symlink to /etc/passwd | Symlink created |
| 2 | Drag symlink to project tree | Drag begins |
| 3 | Drop on target folder | Validation runs |
| 4 | Observe result | Operation rejected or symlink target validated |

---

### TC-019: Security - path traversal prevented

**Traces to**: NFR-004

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drop file with name "../../../etc/test.txt" | Drop attempted |
| 2 | Observe file name handling | Name sanitized to "test.txt" |
| 3 | Check file location | File only in target folder, no traversal |

---

### TC-020: Folder drop rejection

**Traces to**: FR-011

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Drag a folder from Finder to project tree | Cursor shows "not allowed" |
| 2 | Drop folder on valid target folder | Drop is ignored |
| 3 | No dialog appears | No feedback, no error toast |
| 4 | Target folder unchanged | No files added |

---

## Definition of done

- [ ] All functional requirements (FR-001 through FR-011) implemented
- [ ] All non-functional requirements (NFR-001 through NFR-004) addressed
- [ ] All test cases (TC-001 through TC-020, including TC-015b) pass
- [ ] Unit tests written for:
  - [ ] External drag detection logic
  - [ ] Drop target validation
  - [ ] Conflict resolution logic
  - [ ] File path sanitization
- [ ] Integration tests for:
  - [ ] Move operation end-to-end
  - [ ] Copy operation end-to-end
  - [ ] Import operation end-to-end
- [ ] Code reviewed and approved
- [ ] Documentation updated:
  - [ ] docs/drag-drop/README.md updated with external drop section
  - [ ] Keyboard shortcuts documented
- [ ] No regressions in existing internal drag-drop functionality
- [ ] Performance validated: no frame drops during drag operations
