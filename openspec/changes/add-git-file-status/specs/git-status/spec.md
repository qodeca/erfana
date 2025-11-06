# Git Status Capability

## ADDED Requirements

### Requirement: Git Repository Detection
The system SHALL automatically detect if the opened project is a git repository by checking for a `.git` directory.

#### Scenario: Git repository detected
- **WHEN** user opens a project containing a `.git` directory
- **THEN** the system enables git status tracking
- **AND** git status indicators appear in the Project Tree

#### Scenario: Non-git project opened
- **WHEN** user opens a project without a `.git` directory
- **THEN** the system disables git status tracking
- **AND** no git indicators are displayed
- **AND** no errors are shown to the user

#### Scenario: Git disabled in settings
- **WHEN** user disables git status in settings
- **THEN** git status tracking stops
- **AND** all git indicators are removed from the UI
- **AND** no git operations are performed

### Requirement: File Status Tracking
The system SHALL track and report git status for individual files and directories within the repository.

#### Scenario: Modified file
- **WHEN** a tracked file is modified but not staged
- **THEN** the file displays a "modified" indicator (M) with orange/amber color
- **AND** the file's parent directories show a modified indicator

#### Scenario: Untracked file
- **WHEN** a new file is created and not added to git
- **THEN** the file displays an "untracked" indicator (U) with green color
- **AND** the file's parent directories show an untracked indicator

#### Scenario: Staged file
- **WHEN** a file is staged for commit (git add)
- **THEN** the file displays a "staged" indicator (A) with green color
- **AND** the file's parent directories show a staged indicator

#### Scenario: Deleted file
- **WHEN** a tracked file is deleted but not committed
- **THEN** the file displays a "deleted" indicator (D) with red color
- **AND** the file's parent directories show a deleted indicator

#### Scenario: Conflicted file
- **WHEN** a file has merge conflicts
- **THEN** the file displays a "conflict" indicator (C) with red/warning color
- **AND** the file's parent directories show a conflict indicator

#### Scenario: Ignored file
- **WHEN** a file matches .gitignore patterns
- **THEN** the file displays no git status (same as clean files)
- **AND** the file is treated as if git is disabled

### Requirement: Incremental Status Updates
The system SHALL update git status incrementally without blocking the UI or file operations.

#### Scenario: File modified while app is running
- **WHEN** a file is modified by an external editor or command
- **THEN** the git status updates within 2 seconds (default refresh interval)
- **AND** only the affected file's status is recalculated
- **AND** the UI remains responsive during the update

#### Scenario: Multiple files changed in bulk operation
- **WHEN** multiple files are modified simultaneously (e.g., git checkout)
- **THEN** git status updates are debounced (500ms)
- **AND** all affected files are updated in a single batch
- **AND** the UI remains responsive

#### Scenario: Project switch during git operation
- **WHEN** user switches projects while git status is loading
- **THEN** the ongoing git operation is cancelled
- **AND** a new git status check starts for the new project
- **AND** no stale status data is displayed

### Requirement: Git Library Integration
The system SHALL use isomorphic-git as the primary git library with simple-git as an optional fallback.

#### Scenario: Isomorphic-git available
- **WHEN** the application starts
- **THEN** isomorphic-git is loaded from node_modules
- **AND** git operations use isomorphic-git API
- **AND** no git CLI is required

#### Scenario: Simple-git fallback detection
- **WHEN** the system detects git CLI is available on PATH
- **THEN** the system uses simple-git for improved performance
- **AND** git operations delegate to git CLI commands
- **AND** isomorphic-git is not loaded

#### Scenario: Git CLI not available
- **WHEN** git CLI is not found on PATH
- **THEN** the system uses isomorphic-git exclusively
- **AND** all git operations work without external dependencies

### Requirement: Status Cache Management
The system SHALL cache git status per file to optimize performance and reduce redundant git operations.

#### Scenario: Cache hit for unchanged file
- **WHEN** git status is requested for a file with valid cache
- **THEN** the cached status is returned immediately
- **AND** no git operation is performed

#### Scenario: Cache invalidation on file change
- **WHEN** a file is modified (detected by file watcher)
- **THEN** the file's git status cache is invalidated
- **AND** the next status request triggers a fresh git check

#### Scenario: Cache invalidation on git operation
- **WHEN** a git command is executed (commit, add, reset)
- **THEN** all cached git statuses are invalidated
- **AND** the next tree refresh triggers fresh git checks

### Requirement: Error Handling and Graceful Degradation
The system SHALL handle git errors gracefully without affecting core file operations.

#### Scenario: Git repository corruption
- **WHEN** the .git directory is corrupted or inaccessible
- **THEN** git status is disabled for the project
- **AND** a warning message is logged to console
- **AND** file tree continues to work without git indicators

#### Scenario: Git operation timeout
- **WHEN** a git status check takes longer than 5 seconds
- **THEN** the operation is cancelled
- **AND** no git status is displayed for affected files
- **AND** a retry is attempted on next refresh cycle

#### Scenario: Submodule handling
- **WHEN** the project contains git submodules
- **THEN** each submodule's git status is tracked independently
- **AND** submodule directories show their own git status
- **AND** the parent repository status is displayed for submodule folders

### Requirement: Settings Configuration
The system SHALL provide user-configurable settings for git status behavior.

#### Scenario: Enable/disable git status
- **WHEN** user toggles git.enabled setting
- **THEN** git status tracking starts or stops immediately
- **AND** UI updates to show/hide git indicators
- **AND** the setting persists across application restarts

#### Scenario: Configure refresh interval
- **WHEN** user sets git.refreshInterval to a custom value (500-10000ms)
- **THEN** git status updates occur at the new interval
- **AND** the setting persists across application restarts
- **AND** invalid values (< 500ms or > 10000ms) are rejected with error message

#### Scenario: Reset to defaults
- **WHEN** user resets git settings to defaults
- **THEN** git.enabled is set to true
- **AND** git.refreshInterval is set to 2000ms
- **AND** the UI reflects the default configuration
