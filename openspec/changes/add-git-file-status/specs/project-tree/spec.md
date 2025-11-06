# Project Tree Capability

## ADDED Requirements

### Requirement: Git Status Visualization
The Project Tree SHALL display visual indicators for git file status alongside existing file metadata (type, symlink, sensitive).

#### Scenario: Single status indicator per file
- **WHEN** a file has a git status (modified, untracked, staged, deleted, conflicted)
- **THEN** a single-letter indicator appears before the file name
- **AND** the indicator uses color-coding matching the status type
- **AND** the indicator does not affect existing icons (file type, symlink, sensitive)

#### Scenario: Directory status aggregation
- **WHEN** a directory contains files with git status
- **THEN** the directory shows an indicator matching the highest priority status
- **AND** priority order is: conflicted > deleted > staged > modified > untracked
- **AND** collapsed directories show aggregated status for all children

#### Scenario: Status color coding
- **WHEN** git status is displayed
- **THEN** modified files use orange/amber color (#F97316)
- **AND** untracked files use green color (#22C55E)
- **AND** staged files use green color (#22C55E)
- **AND** deleted files use red color (#EF4444)
- **AND** conflicted files use red/warning color (#DC2626)
- **AND** colors pass WCAG AA contrast requirements

### Requirement: Status Indicator Positioning
The Project Tree SHALL position git status indicators consistently without disrupting existing layout.

#### Scenario: Indicator placement before file name
- **WHEN** a file has git status
- **THEN** the status indicator appears immediately before the file name text
- **AND** the indicator is separated from the file name by 4px margin
- **AND** the indicator aligns vertically with the file name text
- **AND** existing icons (file type, symlink, sensitive) remain in their positions

#### Scenario: Multiple file attributes
- **WHEN** a file has git status AND is a symlink AND is sensitive
- **THEN** all indicators appear in order: [file icon] [git status] [symlink icon] [sensitive icon] [file name]
- **AND** each indicator maintains proper spacing
- **AND** the layout does not shift or jump when status changes

### Requirement: Status Hover Information
The Project Tree SHALL provide detailed git status information on hover.

#### Scenario: Hover on modified file
- **WHEN** user hovers over a file with "modified" status
- **THEN** a tooltip appears showing "Modified (not staged)"
- **AND** the tooltip appears after 500ms hover delay
- **AND** the tooltip disappears when mouse leaves

#### Scenario: Hover on directory with multiple statuses
- **WHEN** user hovers over a directory containing multiple git statuses
- **THEN** a tooltip shows count breakdown (e.g., "3 modified, 1 untracked")
- **AND** only non-zero counts are displayed
- **AND** counts update when child file statuses change

### Requirement: Performance Optimization
The Project Tree SHALL render git status indicators efficiently without blocking UI.

#### Scenario: Large directory rendering
- **WHEN** a directory contains 1000+ files with git status
- **THEN** the tree renders within 200ms
- **AND** git status indicators appear without visual lag
- **AND** scrolling remains smooth (60fps)

#### Scenario: Status update during interaction
- **WHEN** git status changes while user is interacting with the tree
- **THEN** status indicators update without interrupting user actions
- **AND** no visual flickering occurs
- **AND** drag-drop operations are not affected

### Requirement: Status Context Menu Integration
The Project Tree context menu SHALL include git-related actions for files with status.

#### Scenario: Context menu for modified file
- **WHEN** user right-clicks a modified file
- **THEN** context menu includes "Stage Changes" option
- **AND** selecting the option stages the file
- **AND** git status updates to "staged" after operation completes

#### Scenario: Context menu for untracked file
- **WHEN** user right-clicks an untracked file
- **THEN** context menu includes "Add to Git" option
- **AND** selecting the option stages the file
- **AND** git status updates to "staged" after operation completes

#### Scenario: Context menu for staged file
- **WHEN** user right-clicks a staged file
- **THEN** context menu includes "Unstage Changes" option
- **AND** selecting the option unstages the file
- **AND** git status updates to "modified" or "untracked" after operation completes

#### Scenario: Context menu for conflicted file
- **WHEN** user right-clicks a conflicted file
- **THEN** context menu includes "Resolve Conflict" option (disabled in v1)
- **AND** a tooltip explains conflict resolution is manual
- **AND** no automatic merge operations are performed

### Requirement: Accessibility
The Project Tree git status indicators SHALL be accessible to screen readers and keyboard users.

#### Scenario: Screen reader announcement
- **WHEN** a screen reader focuses on a file with git status
- **THEN** the status is announced (e.g., "modified", "untracked")
- **AND** the announcement comes after the file name
- **AND** the file type and other metadata are also announced

#### Scenario: Keyboard navigation with git status
- **WHEN** user navigates tree with keyboard
- **THEN** git status does not affect tab order
- **AND** Enter key on file opens it (existing behavior)
- **AND** Arrow keys navigate tree (existing behavior)
- **AND** git status is announced on focus

### Requirement: Integration with Existing Features
Git status indicators SHALL integrate seamlessly with existing Project Tree features.

#### Scenario: Drag-drop with git status
- **WHEN** user drags a file with git status
- **THEN** git status indicator is visible during drag
- **AND** drop operation completes normally
- **AND** git status updates after move/copy

#### Scenario: Cut/paste with git status
- **WHEN** user cuts a modified file
- **THEN** git status remains visible during cut state
- **AND** both cut styling and git indicator are displayed
- **AND** git status updates after paste operation

#### Scenario: Search/filter with git status
- **WHEN** user filters to markdown-only files
- **THEN** git status indicators remain visible on filtered files
- **AND** filtered-out files' git status is not lost
- **AND** git status reappears when filter is removed

### Requirement: Settings UI Integration
The Project Tree SHALL respect git status settings without requiring restart.

#### Scenario: Disable git status in running app
- **WHEN** user disables git.enabled setting
- **THEN** all git indicators disappear immediately
- **AND** context menu git options are hidden
- **AND** git status checks stop running

#### Scenario: Enable git status in running app
- **WHEN** user enables git.enabled setting
- **THEN** git status indicators appear within 2 seconds
- **AND** context menu git options become available
- **AND** git status checks start running

#### Scenario: Change refresh interval
- **WHEN** user changes git.refreshInterval setting
- **THEN** the new interval takes effect immediately
- **AND** git status updates occur at the new rate
- **AND** no duplicate status checks occur
