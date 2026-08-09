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
  assertPackagedAppContents,
  assertConfigMatchesAllowlist,
  deriveAllowedAppEntries,
  resolvePackedResourcesDir,
  ALLOWED_APP_ENTRIES,
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

// ---- Packaged-contents allowlist (issue #43) ------------------------------

/**
 * Minimal packed-bundle layout: <root>/app/{out,node_modules,package.json}.
 * <root> IS the resourcesDir argument, same convention as the fixtures above.
 * Deterministic shape: 4 files, 6 directories, 0 symlinks.
 */
function makePackedApp(root) {
  const app = path.join(root, 'app');
  fs.mkdirSync(path.join(app, 'out', 'main'), { recursive: true });
  fs.writeFileSync(path.join(app, 'out', 'main', 'index.js'), 'main');
  fs.mkdirSync(path.join(app, 'out', 'renderer', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(app, 'out', 'renderer', 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(app, 'node_modules', 'node-pty'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', 'node-pty', 'index.js'), 'pty');
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'erfana', main: './out/main/index.js' })
  );
  return app;
}

const NON_DARWIN = process.platform === 'darwin' ? 'linux' : process.platform;

describe('resolvePackedResourcesDir', () => {
  it('resolves darwin under the .app bundle', () => {
    expect(resolvePackedResourcesDir('darwin', '/out', '/out/Erfana.app'))
      .toBe(path.join('/out/Erfana.app', 'Contents', 'Resources'));
  });

  it('resolves linux and win32 under appOutDir', () => {
    expect(resolvePackedResourcesDir('linux', '/out', '/out/erfana')).toBe(path.join('/out', 'resources'));
    expect(resolvePackedResourcesDir('win32', '/out', '/out/Erfana.exe')).toBe(path.join('/out', 'resources'));
  });

  it('returns null for an unknown platform so each caller decides', () => {
    expect(resolvePackedResourcesDir('sunos', '/out', '/out/x')).toBeNull();
  });
});

describe('deriveAllowedAppEntries', () => {
  it('maps positive patterns to their first path segment', () => {
    expect(deriveAllowedAppEntries(['out/**', 'package.json'])).toEqual([
      'node_modules', 'out', 'package.json',
    ]);
  });

  it('adds the tool invariants even when unlisted', () => {
    expect(deriveAllowedAppEntries(['out/**'])).toEqual(['node_modules', 'out', 'package.json']);
  });

  it('ignores negations, which only ever remove', () => {
    expect(deriveAllowedAppEntries(['out/**', '!**/*.map', '!node_modules/jsdom/**'])).toEqual([
      'node_modules', 'out', 'package.json',
    ]);
  });

  it('derives only the tool invariants from a negation-only list (the #43 regression)', () => {
    expect(deriveAllowedAppEntries(['!docs/**', '!src/*'])).toEqual(['node_modules', 'package.json']);
  });

  it.each(['**/*', '*', '**', '.', './**'])('throws on the all-matching pattern %s', (pattern) => {
    expect(() => deriveAllowedAppEntries([pattern])).toThrow(/all-matching pattern/i);
  });

  it('throws on a positive pattern starting with a root wildcard', () => {
    expect(() => deriveAllowedAppEntries(['**/foo'])).toThrow(/begins with a wildcard/i);
  });

  // electron-builder does not hand hooks the raw YAML array: a plain string list
  // arrives normalised as [{ filter: [...] }]. This is the shape production
  // actually passes, so it must be covered alongside the raw one.
  it('accepts the normalised FileSet shape electron-builder passes to hooks', () => {
    expect(deriveAllowedAppEntries([{ filter: ['out/**', 'package.json', '!**/*.map'] }])).toEqual([
      'node_modules', 'out', 'package.json',
    ]);
  });

  it('derives only the tool invariants from a normalised negation-only list', () => {
    expect(deriveAllowedAppEntries([{ filter: ['!docs/**', '!src/*'] }])).toEqual([
      'node_modules', 'package.json',
    ]);
  });

  it('fails closed on a FileSet that remaps paths', () => {
    expect(() => deriveAllowedAppEntries([{ from: 'extra', to: 'x', filter: ['**/*'] }]))
      .toThrow(/cannot map to a top-level bundle path/i);
  });

  it('fails closed on an entry that is neither a string nor a FileSet', () => {
    expect(() => deriveAllowedAppEntries([42])).toThrow(/cannot map to a top-level bundle path/i);
  });

  it('fails closed when files: is absent or an unsupported shape', () => {
    expect(() => deriveAllowedAppEntries(undefined)).toThrow(/absent/i);
    expect(() => deriveAllowedAppEntries('out/**')).toThrow(/unsupported shape/i);
  });

  it('rejects a deleted files: key (the real regression shape is [], never undefined)', () => {
    // app-builder-lib's doMergeConfigs coerces a missing files: to [], so this -
    // not undefined - is what "someone deleted files:" actually produces.
    expect(() => assertConfigMatchesAllowlist([])).toThrow(/config and guard disagree/i);
  });
});

describe('assertConfigMatchesAllowlist', () => {
  it('accepts a config whose derived set equals ALLOWED_APP_ENTRIES', () => {
    expect(assertConfigMatchesAllowlist(['out/**', 'package.json'])).toEqual([...ALLOWED_APP_ENTRIES]);
  });

  // Binds the REAL config to the constant. Without this, editing
  // electron-builder.yml without updating ALLOWED_APP_ENTRIES is green on every
  // push and only fails inside the release build, after the tag is cut.
  it('agrees with the repository electron-builder.yml as shipped', () => {
    const yaml = require('js-yaml');
    const config = yaml.load(
      fs.readFileSync(path.join(import.meta.dirname, '..', 'electron-builder.yml'), 'utf8')
    );
    // Raw js-yaml shape (string array).
    expect(assertConfigMatchesAllowlist(config.files, { platformFiles: config.mac?.files }))
      .toEqual([...ALLOWED_APP_ENTRIES]);
    // Normalised shape electron-builder actually hands the afterPack hook: a
    // string list becomes a single FileSet [{ filter: [...] }].
    expect(assertConfigMatchesAllowlist([{ filter: config.files }], { platformFiles: config.mac?.files }))
      .toEqual([...ALLOWED_APP_ENTRIES]);
    expect(config.win?.files).toBeUndefined();
    expect(config.linux?.files).toBeUndefined();
    // The afterPack/afterSign wiring is the one invariant Guard 6 uniquely adds,
    // and release-guards is not a required check - so assert it HERE, in the
    // required test job. Deleting afterPack silently disables all three Electron
    // fuses and the packaged-contents assertion in an otherwise-green build.
    expect(config.afterPack).toBe('./scripts/fuses.js');
    expect(config.afterSign).toBe('./scripts/resign.js');
  });

  it('folds a platform-specific files: block into the derivation', () => {
    // app-builder-lib concatenates mac:/win: files into the same matcher, so a
    // pattern hidden in a platform block must reach the comparison.
    expect(() =>
      assertConfigMatchesAllowlist(['out/**', 'package.json'], { platformFiles: ['scripts/**'] })
    ).toThrow(/config and guard disagree/i);
    expect(() =>
      assertConfigMatchesAllowlist(['out/**', 'package.json'], { platformFiles: ['**/*'] })
    ).toThrow(/all-matching pattern/i);
    // A platform block that adds nothing new is fine.
    expect(assertConfigMatchesAllowlist(['out/**', 'package.json'], { platformFiles: ['out/**'] }))
      .toEqual([...ALLOWED_APP_ENTRIES]);
  });

  it('accepts a leading ./ the way electron-builder normalises it', () => {
    expect(assertConfigMatchesAllowlist(['./out/**', 'package.json']))
      .toEqual([...ALLOWED_APP_ENTRIES]);
  });

  it('rejects a pattern escaping the project root', () => {
    expect(() => assertConfigMatchesAllowlist(['../elsewhere/**'])).toThrow(/escapes the project root/i);
  });

  it('throws when the config permits less than the guard expects', () => {
    expect(() => assertConfigMatchesAllowlist(['!docs/**'])).toThrow(/config and guard disagree/i);
  });

  it('throws when the config permits more than the guard expects', () => {
    expect(() => assertConfigMatchesAllowlist(['out/**', 'package.json', 'scripts/**']))
      .toThrow(/config and guard disagree/i);
  });
});

describe('assertPackagedAppContents', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app-contents-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('accepts a clean bundle and counts the whole tree, proving the walk recurses', () => {
    makePackedApp(tmpRoot);
    // Exact counts: a non-recursive walk would report 1 file / 2 dirs.
    expect(assertPackagedAppContents(tmpRoot)).toEqual({ files: 4, dirs: 6, symlinks: 0 });
  });

  it('names every disallowed top-level entry in a single throw', () => {
    const app = makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(app, 'e2e'));
    fs.mkdirSync(path.join(app, 'specs'));
    fs.writeFileSync(path.join(app, 'playwright.config.ts'), 'cfg');

    let captured;
    try {
      assertPackagedAppContents(tmpRoot);
    } catch (err) {
      captured = err;
    }
    expect(captured?.message).toMatch(/disallowed top-level path/i);
    expect(captured.message).toContain('e2e');
    expect(captured.message).toContain('specs');
    expect(captured.message).toContain('playwright.config.ts');
  });

  // Skipped on Windows: NTFS forbids a newline in a file name, so the fixture
  // cannot be built there - and the threat it models (a dependency shipping a
  // file whose name embeds a newline) cannot occur on Windows for the same
  // reason. The quoting itself (formatOffenders -> JSON.stringify) is
  // platform-agnostic and is exercised here on macOS/Linux CI.
  // See docs/windows/known-flakes.md.
  it.skipIf(process.platform === 'win32')(
    'quotes offender names so a newline cannot forge a workflow command in the log',
    () => {
    const app = makePackedApp(tmpRoot);
    // A hostile dependency could name a top-level entry with an embedded newline;
    // unquoted, it would forge a `::error::` line in the public release log.
    fs.mkdirSync(path.join(app, 'evil\n::error::forged'));

    let captured;
    try {
      assertPackagedAppContents(tmpRoot);
    } catch (err) {
      captured = err;
    }
    // JSON.stringify turns the newline into a literal \n, so no bare newline
    // followed by ::error:: survives into the message.
    expect(captured?.message).not.toMatch(/\n::error::/);
    expect(captured.message).toContain('\\n::error::forged');
  });

  it('truncates the offender list to 20 with a (+N more) suffix', () => {
    const app = makePackedApp(tmpRoot);
    for (let i = 0; i < 25; i++) fs.mkdirSync(path.join(app, `x${String(i).padStart(2, '0')}`));

    let captured;
    try {
      assertPackagedAppContents(tmpRoot);
    } catch (err) {
      captured = err;
    }
    expect(captured?.message).toContain('(+5 more)');
  });

  // chmod 0 has no effect on Windows and is bypassed by root, so skip both -
  // this exercises readDirOrThrow's fail-closed catch on a mid-walk subtree,
  // which a `catch { return [] }` mutation would turn into a silent skip.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses to ship when a nested subtree cannot be read (fails closed, not skipped)',
    () => {
      const app = makePackedApp(tmpRoot);
      const locked = path.join(app, 'node_modules', 'locked');
      fs.mkdirSync(locked, { recursive: true });
      fs.writeFileSync(path.join(locked, 'x'), 'x');
      fs.chmodSync(locked, 0o000);
      try {
        expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/could not be fully inspected/i);
      } finally {
        fs.chmodSync(locked, 0o755); // let afterEach clean it up
      }
    }
  );

  it('rejects an untracked dot-directory (the local-only case from #43)', () => {
    const app = makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(app, '.erfana'), { recursive: true });
    fs.writeFileSync(path.join(app, '.erfana', 'settings.json'), '{}');

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/\.erfana/);
  });

  it('rejects a bundle missing an allowed entry (the allowlist-too-narrow direction)', () => {
    const app = makePackedApp(tmpRoot);
    fs.rmSync(path.join(app, 'node_modules'), { recursive: true, force: true });

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/missing 1 expected top-level path/i);
  });

  it('allows nesting under an allowed root and still walks to the bottom of it', () => {
    const app = makePackedApp(tmpRoot);
    const deep = path.join(app, 'node_modules', 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    // A file merely NAMED e2e, deep inside node_modules, is legitimate.
    fs.writeFileSync(path.join(deep, 'e2e'), 'dep payload');

    // +1 file and +3 dirs over the clean baseline proves the walk reached depth 5.
    expect(assertPackagedAppContents(tmpRoot)).toEqual({ files: 5, dirs: 9, symlinks: 0 });
  });

  it('honours a caller-supplied allowed set', () => {
    makePackedApp(tmpRoot);
    expect(() => assertPackagedAppContents(tmpRoot, { allowed: ['out', 'node_modules'] }))
      .toThrow(/package\.json/);
  });

  it('checks the depth-1 allowlist before walking, so a repo-sized bundle fails fast', () => {
    const app = makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(app, 'release'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-bundle-'));
    try {
      fs.symlinkSync(outside, path.join(app, 'node_modules', 'leak'), 'junction');
      // Both violations present: pass 1 must win.
      expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/disallowed top-level path/i);
      expect(() => assertPackagedAppContents(tmpRoot)).not.toThrow(/resolving outside/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked app/ root rather than following it', () => {
    const real = path.join(tmpRoot, 'real');
    fs.mkdirSync(real);
    makePackedApp(real);
    fs.symlinkSync(path.join(real, 'app'), path.join(tmpRoot, 'app'), 'junction');

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/is a symlink/i);
  });

  it('throws when app/ is missing entirely', () => {
    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/app directory not found/i);
  });

  it('refuses an asar-packed bundle unless the skip is explicitly opted into', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.asar'), 'asar');
    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/no explicit allowAsar/i);
  });

  it('skips with a warning only when allowAsar is set', () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.asar'), 'asar');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(assertPackagedAppContents(tmpRoot, { allowAsar: true }).skipped).toBe('asar');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('app.asar'));
  });

  it("falls back to Node's own default (index.js) when the manifest declares no main", () => {
    const app = makePackedApp(tmpRoot);
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'erfana' }));

    // Node's default is index.js at the package root - not this app's build
    // path. Nothing is there, so the bundle genuinely cannot start and the
    // guard says so. Under this allowlist index.js is not even a permitted
    // top-level entry, so a manifest with no main can never pass: correct, since
    // such a bundle would not launch.
    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/no main entry file at index\.js/i);
  });

  it('distinguishes a missing manifest from an unreadable one', () => {
    const app = makePackedApp(tmpRoot);
    fs.rmSync(path.join(app, 'package.json'));
    expect(() => assertPackagedAppContents(tmpRoot, { allowed: ['out', 'node_modules'] }))
      .toThrow(/no app\/package\.json/i);

    makePackedApp(tmpRoot);
    fs.writeFileSync(path.join(app, 'package.json'), '{ not json');
    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/not readable as JSON/i);
  });

  it('throws when the declared main entry is absent', () => {
    const app = makePackedApp(tmpRoot);
    fs.rmSync(path.join(app, 'out', 'main', 'index.js'));

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/no main entry file/i);
  });

  it('rejects a main entry that escapes the bundle via .. even when the target exists', () => {
    const app = makePackedApp(tmpRoot);
    // A real file one level ABOVE app/. `existsSync` alone would accept it, so
    // only the containment check (`!inside(mainPath)`) can reject this - which is
    // what makes the test discriminate the traversal guard from plain absence.
    fs.writeFileSync(path.join(tmpRoot, 'decoy.js'), 'not shipped');
    fs.writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'erfana', main: '../decoy.js' })
    );

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/no main entry file/i);
  });

  it('rejects a main entry that resolves to a directory', () => {
    const app = makePackedApp(tmpRoot);
    fs.writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify({ name: 'erfana', main: './out/main' })
    );

    expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/no main entry file/i);
  });

  it('warns about unexpected entries beside app/ without failing the build', () => {
    makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'unexpected-extra'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => assertPackagedAppContents(tmpRoot)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpected-extra'));
  });

  it('does not warn about the real extraResources siblings or *.lproj folders', () => {
    // A realistic Contents/Resources: app/ plus the extraResources outputs and
    // Electron's localisation folders. Emptying EXPECTED_RESOURCES_ENTRIES or
    // dropping the .lproj exemption would make this warn - so it pins both.
    makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'tessdata'));
    fs.writeFileSync(path.join(tmpRoot, 'LICENSE'), 'x');
    fs.mkdirSync(path.join(tmpRoot, 'en.lproj'));
    fs.mkdirSync(path.join(tmpRoot, 'pl.lproj'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => assertPackagedAppContents(tmpRoot)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  // Escape detection is the security property here, so the escape test runs on
  // every platform - it links to a DIRECTORY, and a junction needs no elevation
  // on Windows. The dangling and relative-file cases below cannot: Node
  // autodetects type 'file' for them, which needs SeCreateSymbolicLinkPrivilege
  // (Developer Mode or elevation). Registered in docs/windows/known-flakes.md
  // under the `scripts/fuses.test.mjs (assertPackagedAppContents > symlinks)` row.
  describe('symlinks', () => {
    const dirLinkType = process.platform === 'win32' ? 'junction' : undefined;

    it('throws when a symlink resolves outside the bundle', () => {
      const app = makePackedApp(tmpRoot);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-bundle-'));
      try {
        fs.writeFileSync(path.join(outside, 'secret'), 'nope');
        fs.symlinkSync(outside, path.join(app, 'node_modules', 'leak'), dirLinkType);

        expect(() => assertPackagedAppContents(tmpRoot)).toThrow(/resolving outside app/i);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it.skipIf(process.platform === 'win32')('throws on a dangling symlink on darwin, where Gatekeeper rejects the bundle', () => {
      const app = makePackedApp(tmpRoot);
      fs.symlinkSync(path.join(app, 'node_modules', 'gone'), path.join(app, 'node_modules', 'dangling'));

      expect(() => assertPackagedAppContents(tmpRoot, { platform: 'darwin' }))
        .toThrow(/unresolvable symlink/i);
    });

    it.skipIf(process.platform === 'win32')('only warns about a dangling symlink off darwin', () => {
      const app = makePackedApp(tmpRoot);
      fs.symlinkSync(path.join(app, 'node_modules', 'gone'), path.join(app, 'node_modules', 'dangling'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => assertPackagedAppContents(tmpRoot, { platform: NON_DARWIN })).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unresolvable symlink'));
    });

    it('allows an absolute link into a permitted root on darwin but not elsewhere', () => {
      // TN2206: Gatekeeper permits bundle links into /System and /Library. That
      // rule is exercised here against an INJECTED root (a real temp dir that
      // exists on every runner), not the macOS-only /System - so the darwin-allow
      // and non-darwin-reject branches both run on Linux and Windows CI too.
      // The root is realpath'd: symlink targets are compared after realpathSync,
      // and on macOS os.tmpdir() (/var/...) canonicalises to /private/var/....
      const app = makePackedApp(tmpRoot);
      const permittedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'permitted-')));
      try {
        fs.symlinkSync(permittedRoot, path.join(app, 'node_modules', 'sys'), dirLinkType);

        expect(() =>
          assertPackagedAppContents(tmpRoot, {
            platform: 'darwin',
            allowedAbsoluteLinkRoots: [permittedRoot],
          })
        ).not.toThrow();
        expect(() =>
          assertPackagedAppContents(tmpRoot, {
            platform: 'linux',
            allowedAbsoluteLinkRoots: [permittedRoot],
          })
        ).toThrow(/resolving outside app/i);
      } finally {
        fs.rmSync(permittedRoot, { recursive: true, force: true });
      }
    });

    it('enters the win32 case-insensitive containment branch without a Windows host', () => {
      // `platform` is a pure argument, so the win32 norm() lower-casing runs on
      // any host. A clean bundle must pass (a `const norm = p => p` mutation would
      // still pass here, but the escape case below forces the branch to matter).
      makePackedApp(tmpRoot);
      expect(assertPackagedAppContents(tmpRoot, { platform: 'win32' })).toEqual({
        files: 4,
        dirs: 6,
        symlinks: 0,
      });
    });

    it('rejects a win32 escaping symlink (case-folded containment still catches it)', () => {
      const app = makePackedApp(tmpRoot);
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-win-'));
      try {
        fs.symlinkSync(outside, path.join(app, 'node_modules', 'leak'), dirLinkType);
        expect(() => assertPackagedAppContents(tmpRoot, { platform: 'win32' }))
          .toThrow(/resolving outside app/i);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it.skipIf(process.platform === 'win32')('accepts an intra-bundle relative symlink (npm .bin style)', () => {
      const app = makePackedApp(tmpRoot);
      const bin = path.join(app, 'node_modules', '.bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.symlinkSync(path.join('..', 'node-pty', 'index.js'), path.join(bin, 'pty'));

      expect(assertPackagedAppContents(tmpRoot).symlinks).toBe(1);
    });
  });
});
