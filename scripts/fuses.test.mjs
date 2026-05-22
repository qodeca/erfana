import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

// fuses.js is CommonJS — use createRequire to import it from this ESM test.
const require = createRequire(import.meta.url);
const { chmodNodePtySpawnHelper, SPAWN_HELPER_MODE } = require('./fuses.js');

/**
 * Build a fixture mirroring the bundle layout the helper expects:
 *   <root>/app/node_modules/node-pty/prebuilds/<arch>/spawn-helper
 *
 * Returns the helper path so tests can mutate it (e.g. replace with
 * a symlink before invoking chmodNodePtySpawnHelper).
 */
function makeHelperFixture(root, arch, { mode = 0o644, content = 'fake binary' } = {}) {
  const dir = path.join(root, 'app', 'node_modules', 'node-pty', 'prebuilds', arch);
  fs.mkdirSync(dir, { recursive: true });
  const helperPath = path.join(dir, 'spawn-helper');
  fs.writeFileSync(helperPath, content);
  fs.chmodSync(helperPath, mode);
  return helperPath;
}

function modeOf(p) {
  return fs.lstatSync(p).mode & 0o777;
}

describe('chmodNodePtySpawnHelper', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-helper-fuses-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('chmods a 0644 spawn-helper to 0755 and reports chmodCount:1', () => {
    const helperPath = makeHelperFixture(tmpRoot, 'darwin-arm64');
    expect(modeOf(helperPath)).toBe(0o644);

    const result = chmodNodePtySpawnHelper(tmpRoot);

    expect(modeOf(helperPath)).toBe(SPAWN_HELPER_MODE);
    expect(result).toEqual({ chmodCount: 1, skipped: 0 });
  });

  it('is idempotent — already-0755 helper stays 0755 and is still counted', () => {
    const helperPath = makeHelperFixture(tmpRoot, 'darwin-arm64', { mode: 0o755 });

    const result = chmodNodePtySpawnHelper(tmpRoot);

    expect(modeOf(helperPath)).toBe(0o755);
    expect(result).toEqual({ chmodCount: 1, skipped: 0 });
  });

  it('handles multiple architectures in one pass', () => {
    const arm = makeHelperFixture(tmpRoot, 'darwin-arm64');
    const x64 = makeHelperFixture(tmpRoot, 'darwin-x64');

    const result = chmodNodePtySpawnHelper(tmpRoot);

    expect(modeOf(arm)).toBe(SPAWN_HELPER_MODE);
    expect(modeOf(x64)).toBe(SPAWN_HELPER_MODE);
    expect(result.chmodCount).toBe(2);
  });

  it('returns chmodCount:0 and does not throw when prebuilds/ is missing', () => {
    // No fixture — tmpRoot exists but contains no app/node_modules tree.
    const result = chmodNodePtySpawnHelper(tmpRoot);
    expect(result).toEqual({ chmodCount: 0, skipped: 0 });
  });

  it('throws when prebuilds/ is empty and requireMatch is true', () => {
    fs.mkdirSync(
      path.join(tmpRoot, 'app', 'node_modules', 'node-pty', 'prebuilds'),
      { recursive: true }
    );

    expect(() => chmodNodePtySpawnHelper(tmpRoot, { requireMatch: true })).toThrow(
      /No spawn-helper binaries found/
    );
  });

  it('only warns (does not throw) when prebuilds/ is empty and requireMatch is false', () => {
    fs.mkdirSync(
      path.join(tmpRoot, 'app', 'node_modules', 'node-pty', 'prebuilds'),
      { recursive: true }
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = chmodNodePtySpawnHelper(tmpRoot, { requireMatch: false });

    expect(result.chmodCount).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No spawn-helper binaries'));
  });

  it('refuses to chmod a symlinked spawn-helper and leaves the target untouched', () => {
    const externalFile = path.join(tmpRoot, 'external-target');
    fs.writeFileSync(externalFile, 'do not modify me');
    fs.chmodSync(externalFile, 0o644);

    const archDir = path.join(tmpRoot, 'app', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64');
    fs.mkdirSync(archDir, { recursive: true });
    const helperPath = path.join(archDir, 'spawn-helper');
    fs.symlinkSync(externalFile, helperPath);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = chmodNodePtySpawnHelper(tmpRoot);

    expect(modeOf(externalFile)).toBe(0o644);
    expect(result).toEqual({ chmodCount: 0, skipped: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-regular file'));
  });

  it('skips a directory entry named spawn-helper', () => {
    const archDir = path.join(tmpRoot, 'app', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64');
    fs.mkdirSync(archDir, { recursive: true });
    fs.mkdirSync(path.join(archDir, 'spawn-helper'));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = chmodNodePtySpawnHelper(tmpRoot);

    expect(result).toEqual({ chmodCount: 0, skipped: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('non-regular file'));
  });

  it('throws an aggregated error naming the failing path when chmodSync fails', () => {
    const helperPath = makeHelperFixture(tmpRoot, 'darwin-arm64');

    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      const err = new Error('read-only filesystem');
      err.code = 'EROFS';
      throw err;
    });

    expect(() => chmodNodePtySpawnHelper(tmpRoot)).toThrow(/Failed to chmod 1 spawn-helper/);
    expect(() => chmodNodePtySpawnHelper(tmpRoot)).toThrow(new RegExp(`EROFS`));
    // Re-run third time and capture message to verify path is included.
    let captured;
    try {
      chmodNodePtySpawnHelper(tmpRoot);
    } catch (e) {
      captured = e;
    }
    expect(captured?.message).toContain(helperPath);
  });
});
