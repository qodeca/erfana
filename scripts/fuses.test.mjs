// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
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
const {
  chmodNodePtySpawnHelper,
  SPAWN_HELPER_MODE,
  ensurePackedMediaBinaries,
  MEDIA_BINARY_MIN_BYTES,
  pruneForeignFfprobeBinaries,
  pruneForeignNodePtyPrebuilds,
} = require('./fuses.js');
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

// Pure POSIX-mode contract tests: Windows `fs.chmodSync` is effectively a no-op
// for POSIX permission bits, so these assert 0o644/0o755 transitions that only
// hold on macOS/Linux. Skipped on Windows (ubuntu CI still covers them).
// See docs/windows/known-flakes.md row "scripts/fuses.test.mjs".
describe.skipIf(process.platform === 'win32')('chmodNodePtySpawnHelper', () => {
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

// POSIX-mode contract (chmod 0755 on copied media binaries) — same Windows
// no-op caveat as chmodNodePtySpawnHelper above. See docs/windows/known-flakes.md.
describe.skipIf(process.platform === 'win32')('ensurePackedMediaBinaries', () => {
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

// ---- Shared fixtures for the foreign-arch prune tests ----------------------

function lsdirs(p) {
  return fs.existsSync(p) ? fs.readdirSync(p).sort() : [];
}

function ffprobeBin(root) {
  return path.join(root, 'app', 'node_modules', 'ffprobe-static', 'bin');
}

function makeFfprobe(root, plat, arch, { exe = false } = {}) {
  const dir = path.join(ffprobeBin(root), plat, arch);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, exe ? 'ffprobe.exe' : 'ffprobe'), 'probe');
  return dir;
}

// Mirror ffprobe-static's full vendored layout (every platform/arch).
function seedFullFfprobe(root) {
  makeFfprobe(root, 'darwin', 'x64');
  makeFfprobe(root, 'darwin', 'arm64');
  makeFfprobe(root, 'linux', 'ia32');
  makeFfprobe(root, 'linux', 'x64');
  makeFfprobe(root, 'win32', 'ia32', { exe: true });
  makeFfprobe(root, 'win32', 'x64', { exe: true });
}

function prebuildsDir(root) {
  return path.join(root, 'app', 'node_modules', 'node-pty', 'prebuilds');
}

function makePrebuild(root, name, { pdb = false, dll = false } = {}) {
  const dir = path.join(prebuildsDir(root), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pty.node'), 'addon');
  if (dll) {
    fs.writeFileSync(path.join(dir, 'winpty.dll'), 'dll');
    fs.writeFileSync(path.join(dir, 'winpty-agent.exe'), 'exe');
  }
  if (pdb) {
    fs.writeFileSync(path.join(dir, 'pty.pdb'), 'sym');
    fs.writeFileSync(path.join(dir, 'winpty.pdb'), 'sym');
  }
  return dir;
}

describe('pruneForeignFfprobeBinaries', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ffprobe-prune-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('keeps only the target platform/arch on a darwin/arm64 build', () => {
    seedFullFfprobe(tmpRoot);
    pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true });
    const bin = ffprobeBin(tmpRoot);
    expect(lsdirs(bin)).toEqual(['darwin']);
    expect(lsdirs(path.join(bin, 'darwin'))).toEqual(['arm64']);
    expect(fs.existsSync(path.join(bin, 'darwin', 'arm64', 'ffprobe'))).toBe(true);
  });

  it('keeps only win32/x64 (ffprobe.exe) on a win32/x64 build', () => {
    seedFullFfprobe(tmpRoot);
    pruneForeignFfprobeBinaries(tmpRoot, 'win32', Arch.x64, { requireMatch: true });
    const bin = ffprobeBin(tmpRoot);
    expect(lsdirs(bin)).toEqual(['win32']);
    expect(lsdirs(path.join(bin, 'win32'))).toEqual(['x64']);
    expect(fs.existsSync(path.join(bin, 'win32', 'x64', 'ffprobe.exe'))).toBe(true);
  });

  it('on a universal mac target drops foreign platforms but keeps both darwin arches', () => {
    seedFullFfprobe(tmpRoot);
    pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.universal, { requireMatch: true });
    const bin = ffprobeBin(tmpRoot);
    expect(lsdirs(bin)).toEqual(['darwin']);
    expect(lsdirs(path.join(bin, 'darwin'))).toEqual(['arm64', 'x64']);
  });

  it('skips entirely for armv7l (no deletion)', () => {
    seedFullFfprobe(tmpRoot);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pruneForeignFfprobeBinaries(tmpRoot, 'linux', Arch.armv7l, { requireMatch: false });
    expect(lsdirs(ffprobeBin(tmpRoot))).toEqual(['darwin', 'linux', 'win32']);
    expect(warn).toHaveBeenCalled();
  });

  it('skips (warns) when ffprobe-static/bin is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ffprobe-static/bin not found'));
  });

  it('throws under requireMatch when the target arch is absent', () => {
    makeFfprobe(tmpRoot, 'darwin', 'x64'); // only x64 present; build arm64
    expect(() =>
      pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true })
    ).toThrow(/no usable binary/i);
  });

  it('only warns (no throw) when the target is absent and requireMatch is false', () => {
    makeFfprobe(tmpRoot, 'linux', 'x64'); // cross-platform pack for darwin/arm64
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.arm64, { requireMatch: false })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('absent after prune'));
  });

  it('does not delete through a symlinked platform directory', () => {
    seedFullFfprobe(tmpRoot);
    const external = path.join(tmpRoot, 'external-dir');
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, 'keep'), 'x');
    // Replace the win32 platform dir with a symlink pointing outside the tree.
    fs.rmSync(path.join(ffprobeBin(tmpRoot), 'win32'), { recursive: true, force: true });
    fs.symlinkSync(external, path.join(ffprobeBin(tmpRoot), 'win32'));

    pruneForeignFfprobeBinaries(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true });

    // The symlink was skipped, so the external target's contents are untouched.
    expect(fs.existsSync(path.join(external, 'keep'))).toBe(true);
  });
});

describe('pruneForeignNodePtyPrebuilds', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodepty-prune-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('keeps only the target prebuild on a darwin/arm64 build', () => {
    ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64'].forEach((n) => makePrebuild(tmpRoot, n));
    pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true });
    expect(lsdirs(prebuildsDir(tmpRoot))).toEqual(['darwin-arm64']);
  });

  it('on a universal mac target keeps both darwin prebuilds and drops win32', () => {
    ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64'].forEach((n) => makePrebuild(tmpRoot, n));
    pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.universal, { requireMatch: true });
    expect(lsdirs(prebuildsDir(tmpRoot))).toEqual(['darwin-arm64', 'darwin-x64']);
  });

  it('strips .pdb from the kept win32 prebuild but keeps pty.node and runtime helpers', () => {
    makePrebuild(tmpRoot, 'win32-x64', { pdb: true, dll: true });
    makePrebuild(tmpRoot, 'darwin-arm64');
    pruneForeignNodePtyPrebuilds(tmpRoot, 'win32', Arch.x64, { requireMatch: true });
    const kept = path.join(prebuildsDir(tmpRoot), 'win32-x64');
    expect(lsdirs(prebuildsDir(tmpRoot))).toEqual(['win32-x64']);
    expect(fs.existsSync(path.join(kept, 'pty.node'))).toBe(true);
    expect(fs.existsSync(path.join(kept, 'winpty.dll'))).toBe(true);
    expect(fs.existsSync(path.join(kept, 'winpty-agent.exe'))).toBe(true);
    expect(fs.existsSync(path.join(kept, 'pty.pdb'))).toBe(false);
    expect(fs.existsSync(path.join(kept, 'winpty.pdb'))).toBe(false);
  });

  it('does NOT strip .pdb on a non-win32 target', () => {
    const dir = makePrebuild(tmpRoot, 'darwin-arm64');
    fs.writeFileSync(path.join(dir, 'extra.pdb'), 'sym');
    pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true });
    expect(fs.existsSync(path.join(dir, 'extra.pdb'))).toBe(true);
  });

  it('skips entirely for armv7l (no deletion)', () => {
    ['darwin-arm64', 'win32-x64'].forEach((n) => makePrebuild(tmpRoot, n));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pruneForeignNodePtyPrebuilds(tmpRoot, 'linux', Arch.armv7l, { requireMatch: false });
    expect(lsdirs(prebuildsDir(tmpRoot))).toEqual(['darwin-arm64', 'win32-x64']);
    expect(warn).toHaveBeenCalled();
  });

  it('skips (warns) when prebuilds/ is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('node-pty prebuilds not found'));
  });

  it('throws under requireMatch when no target prebuild survives', () => {
    makePrebuild(tmpRoot, 'win32-x64'); // building darwin/arm64
    expect(() =>
      pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.arm64, { requireMatch: true })
    ).toThrow(/no prebuild for/i);
  });

  it('only warns (no throw) when target absent and requireMatch is false', () => {
    makePrebuild(tmpRoot, 'win32-x64');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      pruneForeignNodePtyPrebuilds(tmpRoot, 'darwin', Arch.arm64, { requireMatch: false })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('absent after prune'));
  });

  it('throws when the .pdb strip would leave no pty.node under requireMatch', () => {
    const dir = path.join(prebuildsDir(tmpRoot), 'win32-x64');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pty.pdb'), 'sym'); // .pdb only, no pty.node
    expect(() =>
      pruneForeignNodePtyPrebuilds(tmpRoot, 'win32', Arch.x64, { requireMatch: true })
    ).toThrow(/pty\.node missing/i);
  });
});
