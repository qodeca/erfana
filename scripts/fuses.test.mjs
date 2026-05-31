import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

// Point the media cache at a temp dir BEFORE requiring fuses.js (which imports
// ensure-media-binaries.js and reads CACHE_ROOT at module load).
process.env.ERFANA_MEDIA_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-media-cache-'));

// fuses.js is CommonJS — use createRequire to import it from this ESM test.
const require = createRequire(import.meta.url);
const { chmodNodePtySpawnHelper, SPAWN_HELPER_MODE, ensurePackedMediaBinaries, MEDIA_BINARY_MIN_BYTES } = require('./fuses.js');
const { Arch } = require('electron-builder');

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

describe('ensurePackedMediaBinaries', () => {
  // Use an unpinned key (linux-x64) so verifyBinary does size-only (no SHA pin).
  const PLATFORM = 'linux';
  const ARCH_ENUM = Arch.x64;
  const KEY = 'linux-x64';
  let tmpRoot; // the per-test bundle resources dir

  // Seed the beforePack cache for KEY (CACHE_ROOT is the env-set temp dir).
  function seedCache(bytes = MEDIA_BINARY_MIN_BYTES) {
    const dir = path.join(process.env.ERFANA_MEDIA_CACHE, KEY);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'ffmpeg');
    fs.writeFileSync(p, Buffer.alloc(bytes));
    return p;
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-fuses-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(path.join(process.env.ERFANA_MEDIA_CACHE, KEY), { recursive: true, force: true });
  });

  it('copies the cached arch ffmpeg into the bundle, chmod 0755, and chmods ffprobe (skipping symlinks)', () => {
    seedCache();
    // ffprobe fixture + a symlink that must be skipped
    const probeDir = path.join(tmpRoot, 'app', 'node_modules', 'ffprobe-static', 'bin', 'linux', 'x64');
    fs.mkdirSync(probeDir, { recursive: true });
    const probe = path.join(probeDir, 'ffprobe');
    fs.writeFileSync(probe, 'probe');
    fs.chmodSync(probe, 0o644);
    const link = path.join(probeDir, '..', 'ffprobe'); // sibling named 'ffprobe' but a symlink
    fs.symlinkSync(probe, link);

    expect(() =>
      ensurePackedMediaBinaries(tmpRoot, PLATFORM, ARCH_ENUM, { requireMatch: true })
    ).not.toThrow();

    const dest = path.join(tmpRoot, 'app', 'node_modules', 'ffmpeg-static', 'ffmpeg');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.lstatSync(dest).mode & 0o777).toBe(SPAWN_HELPER_MODE);
    expect(fs.lstatSync(probe).mode & 0o777).toBe(SPAWN_HELPER_MODE);
    // The symlink itself must not have been chmod-followed (still a symlink)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('throws when the cached arch ffmpeg is absent and requireMatch is set', () => {
    expect(() =>
      ensurePackedMediaBinaries(tmpRoot, PLATFORM, ARCH_ENUM, { requireMatch: true })
    ).toThrow(/cached ffmpeg missing/i);
  });

  it('skips a universal pack without throwing (and throws under requireMatch)', () => {
    expect(() =>
      ensurePackedMediaBinaries(tmpRoot, 'darwin', Arch.universal, { requireMatch: false })
    ).not.toThrow();
    expect(() =>
      ensurePackedMediaBinaries(tmpRoot, 'darwin', Arch.universal, { requireMatch: true })
    ).toThrow(/unsupported/i);
  });
});
