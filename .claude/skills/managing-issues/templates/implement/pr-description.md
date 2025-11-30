# PR Description Template

Use this template for commit messages and pull request descriptions.

---

## Commit Message Format

```
<type>(<scope>): <description>

<body>

Closes #<issue-number>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code restructuring without behavior change
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (deps, configs)
- `perf`: Performance improvement
- `style`: Code style/formatting (no logic change)

### Scope (Optional)
Component or area affected:
- `editor`: Monaco editor components
- `terminal`: Terminal panel/services
- `tree`: Project tree components
- `tabs`: Tab management
- `ipc`: IPC handlers/services
- `ui`: General UI components

### Examples

```bash
# Feature
feat(tabs): add Chrome-style dynamic tab sizing

Implement dynamic tab sizing with min/max constraints,
dirty indicator, close button, and context menu.

- EditorTab component with IDockviewPanelHeaderProps
- Context menu (Close, Close Others, Close All)
- Middle-click to close support
- Relative path in tooltip

Closes #11

# Bug fix
fix(terminal): prevent scroll jumping during output

Add scroll position tracking using Buffer API.
Configure scrollOnUserInput: false to prevent auto-scroll.

Root cause: xterm.js default scroll behavior conflicts
with streaming CLI output.

Closes #42

# Refactor
refactor(tree): extract context menu to separate module

Apply Command pattern for menu actions.
Reduce ProjectTree.tsx complexity by 38%.

No behavior changes - pure code organization.

Closes #55
```

---

## Pull Request Description

### Title Format
```
<type>(<scope>): <brief description> (#<issue>)
```

### Body Template

```markdown
## Summary

<2-3 sentences describing what this PR does and why>

Closes #<issue-number>

## Changes

### Added
- <new feature/file>

### Modified
- `<file>`: <what changed>

### Removed
- <deprecated code/file>

## Testing

### Automated Tests
- [ ] Unit tests added/updated (<count> tests)
- [ ] Integration tests added/updated
- [ ] All tests passing (`npm test`)

### Manual Testing
- [ ] <scenario 1>
- [ ] <scenario 2>

### Quality Gates
- [ ] `npm run typecheck` - PASS
- [ ] `npm run lint` - PASS
- [ ] `npm test` - PASS

## Screenshots (if UI changes)

| Before | After |
|--------|-------|
| <screenshot> | <screenshot> |

## Notes

<Any additional context, trade-offs, or follow-up work>
```

---

## Examples

### Example 1: Feature PR

```markdown
## Summary

Add Chrome-style dynamic tab sizing to editor panels with dirty indicators,
context menu support, and relative path tooltips.

Closes #11

## Changes

### Added
- `EditorTab.tsx`: Custom tab component with IDockviewPanelHeaderProps
- `EditorTab.css`: Dynamic sizing styles (80-300px flex)
- `useTabContextMenu.tsx`: Context menu hook for tab actions
- `tabOperations.ts`: Pure utility functions for tab management

### Modified
- `ContextMenu.tsx`: Added disabled state support
- `AppDockLayout.tsx`: Registered EditorTab component

## Testing

### Automated Tests
- [x] Unit tests added (62 tests)
- [x] All tests passing

### Manual Testing
- [x] Tabs resize dynamically with file count
- [x] Dirty indicator shows for unsaved files
- [x] Close confirmation for dirty files
- [x] Context menu actions work correctly
- [x] Middle-click closes tabs

### Quality Gates
- [x] `npm run typecheck` - PASS
- [x] `npm run lint` - PASS
- [x] `npm test` - PASS (1392 tests)

## Screenshots

| Single Tab | Multiple Tabs | Context Menu |
|------------|---------------|--------------|
| <img> | <img> | <img> |

## Notes

Home/Welcome tab uses fixed 41px width (doesn't scale).
Future work: Tab reordering via drag-drop.
```

### Example 2: Bug Fix PR

```markdown
## Summary

Fix terminal scroll jumping to top during Claude CLI streaming output.
Root cause was xterm.js default scroll behavior.

Closes #826

## Changes

### Modified
- `TerminalPanel.tsx`: Added scroll position tracking via Buffer API
- `TerminalPanel.css`: Changed overflow-y from scroll to auto

## Testing

### Automated Tests
- [x] Unit tests added (6 tests)
- [x] All tests passing

### Manual Testing
- [x] Scrolled up during streaming - position maintained
- [x] New output appended without jumping
- [x] Manual scroll to bottom works

### Quality Gates
- [x] All checks passing

## Notes

Related issues: xterm.js #1413, #1426
```

---

## Checklist Before Submitting

- [ ] Commit message follows conventional format
- [ ] PR title matches commit format
- [ ] All acceptance criteria from issue met
- [ ] Tests added for new functionality
- [ ] Documentation updated if needed
- [ ] No unrelated changes included
- [ ] Screenshots added for UI changes
