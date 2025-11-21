# Recent Projects Feature - TODO List

## Status Summary

**Overall Assessment:** 72/100 → 85/100 → 90/100 → 92/100 → 95/100 (after P1 error handling)
**Priority Status:** P0 testing items (todo001-006) must be completed before merge to main

**Completed:**
- ✅ todo007-013 (performance, security, reliability fixes)
- ✅ todo014-017 (SOLID refactoring: extracted 4 service classes)
- ✅ todo018-020 (React improvements: useEffect deps, unmounted state, unified loading)
- ✅ todo021-024 (Error handling: standardized types, error codes, user messages, feedback)

**Legend:**
- 🔴 P0 - Critical (Must Fix Before Merge)
- 🟠 P1 - High Priority (Should Fix)
- 🟡 P2 - Medium Priority (Nice to Have)
- 🔵 P3 - Low Priority (Future)

---

## 🔴 P0 - Critical (Must Fix Before Merge)

### Testing (170+ tests required)

#### todo001: Create pathSecurity.test.ts with comprehensive test coverage
**Priority:** P0
**File:** `src/main/utils/pathSecurity.test.ts` (NEW)
**Estimated Effort:** 1 day
**Description:**
- Minimum 50 test cases covering all validation scenarios
- Test groups:
  - Input validation (5 tests)
  - Absolute path requirement (5 tests)
  - Path traversal protection (10 tests)
  - System directory protection (10 tests)
  - Sensitive directory protection (5 tests)
  - Access permissions (5 tests)
  - Symlink validation (10 tests)

**Test Cases to Write:**
```typescript
describe('validateProjectPath')
  - should reject empty string
  - should reject null/undefined
  - should reject relative paths (./foo, ../foo, foo/bar)
  - should block /Users/foo/../../etc
  - should block /Users/../../../etc
  - should block encoded traversal (%2e%2e%2f)
  - should block /System, /usr, /etc
  - should block subdirectories (/usr/local)
  - should block ~/.ssh, ~/.gnupg, ~/.aws
  - should reject non-existent paths
  - should reject paths without R+X permissions
  - should accept valid absolute paths

describe('validateSymlink')
  - should return false for regular files/directories
  - should detect symlinks correctly
  - should block symlinks to /etc, ~/.ssh
  - should handle broken symlinks gracefully
  - should handle circular symlinks
  - should handle absolute vs relative symlink targets

describe('isSystemDirectory')
  - should detect exact matches
  - should detect subdirectories
  - should be case-sensitive on Linux
  - should handle trailing slashes
```

---

#### todo002: Create SettingsService.recentProjects.test.ts
**Priority:** P0
**File:** `src/main/services/SettingsService.test.ts` (extend existing or NEW)
**Estimated Effort:** 1 day
**Description:**
- Minimum 40 test cases
- Focus on race conditions, concurrency, clock skew

**Test Cases to Write:**
```typescript
describe('addRecentProject')
  - should add a new project
  - should limit to 5 projects (FIFO)
  - should maintain timestamp order
  - should update timestamp on re-add
  - should prevent duplicate paths
  - should handle case-insensitive duplicates (macOS)
  - should handle symlink duplicates
  - should ensure monotonic timestamps
  - should handle Date.now() returning same value
  - should handle clock going backwards
  - should handle parallel addRecentProject calls
  - should handle parallel add + remove calls
  - should not lose updates under load
  - should throw SettingsServiceError on store failure
  - should release mutex on error
  - should handle realpathSync failures

describe('removeRecentProject')
  - should remove existing project
  - should handle non-existent project gracefully
  - should use canonical comparison
  - should handle concurrent removes

describe('getRecentProjects')
  - should return empty array initially
  - should return projects in timestamp order
  - should not mutate internal state

describe('clearRecentProjects')
  - should clear all projects
  - should return empty array after clear
```

---

#### todo003: Create file-handlers.openProjectByPath.test.ts
**Priority:** P0
**File:** `src/main/ipc/file-handlers.test.ts` (extend existing or NEW)
**Estimated Effort:** 0.5 day
**Description:**
- Minimum 30 test cases
- Focus on validation, state management, error handling

**Test Cases to Write:**
```typescript
describe('openProjectByPath')
  - should validate path before operations
  - should reject empty path
  - should trim whitespace
  - should reject system directories
  - should return immediately if same path
  - should use canonical comparison
  - should update all services (file, fileWatcher, directoryWatcher)
  - should persist to settingsService
  - should add to recent projects
  - should broadcast project:changed event
  - should rollback on validation failure
  - should rollback on stat failure
  - should rollback on settings failure
  - should stop watchers before switching
  - should continue on watcher stop failure

describe('file:openProjectByPath IPC handler')
  - should validate input type
  - should trim whitespace from input
  - should propagate errors to renderer
  - should return project path on success
```

---

#### todo004: Create UIBlocker.test.tsx
**Priority:** P0
**File:** `src/renderer/src/components/UIBlocker/UIBlocker.test.tsx` (NEW)
**Estimated Effort:** 0.25 day
**Description:**
- Minimum 15 test cases
- Focus on visibility, event blocking, styling

**Test Cases to Write:**
```typescript
describe('UIBlocker')
  describe('Visibility')
    - should render when isProjectChanging is true
    - should not render when isProjectChanging is false
    - should update when store changes

  describe('Event Blocking')
    - should prevent onClick
    - should prevent onContextMenu
    - should prevent onDoubleClick
    - should prevent onMouseDown
    - should prevent keyboard events
    - should prevent wheel events

  describe('Styling')
    - should have z-index 9999
    - should cover entire viewport
    - should show spinner animation
    - should show "Waiting for folder selection..." message
```

---

#### todo005: Create WelcomePanel.test.tsx
**Priority:** P0
**File:** `src/renderer/src/components/Panels/WelcomePanel.test.tsx` (NEW)
**Estimated Effort:** 1 day
**Description:**
- Minimum 35 test cases
- Focus on loading, display, interactions, error handling

**Test Cases to Write:**
```typescript
describe('WelcomePanel')
  describe('Loading State')
    - should show loading initially
    - should call getRecentProjects on mount
    - should hide loading after data loads

  describe('Recent Projects Display')
    - should render empty state when no projects
    - should render projects list
    - should show project name, path, time
    - should limit to 5 projects
    - should sort by timestamp descending

  describe('Project Opening')
    - should call openProjectByPath on click
    - should show "Opening..." indicator
    - should disable item while opening
    - should remove stale project on ENOENT
    - should show error toast on failure
    - should prevent click when isProjectChanging

  describe('Project Removal')
    - should call removeRecentProject on X click
    - should reload list after removal
    - should show success toast
    - should stop propagation to parent
    - should prevent removal when isProjectChanging

  describe('Time Formatting')
    - should show "Just now" for < 1 minute
    - should show "X minutes ago" for < 1 hour
    - should show "X hours ago" for < 24 hours
    - should show "X days ago" for < 7 days
    - should show date for older projects

  describe('UI Blocking')
    - should disable all items when isProjectChanging
    - should show not-allowed cursor
    - should show "Waiting" tooltip
    - should reduce opacity to 0.6

  describe('Error Handling')
    - should show toast on getRecentProjects failure
    - should show toast on removeRecentProject failure
```

---

#### todo006: Create integration tests for recent projects flow
**Priority:** P0
**File:** `src/renderer/src/components/Panels/WelcomePanel.integration.test.tsx` (NEW)
**Estimated Effort:** 0.5 day
**Description:**
- End-to-end scenarios with real IPC mocks

**Test Scenarios:**
```typescript
describe('Recent Projects Integration')
  - should open project and update recent list
  - should handle rapid project switches without corruption
  - should remove non-existent projects automatically
  - should block UI during folder dialog
  - should handle concurrent add + remove operations
  - should maintain max 5 projects after multiple operations
  - should update timestamps correctly on re-open
  - should handle symlink and case-insensitive duplicates
```

---

## 🟠 P1 - High Priority (Should Fix)

## 🟡 P2 - Medium Priority (Nice to Have)

### Code Quality

#### todo025: Extract error toast helper to reduce duplication
**Priority:** P2
**File:** `src/renderer/src/utils/toastHelpers.ts` (NEW)
**Estimated Effort:** 0.1 day
**Issue:** Error toast logic duplicated 3 times in WelcomePanel
**Fix:**
```typescript
export function showErrorToast(title: string, message: string, duration = 5000) {
  showGlobalToast({ title, message, type: 'error', duration })
}

export function showSuccessToast(title: string, message: string, duration = 3000) {
  showGlobalToast({ title, message, type: 'success', duration })
}
```

---

#### todo026: Extract project item title logic to helper function
**Priority:** P2
**File:** `src/renderer/src/components/Panels/WelcomePanel.tsx:167-173`
**Estimated Effort:** 0.1 day
**Issue:** Complex nested ternary creates cognitive overhead
**Fix:**
```typescript
function getProjectItemTitle(
  project: RecentProject,
  isOpening: boolean,
  isProjectChanging: boolean
): string {
  if (isProjectChanging) return 'Waiting for folder selection...'
  if (isOpening) return 'Opening project...'
  return project.path
}
```

---

#### todo027: Extract time formatting to utility file
**Priority:** P2
**File:** `src/renderer/src/utils/timeFormatting.ts` (NEW)
**Estimated Effort:** 0.25 day
**Issue:** 13-line function in component, not reusable
**Options:**
- **Option A:** Use library (date-fns, dayjs)
- **Option B:** Extract to utility with tests

**Option B:**
```typescript
// src/renderer/src/utils/timeFormatting.ts
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const MINUTE = 60_000
  const HOUR = 3600_000
  const DAY = 86400_000
  const WEEK = 604800_000

  if (diff < MINUTE) return 'Just now'

  const minutes = Math.floor(diff / MINUTE)
  if (diff < HOUR) return formatUnit(minutes, 'minute')

  const hours = Math.floor(diff / HOUR)
  if (diff < DAY) return formatUnit(hours, 'hour')

  const days = Math.floor(diff / DAY)
  if (diff < WEEK) return formatUnit(days, 'day')

  return new Date(timestamp).toLocaleDateString()
}

function formatUnit(value: number, unit: string): string {
  return `${value} ${unit}${value > 1 ? 's' : ''} ago`
}
```

---

#### todo028: Replace inline styles with CSS classes in WelcomePanel
**Priority:** P2
**File:** `src/renderer/src/components/Panels/WelcomePanel.tsx:174-177, 183`
**Estimated Effort:** 0.1 day
**Issue:** New style objects created on every render
**Fix:**
```typescript
// Add to AppDockLayout.css:
.recent-project-item.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.recent-project-item.opening {
  cursor: wait;
}

.recent-project-opening-text {
  margin-left: 8px;
  font-size: 12px;
  color: #858585;
}

// Then in component:
<div className={`recent-project-item ${getItemClasses(isOpening, isProjectChanging)}`}>
```

---

#### todo029: Extract magic numbers to constants
**Priority:** P2
**Files:** Multiple
**Estimated Effort:** 0.1 day
**Issue:** Magic numbers scattered throughout code
**Fix:**
```typescript
// Create src/shared/constants.ts
export const MAX_RECENT_PROJECTS = 5
export const MIN_TIMESTAMP_INCREMENT = 1
export const TOAST_DURATION_ERROR = 5000
export const TOAST_DURATION_SUCCESS = 3000
export const PROJECT_NAME_MAX_LENGTH = 255
```

---

#### todo030: Improve TypeScript safety - Remove 'as unknown as' casts
**Priority:** P2
**File:** `src/main/services/SettingsService.ts:62-64`
**Estimated Effort:** 0.25 day
**Issue:** Unsafe type assertion
**Fix:**
```typescript
// Option A: Install @types/electron-store
npm install --save-dev @types/electron-store

// Option B: Create proper typing
interface ElectronStoreConstructor {
  new <T>(options?: { name: string }): Store<T>
}
```

---

### UI/UX Enhancements

#### todo031: Refactor UIBlocker to be reusable
**Priority:** P2
**File:** `src/renderer/src/components/UIBlocker/UIBlocker.tsx:20`
**Estimated Effort:** 0.25 day
**Issue:** Tightly coupled to useProjectStore, not reusable
**Fix:**
```typescript
interface UIBlockerProps {
  visible: boolean
  message?: string
  reason?: 'folder-selection' | 'loading' | 'processing'
}

export function UIBlocker({
  visible,
  message = 'Please wait...',
  reason = 'processing'
}: UIBlockerProps) {
  if (!visible) return null

  return (
    <div className={`ui-blocker ui-blocker--${reason}`}>
      <div className="ui-blocker-content">
        <div className="ui-blocker-spinner"></div>
        <div className="ui-blocker-message">{message}</div>
      </div>
    </div>
  )
}

// Usage:
<UIBlocker
  visible={isProjectChanging}
  message="Waiting for folder selection..."
  reason="folder-selection"
/>
```

---

#### todo032: Add fade-in/fade-out animation to UIBlocker
**Priority:** P2
**File:** `src/renderer/src/components/UIBlocker/UIBlocker.css`
**Estimated Effort:** 0.1 day
**Fix:**
```css
.ui-blocker {
  animation: ui-blocker-fade-in 0.2s ease-out;
}

@keyframes ui-blocker-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.ui-blocker.exiting {
  animation: ui-blocker-fade-out 0.2s ease-out;
}

@keyframes ui-blocker-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
```

---

#### todo033: Add keyboard shortcuts for recent projects
**Priority:** P2
**File:** `src/renderer/src/components/Panels/WelcomePanel.tsx`
**Estimated Effort:** 0.25 day
**Description:**
- Cmd/Ctrl + 1-5: Open recent project by index
- Cmd/Ctrl + Shift + Delete: Clear recent projects

---

#### todo034: Add project icons/thumbnails to recent list
**Priority:** P2
**File:** `src/renderer/src/components/Panels/WelcomePanel.tsx`
**Estimated Effort:** 1 day
**Description:**
- Detect project type (React, Node, Python, etc.) from files
- Show appropriate icon
- Optional: Generate thumbnail from README.md

---

#### todo035: Add project metadata to recent list
**Priority:** P2
**File:** `src/main/services/SettingsService.ts`, `WelcomePanel.tsx`
**Estimated Effort:** 0.5 day
**Description:**
- Show file count
- Show last modified date
- Show project size

---

## 🔵 P3 - Low Priority (Future)

### Infrastructure

#### todo036: Replace console.log/error/warn with logging framework
**Priority:** P3
**Files:** Multiple
**Estimated Effort:** 0.5 day
**Options:** winston, pino, electron-log
**Fix:**
```typescript
// Create src/main/utils/logger.ts
import log from 'electron-log'

export const logger = {
  debug: log.debug,
  info: log.info,
  warn: log.warn,
  error: log.error,
}

// Then replace:
console.error('Open project failed:', message)
// With:
logger.error('Open project failed', { message, path })
```

---

#### todo037: Add structured logging with context
**Priority:** P3
**Estimated Effort:** 0.25 day
**Fix:**
```typescript
logger.info('Project opened', {
  operation: 'openProject',
  path: projectPath,
  duration: Date.now() - startTime,
  user: getUserId(),
  session: getSessionId()
})
```

---

#### todo038: Add telemetry for recent projects usage
**Priority:** P3
**Files:** Multiple
**Estimated Effort:** 1 day
**Metrics to Track:**
- Recent project click rate
- Time between opens
- Stale project removal rate
- Error rates by type
- Average list size

---

#### todo039: Add performance monitoring
**Priority:** P3
**Estimated Effort:** 0.5 day
**Metrics:**
- Time to load recent projects
- Time to open project
- Canonical path resolution time
- Mutex wait time

---

### Documentation

#### todo040: Add JSDoc comments to all public methods
**Priority:** P3
**Files:** `pathSecurity.ts`, `SettingsService.ts`, etc.
**Estimated Effort:** 0.5 day
**Example:**
```typescript
/**
 * Validates that a project path is safe to open.
 *
 * @param projectPath - Absolute path to validate
 * @throws {PathSecurityError} If path is invalid, relative, system directory, or inaccessible
 *
 * @example
 * await validateProjectPath('/Users/john/projects/myapp')  // OK
 * await validateProjectPath('./myapp')  // Throws: PATH_NOT_ABSOLUTE
 * await validateProjectPath('/etc')  // Throws: PATH_SYSTEM_DIR
 */
export async function validateProjectPath(projectPath: string): Promise<void>
```

---

#### todo041: Create architecture decision records (ADRs)
**Priority:** P3
**File:** `docs/adr/` (NEW)
**Estimated Effort:** 0.5 day
**ADRs to Create:**
- ADR-001: Why mutex for recent projects (not optimistic locking)
- ADR-002: Why canonical path comparison (not string comparison)
- ADR-003: Why max 5 projects (not configurable)
- ADR-004: Why global UI blocker (not per-component)

---

#### todo042: Create user documentation for recent projects
**Priority:** P3
**File:** `docs/user-guide/recent-projects.md` (NEW)
**Estimated Effort:** 0.25 day
**Sections:**
- What are recent projects?
- How to open from recent list
- How to remove from recent list
- Maximum 5 projects explanation
- Keyboard shortcuts

---

### Advanced Features

#### todo043: Make MAX_RECENT_PROJECTS user-configurable
**Priority:** P3
**Estimated Effort:** 0.5 day
**Implementation:**
- Add settings UI
- Persist to electron-store
- Validate range (1-20)

---

#### todo044: Add search/filter to recent projects
**Priority:** P3
**Estimated Effort:** 0.5 day
**Implementation:**
- Search by project name or path
- Fuzzy matching
- Keyboard navigation

---

#### todo045: Add "Pin" functionality for favorite projects
**Priority:** P3
**Estimated Effort:** 1 day
**Implementation:**
- Separate pinned list (always shown first)
- Pin icon in recent list
- Persist pinned state

---

#### todo046: Sync recent projects across devices
**Priority:** P3
**Estimated Effort:** 3 days
**Implementation:**
- Cloud storage integration (optional)
- Conflict resolution
- Privacy considerations

---

#### todo047: Add project categories/tags
**Priority:** P3
**Estimated Effort:** 2 days
**Implementation:**
- Manual tagging
- Auto-detect from .git, package.json, etc.
- Filter by tag

---

#### todo048: Add project templates
**Priority:** P3
**Estimated Effort:** 2 days
**Implementation:**
- "New Project" button in welcome screen
- Template selection (React, Node, Python, etc.)
- Scaffold from templates

---

## Summary

**Total Items:** 48 todos (30 remaining)
**Completed:** 18 items (todo007-013: performance/security/reliability; todo014-017: SOLID refactoring; todo018-020: React improvements; todo021-024: error handling)

**Estimated Effort (Remaining):**
- **P0 (Critical):** ~4 days (todo001-006: testing only)
- **P1 (High):** 0 days (all completed!)
- **P2 (Medium):** 1-2 days
- **P3 (Low):** 10-12 days

**Recommended Approach:**
1. Complete all P0 testing items before merge (~4 days focused work)
2. Cherry-pick P2 items based on user feedback
3. Consider P3 items for future major versions

**Next Steps:**
1. Write comprehensive test suite (170+ tests) for P0 completion
2. Review and prioritize P2 items based on user feedback
3. Set milestone for P0 testing completion before merge
