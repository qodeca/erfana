# Acceptance Criteria

## Test Cases

### TC-001: Git staging detection via git add

**Traces to:** FR-001
**Steps:**
1. Open a git repository in Erfana
2. Modify a tracked file externally
3. Run `git add <file>` in external terminal
4. Observe Project panel

**Expected Result:** File status indicator changes to "staged" within 1 second.

---

### TC-002: Git unstaging detection via git reset

**Traces to:** FR-001
**Steps:**
1. Stage a file using `git add`
2. Run `git reset <file>` in external terminal
3. Observe Project panel

**Expected Result:** File status indicator changes to "modified" within 1 second.

---

### TC-003: Branch switch detection via git checkout

**Traces to:** FR-002
**Steps:**
1. Have multiple branches in repository
2. Run `git checkout <other-branch>` in external terminal
3. Observe Project panel

**Expected Result:** Project panel refreshes with new branch's status within 1 second.

---

### TC-004: Branch creation detection

**Traces to:** FR-003
**Steps:**
1. Run `git branch new-feature` in external terminal
2. Observe git status (if branch list is shown)

**Expected Result:** Status refresh occurs within 1 second.

---

### TC-005: Fetch operation detection

**Traces to:** FR-004
**Steps:**
1. Ensure remote has new commits
2. Run `git fetch` in external terminal
3. Observe Project panel

**Expected Result:** Status refresh occurs within 1 second.

---

### TC-006: Stash operation detection

**Traces to:** FR-005
**Steps:**
1. Modify a tracked file
2. Run `git stash` in external terminal
3. Observe Project panel

**Expected Result:** File status changes to clean within 1 second.

---

### TC-007: Internal file edit detection

**Traces to:** FR-006
**Steps:**
1. Open a tracked file in Erfana editor
2. Make and save a change
3. Observe Project panel

**Expected Result:** File status indicator shows "modified" within 1 second of save.

---

### TC-008: External file edit detection

**Traces to:** FR-007
**Steps:**
1. Open repository in Erfana
2. Edit a tracked file in external editor (VS Code, vim)
3. Save the file
4. Observe Project panel

**Expected Result:** File status indicator shows "modified" within 1 second.

---

### TC-009: Git commit detection

**Traces to:** FR-008
**Steps:**
1. Stage files using `git add`
2. Run `git commit -m "message"` in external terminal
3. Observe Project panel

**Expected Result:** Staged files status changes to clean within 1 second.

---

### TC-010: Git reset --hard detection

**Traces to:** FR-008
**Steps:**
1. Have modified files in working directory
2. Run `git reset --hard HEAD` in external terminal
3. Observe Project panel

**Expected Result:** All file statuses reset to clean within 1 second.

---

### TC-011: Polling fallback verification

**Traces to:** FR-009
**Steps:**
1. Temporarily disable file watchers (for testing)
2. Make a change externally
3. Wait for polling interval (5-10 seconds)
4. Observe Project panel

**Expected Result:** Status updates within the polling interval even without watchers.

---

### TC-012: Latency measurement under 1 second

**Traces to:** FR-010, NFR-001
**Steps:**
1. Set up timing measurement (console timestamps)
2. Modify a file
3. Measure time until UI update

**Expected Result:** Consistent latency under 1 second (target: 500-800ms).

---

### TC-013: CPU usage during polling

**Traces to:** NFR-003
**Steps:**
1. Open repository in Erfana
2. Let it idle for 5 minutes with polling active
3. Monitor CPU usage in Activity Monitor

**Expected Result:** CPU usage remains below 1% during idle.

---

### TC-014: Watcher auto-recovery

**Traces to:** NFR-004
**Steps:**
1. Simulate watcher error (e.g., disconnect network drive briefly)
2. Reconnect drive
3. Make a change

**Expected Result:** Watcher auto-restarts and detects changes after recovery.

---

### TC-015: Cloud-synced folder compatibility

**Traces to:** NFR-005
**Steps:**
1. Open repository in Dropbox/iCloud folder
2. Make changes from another device
3. Wait for sync
4. Observe Project panel

**Expected Result:** Status updates after file sync completes (within polling interval at minimum).

---

## Definition of Done

- [ ] All `.git/` watch points implemented (index, HEAD, refs/heads, FETCH_HEAD, stash)
- [ ] Internal file edit detection verified
- [ ] External file change detection verified
- [ ] External git CLI operations detection verified
- [ ] Polling fallback mechanism implemented with configurable interval
- [ ] End-to-end latency reduced to < 1 second
- [ ] CPU usage during polling verified < 1%
- [ ] Watcher auto-recovery tested and working
- [ ] Unit tests cover all new watch points
- [ ] Integration tests cover common git workflows
- [ ] Manual testing completed on local, network, and cloud-synced drives
- [ ] Documentation updated (architecture, known issues if any)
- [ ] Code review completed
- [ ] All test cases pass
