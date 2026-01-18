# Requirements

## Functional Requirements

### FR-001: Watch git index for staging changes

**Priority:** High
**Traces to:** Existing implementation hardening

The system shall watch the `.git/index` file for changes to detect when files are staged or unstaged. This hardens the existing implementation to ensure reliable detection of all staging operations.

**Acceptance:** Staging a file via `git add` or unstaging via `git reset` triggers a status refresh within 1 second.

---

### FR-002: Watch git HEAD for branch switches

**Priority:** High
**Traces to:** New capability

The system shall watch the `.git/HEAD` file to detect when the current branch changes (checkout, switch operations).

**Acceptance:** Running `git checkout branch-name` or `git switch branch-name` triggers a status refresh within 1 second.

---

### FR-003: Watch git refs for branch operations

**Priority:** Medium
**Traces to:** New capability

The system shall watch the `.git/refs/heads/` directory to detect branch creation, deletion, and rename operations.

**Acceptance:** Running `git branch new-branch`, `git branch -d branch`, or `git branch -m old new` triggers a status refresh.

---

### FR-004: Watch git FETCH_HEAD for fetch operations

**Priority:** Medium
**Traces to:** New capability

The system shall watch the `.git/FETCH_HEAD` file to detect when remote changes are fetched.

**Acceptance:** Running `git fetch` triggers a status refresh within 1 second.

---

### FR-005: Watch git stash for stash operations

**Priority:** Medium
**Traces to:** New capability

The system shall watch the `.git/stash` reference and `.git/refs/stash` to detect stash push and pop operations.

**Acceptance:** Running `git stash` or `git stash pop` triggers a status refresh within 1 second.

---

### FR-006: Detect internal file edits

**Priority:** High
**Traces to:** Existing implementation verification

The system shall detect when files are modified, created, or deleted within the Erfana editor.

**Acceptance:** Editing and saving a file in Erfana updates its git status indicator within 1 second.

---

### FR-007: Detect external file changes

**Priority:** High
**Traces to:** Existing implementation verification

The system shall detect when files are modified, created, or deleted by external applications or scripts.

**Acceptance:** Modifying a tracked file in an external editor (VS Code, vim) updates its git status indicator within 1 second.

---

### FR-008: Detect external git CLI operations

**Priority:** High
**Traces to:** New capability

The system shall detect all common git CLI operations including: add, commit, checkout, reset, stash, fetch, merge, rebase, cherry-pick, and revert.

**Acceptance:** Any git CLI command that changes working tree or index state triggers a status refresh within 1 second.

---

### FR-009: Implement polling fallback mechanism

**Priority:** High
**Traces to:** Reliability safety net

The system shall implement a polling mechanism (5-10 second interval) as a fallback to catch any events that file watchers might miss, especially on network drives or cloud-synced folders.

**Acceptance:** Even with file watchers disabled, git status updates within the polling interval.

---

### FR-010: Reduce refresh latency to sub-second

**Priority:** High
**Traces to:** Performance improvement

The system shall reduce the end-to-end latency from change detection to UI update to less than 1 second. Current implementation has ~2 second latency due to debounce (500ms) + cooldown (1500ms).

**Acceptance:** Measured latency from file change to UI update is consistently under 1 second.

---

## Non-Functional Requirements

### NFR-001: Performance - Sub-second latency

**Category:** Performance
**Metric:** < 1 second from change to UI update

The system shall provide git status updates within 1 second of any detectable change. This requires optimizing current debounce (500ms) and cooldown (1500ms) timings.

---

### NFR-002: Reliability - Zero missed changes

**Category:** Reliability
**Metric:** 100% detection rate

The system shall detect all git-relevant changes across all documented scenarios. The polling fallback ensures eventual consistency even if file watchers fail.

---

### NFR-003: Efficiency - Minimal CPU impact

**Category:** Performance
**Metric:** < 1% CPU on idle with polling active

The polling fallback mechanism shall not noticeably impact CPU usage. Status computation should be efficient and cached where possible.

---

### NFR-004: Recovery - Auto-restart on errors

**Category:** Reliability
**Traces to:** Existing DirectoryWatcherService capability

The system shall automatically restart file watchers on transient errors using exponential backoff (existing implementation: 800ms, 1600ms, 3200ms with max 3 attempts).

---

### NFR-005: Compatibility - Cross-platform storage

**Category:** Compatibility
**Metric:** Works on local, network, and cloud-synced drives

The system shall work reliably on:
- Local SSDs and HDDs
- Network drives (NFS, SMB)
- Cloud-synced folders (Dropbox, iCloud, OneDrive)

The polling fallback is critical for environments where file system events are unreliable.
