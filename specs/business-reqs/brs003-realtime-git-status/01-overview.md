# Overview

## Summary

This specification defines a bullet-proof, real-time git status refresh mechanism for the Erfana Project panel. The system will detect all change scenarios (internal edits, external changes, git CLI operations) within less than 1 second latency, with a polling fallback mechanism for guaranteed reliability across all environments.

## Purpose

The current git status implementation has gaps in detecting certain change scenarios, leading to stale status displays in the Project panel. Users expect immediate visual feedback when files are modified, staged, or committed—whether changes originate from within Erfana, external editors, or git CLI commands. This feature ensures the Project panel always reflects the true repository state.

## Scope

### In Scope

- Watching `.git/index` for staging area changes (harden existing implementation)
- Watching `.git/HEAD` for branch switches
- Watching `.git/refs/heads/` for branch operations (create, delete, rename)
- Watching `.git/FETCH_HEAD` for fetch operations
- Watching `.git/stash` for stash operations
- Detecting internal file edits within Erfana editor
- Detecting external file changes from other applications and scripts
- Detecting external git CLI operations (add, commit, checkout, stash, fetch, reset, etc.)
- Implementing polling fallback (5-10 second interval) as reliability safety net
- Reducing refresh latency from current ~2 seconds to under 1 second

### Out of Scope

- Support for global `.gitignore` (isomorphic-git limitation)
- Git submodule status tracking
- Remote repository status (push/pull state)
- Git hooks execution monitoring

## Success Criteria

1. **Latency**: Git status updates appear in UI within 1 second of any change
2. **Coverage**: 100% detection rate for all documented change scenarios
3. **Reliability**: Polling fallback catches any events missed by file watchers
4. **Performance**: Polling mechanism uses less than 1% CPU on idle
5. **Recovery**: Watcher failures trigger automatic restart with exponential backoff
6. **Compatibility**: Works reliably on local drives, network drives, and cloud-synced folders (Dropbox, iCloud)
