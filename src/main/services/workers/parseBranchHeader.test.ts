// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Unit tests for parseBranchHeader.
 *
 * `git status --porcelain=v1 --branch -z` emits a leading `## <…>` NUL-terminated
 * part before the file entries. parseBranchHeader extracts branch / detached
 * HEAD / unborn-branch state from that part – pinning the parser is the cheapest
 * way to make sure a freshly-`git init`ed repo and detached HEADs both produce
 * the right `branch` / `isDetached` / `isUnborn` shape downstream.
 *
 * Lens review #1 (no-commit repo) + #6 (detached-HEAD coverage).
 */

import { describe, it, expect, vi } from 'vitest'

// The worker file guards on `parentPort` at import; mock the module so the
// import doesn't throw in the test environment.
vi.mock('worker_threads', () => ({ parentPort: { on: vi.fn(), postMessage: vi.fn() } }))
vi.mock('isomorphic-git', () => ({ currentBranch: vi.fn(), resolveRef: vi.fn(), statusMatrix: vi.fn() }))

import { parseBranchHeader } from './git-status.worker'

describe('parseBranchHeader', () => {
  it('returns safe defaults for an empty output', () => {
    expect(parseBranchHeader('')).toEqual({ branch: null, isDetached: false, isUnborn: false })
  })

  it('parses a plain branch header `## main`', () => {
    expect(parseBranchHeader('## main\0')).toEqual({ branch: 'main', isDetached: false, isUnborn: false })
  })

  it('strips the upstream `...origin/main` suffix from the branch name', () => {
    expect(parseBranchHeader('## main...origin/main\0')).toEqual({
      branch: 'main',
      isDetached: false,
      isUnborn: false,
    })
  })

  it('strips the ahead/behind `[ahead 1, behind 2]` suffix', () => {
    expect(parseBranchHeader('## feature/x...origin/feature/x [ahead 1, behind 2]\0')).toEqual({
      branch: 'feature/x',
      isDetached: false,
      isUnborn: false,
    })
  })

  it('recognises detached HEAD via `## HEAD (no branch)`', () => {
    expect(parseBranchHeader('## HEAD (no branch)\0')).toEqual({
      branch: 'HEAD',
      isDetached: true,
      isUnborn: false,
    })
  })

  it('recognises an unborn branch (just-`git init`-ed repo)', () => {
    // The headline regression from the lens review: previously rev-parse
    // --abbrev-ref HEAD threw exit 128 and the whole status call was discarded,
    // so a fresh repo showed no untracked files. With --branch, git emits this
    // header instead and we keep the branch name *and* the file list.
    expect(parseBranchHeader('## No commits yet on main\0')).toEqual({
      branch: 'main',
      isDetached: false,
      isUnborn: true,
    })
  })

  it('handles unborn branches with `/` in the name', () => {
    expect(parseBranchHeader('## No commits yet on feature/auth\0').branch).toBe('feature/auth')
  })

  it('still reads the header when file entries follow it', () => {
    const out = '## main\0?? new-file.ts\0 M src/edited.ts\0'
    expect(parseBranchHeader(out)).toEqual({ branch: 'main', isDetached: false, isUnborn: false })
  })

  it('returns null branch when output has entries but no header (defensive)', () => {
    // Should not happen with `--branch`, but a missing header must not crash
    // the worker or set branch to an entry filepath.
    expect(parseBranchHeader('?? new-file.ts\0')).toEqual({
      branch: null,
      isDetached: false,
      isUnborn: false,
    })
  })
})
