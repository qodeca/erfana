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
  mergeExtraContent,
  assertExtraContentAllowlist,
  resolveExtraFilesDir,
  verifyExtraContent,
  assertResourcesDestNoRepoLeak,
  assertResourcesSiblingsAllowlist,
  assertExtraFilesDestNoRepoLeak,
  ALLOWED_EXTRA_RESOURCES_DESTS,
  ALLOWED_EXTRA_RESOURCES_FROM,
  ALLOWED_EXTRA_FILES_DESTS,
  EXPECTED_RESOURCES_ENTRIES,
  REPO_ROOT_SENTINELS,
  SUSPICIOUS_SIBLING_NAMES,
  EXTRA_CONTENT_LEAK_NAMES,
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

    // --- Extra-content binding (issue #55, F1/F4/F5) ---
    // This is the AUTHORITATIVE extraResources/extraFiles shape validation: it
    // parses the real config and runs in the required Unit-tests job, whereas the
    // checks.yml awk guard is only a coarse presence check.
    // Top-level extraResources binds to the constant.
    expect(
      assertExtraContentAllowlist(mergeExtraContent(config.extraResources, undefined), {
        kind: 'extraResources',
        allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS,
      })
    ).toEqual([...ALLOWED_EXTRA_RESOURCES_DESTS].sort());

    // Pin the `from:` side too, not just `to:`. The dest-allowlist above only
    // constrains where copies LAND; it would still pass if someone changed
    // `from: resources/tessdata` → `from: src` while keeping `to: tessdata`,
    // smuggling source into an allowlisted dest. Bind the real `from` values to
    // an expected set so that edit fails the required Unit-tests job (issue #55).
    expect(
      mergeExtraContent(config.extraResources, undefined)
        .map((e) => e.from)
        .sort()
    ).toEqual(['LICENSE', 'THIRD-PARTY-LICENSES.md', 'resources/tessdata']);

    // Absence of extraFiles is intentional — top-level AND platform-scoped (F1).
    expect(config.extraFiles).toBeUndefined();
    expect(config.mac?.extraFiles).toBeUndefined();
    expect(config.mac?.extraResources).toBeUndefined();
    expect(config.win?.extraFiles).toBeUndefined();
    expect(config.win?.extraResources).toBeUndefined();

    // Subset drift guard (F5): every config slot is a full-sibling entry, so the
    // relation ALLOWED_EXTRA_RESOURCES_DESTS ⊆ EXPECTED_RESOURCES_ENTRIES holds.
    expect(
      ALLOWED_EXTRA_RESOURCES_DESTS.every((d) => EXPECTED_RESOURCES_ENTRIES.includes(d))
    ).toBe(true);

    // F1 wiring: verifyExtraContent (the extracted aggregate of the five #55
    // guard calls) is exported (checked here) AND its call site inside afterPack
    // is asserted by a source-reference check below — the export alone would stay
    // green if afterPack stopped calling it. Together these mirror the
    // afterPack/afterSign text binding above so either removal fails this job.
    expect(typeof verifyExtraContent).toBe('function');

    // F1 call-site (QG-6/7/8): the export check above proves verifyExtraContent
    // EXISTS, not that afterPack still invokes it — deleting the
    // `verifyExtraContent(context, …)` line from afterPack would pass every other
    // test. Read fuses.js and assert the afterPack function body itself calls it,
    // so that deletion fails the required Unit-tests job. Mirrors the
    // config.afterPack === './scripts/fuses.js' text binding above.
    const fusesSrc = fs.readFileSync(path.join(import.meta.dirname, 'fuses.js'), 'utf8');
    const afterPackStart = fusesSrc.indexOf('async function afterPack(');
    expect(afterPackStart).toBeGreaterThan(-1);
    const afterPackBody = fusesSrc.slice(
      afterPackStart,
      fusesSrc.indexOf('module.exports = afterPack;')
    );
    expect(afterPackBody).toMatch(/verifyExtraContent\s*\(\s*context/);

    // F5 provenance: the real extraResources `from` values are exactly the
    // runtime source allowlist, so a `from: src` rename is rejected at pack time.
    expect([...ALLOWED_EXTRA_RESOURCES_FROM].sort()).toEqual(
      mergeExtraContent(config.extraResources, undefined)
        .map((e) => e.from)
        .sort()
    );
  });

  // F2 — pin the exfil leak-name NET membership, not just its subset relation.
  // Removing `.env`/`id_rsa`/any name from these literals fails CI, so the
  // both-platforms-fatal L2a-1 tripwire cannot be silently narrowed.
  it('pins the extra-content leak-name net membership (F2)', () => {
    expect([...REPO_ROOT_SENTINELS]).toEqual([
      'package.json', 'package-lock.json', '.git', 'node_modules', 'src', 'specs',
      'scripts', 'docs', 'e2e', '.github', 'electron-builder.yml', 'CLAUDE.md',
      'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json',
    ]);
    expect([...SUSPICIOUS_SIBLING_NAMES]).toEqual([
      'secrets', 'secret', 'credentials', 'creds', '.env', '.env.local',
      '.npmrc', '.aws', '.ssh', 'api-keys', 'apikeys', 'private', 'id_rsa',
    ]);
    // EXTRA_CONTENT_LEAK_NAMES is exactly the concatenation of the two sets.
    expect([...EXTRA_CONTENT_LEAK_NAMES]).toEqual([
      ...REPO_ROOT_SENTINELS,
      ...SUSPICIOUS_SIBLING_NAMES,
    ]);
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

  it('no longer inspects entries beside app/ (moved to the issue #55 extra-content guards)', () => {
    // The beside-app/ advisory was extracted into
    // assertResourcesDestNoRepoLeak / assertResourcesSiblingsAllowlist, so
    // this walk neither warns nor throws on a stray sibling; those guards run
    // separately in afterPack and are covered by their own describe blocks below.
    makePackedApp(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, 'unexpected-extra'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => assertPackagedAppContents(tmpRoot)).not.toThrow();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('unexpected-extra'));
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

// ---- Extra-content guards (issue #55) -------------------------------------

// Windows needs an explicit link type for directory symlinks (a junction needs
// no elevation); POSIX autodetects. Shared by the extra-content symlink tests.
const dirLinkType = process.platform === 'win32' ? 'junction' : undefined;

// The real extraResources FileSet as shipped in electron-builder.yml.
const REAL_EXTRA_RESOURCES = [
  { from: 'resources/tessdata', to: 'tessdata', filter: ['**/*'] },
  { from: 'LICENSE', to: 'LICENSE' },
  { from: 'THIRD-PARTY-LICENSES.md', to: 'THIRD-PARTY-LICENSES.md' },
];

// A resources dir mirroring Contents/Resources: app/ plus the given siblings.
function makeResourcesDir(root, siblings = []) {
  makePackedApp(root); // creates root/app/{out,node_modules,package.json}
  for (const name of siblings) {
    const full = path.join(root, name);
    if (name.includes('.') && !name.endsWith('.lproj')) {
      fs.writeFileSync(full, 'x'); // dotted name → treat as a file
    } else {
      fs.mkdirSync(full, { recursive: true });
    }
  }
  return root;
}

describe('assertExtraContentAllowlist (L1)', () => {
  const R = { kind: 'extraResources', allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS };
  // Use the exported constant (not an inline []) so this describe notices if
  // ALLOWED_EXTRA_FILES_DESTS is ever populated — the empty-allowlist reject-all
  // contract (F7) would then need re-checking.
  const F = { kind: 'extraFiles', allowedDests: ALLOWED_EXTRA_FILES_DESTS };

  it('accepts the real extraResources and returns the sorted dest set (AC5)', () => {
    expect(assertExtraContentAllowlist(REAL_EXTRA_RESOURCES, R))
      .toEqual([...ALLOWED_EXTRA_RESOURCES_DESTS].sort());
  });

  it('accepts nothing-configured (undefined) with an empty allowlist → [] (F7 accept)', () => {
    expect(assertExtraContentAllowlist(undefined, F)).toEqual([]);
  });

  it('accepts an empty array with an empty allowlist → [] (F7 boundary)', () => {
    expect(assertExtraContentAllowlist([], F)).toEqual([]);
  });

  it('rejects ANY entry against an empty allowlist (F7 reject-all)', () => {
    expect(() => assertExtraContentAllowlist(['x'], F)).toThrow(/nothing is permitted/i);
    expect(() => assertExtraContentAllowlist([{ from: 'x', to: 'x' }], F))
      .toThrow(/nothing is permitted/i);
  });

  it.each(['.', '', './'])('rejects a root-sweep from %j', (from) => {
    expect(() => assertExtraContentAllowlist([{ from, to: 'tessdata' }], R))
      .toThrow(/root sweep|whole tree/i);
  });

  it('rejects a from that escapes the project root', () => {
    expect(() => assertExtraContentAllowlist([{ from: '../secrets', to: 'tessdata' }], R))
      .toThrow(/escapes the project root/i);
  });

  it.each(['.', '', '/'])('rejects a to of %j', (to) => {
    // '.'/'' hit the destination-root branch; '/' hits the absolute-path branch —
    // one pattern covers both so the assertion is specific, not a bare toThrow().
    expect(() => assertExtraContentAllowlist([{ from: 'LICENSE', to }], R))
      .toThrow(/destination root|escapes the destination/i);
  });

  it('rejects a to that escapes the destination', () => {
    expect(() => assertExtraContentAllowlist([{ from: 'LICENSE', to: '../elsewhere' }], R))
      .toThrow(/escapes/i);
  });

  it('rejects a to whose first segment is not in the allowlist', () => {
    expect(() => assertExtraContentAllowlist([{ from: 'notes', to: 'notes' }], R))
      .toThrow(/destination .* not permitted/i);
  });

  it('fails closed on a to-absent FileSet (F8 negative) and accepts its to-present counterpart', () => {
    expect(() => assertExtraContentAllowlist([{ from: 'LICENSE' }], R)).toThrow(/cannot map/i);
    expect(assertExtraContentAllowlist([{ from: 'LICENSE', to: 'LICENSE' }], R)).toEqual(['LICENSE']);
  });

  it('fails closed on an unmappable entry shape (bare number / empty object)', () => {
    expect(() => assertExtraContentAllowlist([42], R)).toThrow(/cannot map/i);
    expect(() => assertExtraContentAllowlist([{}], R)).toThrow(/cannot map/i);
  });

  // F7 — additional fail-closed input branches: a non-string `to`, the `./`
  // dest-root form, a null entry, and a nested-array entry all throw.
  it('fails closed on a non-string to (F7)', () => {
    expect(() => assertExtraContentAllowlist([{ from: 'LICENSE', to: 42 }], R))
      .toThrow(/cannot map/i);
  });

  it('rejects a to of "./" (dest root, F7)', () => {
    expect(() => assertExtraContentAllowlist([{ from: 'LICENSE', to: './' }], R))
      .toThrow(/destination root/i);
  });

  it('fails closed on a null entry (F7)', () => {
    expect(() => assertExtraContentAllowlist([null], R)).toThrow(/cannot map/i);
  });

  it('fails closed on a nested-array entry (F7)', () => {
    expect(() => assertExtraContentAllowlist([['x']], R)).toThrow(/cannot map/i);
  });

  // F5 — runtime `from`-provenance: with an `allowedFrom` set (as afterPack
  // supplies for extraResources), a `from: src` renamed INTO an allowlisted dest
  // is rejected at pack time, not only by the test-layer from-binding.
  it('rejects a from renamed into an allowlisted dest when allowedFrom is set (F5)', () => {
    expect(() =>
      assertExtraContentAllowlist([{ from: 'src', to: 'tessdata' }], {
        kind: 'extraResources',
        allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS,
        allowedFrom: ALLOWED_EXTRA_RESOURCES_FROM,
      })
    ).toThrow(/not an allowlisted extra-content source/i);
  });

  it('accepts the real extraResources under allowedFrom (F5 no-false-positive)', () => {
    expect(
      assertExtraContentAllowlist(REAL_EXTRA_RESOURCES, {
        kind: 'extraResources',
        allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS,
        allowedFrom: ALLOWED_EXTRA_RESOURCES_FROM,
      })
    ).toEqual([...ALLOWED_EXTRA_RESOURCES_DESTS].sort());
  });

  it.each([42, { nested: true }, ['array']])(
    'fails closed on a present-but-non-string from (%j)',
    (from) => {
      expect(() => assertExtraContentAllowlist([{ from, to: 'tessdata' }], R))
        .toThrow(/cannot map/i);
    }
  );

  it('rejects a --config.win.extraFiles=[{from:".",to:"."}] merge (F1 bypass, AC2)', () => {
    // The exact --config.win.extraFiles override shape build_win.yml could carry.
    expect(() =>
      assertExtraContentAllowlist(mergeExtraContent(undefined, [{ from: '.', to: '.' }]), F)
    ).toThrow(/nothing is permitted/i);
  });

  it('rejects a mac.extraResources merge adding an un-allowlisted dest (F1, AC2)', () => {
    expect(() =>
      assertExtraContentAllowlist(
        mergeExtraContent(REAL_EXTRA_RESOURCES, [{ from: 'src', to: 'src' }]),
        R
      )
    ).toThrow(/destination .* not permitted/i);
  });
});

describe('mergeExtraContent', () => {
  it('concatenates top-level and platform-scoped entries', () => {
    expect(mergeExtraContent([{ to: 'a' }], [{ to: 'b' }])).toEqual([{ to: 'a' }, { to: 'b' }]);
  });

  it('tolerates either side undefined', () => {
    expect(mergeExtraContent([{ to: 'a' }], undefined)).toEqual([{ to: 'a' }]);
    expect(mergeExtraContent(undefined, [{ to: 'b' }])).toEqual([{ to: 'b' }]);
  });

  it('returns [] when both are undefined', () => {
    expect(mergeExtraContent(undefined, undefined)).toEqual([]);
  });

  it('wraps a scalar value into a single-entry array', () => {
    expect(mergeExtraContent('LICENSE', undefined)).toEqual(['LICENSE']);
  });
});

describe('L1 merged-config observation (F6)', () => {
  // Full electron-builder invocation is too heavy for the unit suite, so this is
  // the documented fallback (design §5.7): it asserts the afterPack wiring reads
  // BOTH context.packager.config.extra* AND
  // context.packager.platformSpecificBuildOptions.extra*, which is where a
  // --config.win.extraResources override lands. The ONE-TIME manual check that
  // electron-builder actually surfaces --config overrides in these fields is
  // recorded in docs (§7) and re-run per the release checklist.
  it('observes both a top-level and a platform-scoped override via the context shape', () => {
    const context = {
      packager: {
        config: { extraResources: [{ from: 'x', to: 'x' }] },
        platformSpecificBuildOptions: { extraResources: [{ from: 'src', to: 'src' }] },
      },
    };
    const merged = mergeExtraContent(
      context.packager.config.extraResources,
      context.packager.platformSpecificBuildOptions.extraResources
    );
    expect(merged).toEqual([{ from: 'x', to: 'x' }, { from: 'src', to: 'src' }]);
    // The platform-scoped 'src' dest is not allowlisted, so L1 rejects the merge.
    expect(() =>
      assertExtraContentAllowlist(merged, {
        kind: 'extraResources',
        allowedDests: ALLOWED_EXTRA_RESOURCES_DESTS,
      })
    ).toThrow(/destination .* not permitted/i);
  });
});

describe('resolveExtraFilesDir', () => {
  it('resolves darwin under the .app bundle Contents/', () => {
    expect(resolveExtraFilesDir('darwin', '/out', '/out/Erfana.app'))
      .toBe(path.join('/out/Erfana.app', 'Contents'));
  });

  it('resolves win32 and linux to the app output root', () => {
    expect(resolveExtraFilesDir('win32', '/out', '/out/Erfana.exe')).toBe('/out');
    expect(resolveExtraFilesDir('linux', '/out', '/out/erfana')).toBe('/out');
  });

  it('returns null for an unknown platform so the caller fails closed', () => {
    expect(resolveExtraFilesDir('sunos', '/out', '/out/x')).toBeNull();
  });
});

describe('assertResourcesDestNoRepoLeak (L2a-1)', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l2a1-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes when the config-slot siblings are exactly the allowed set (AC5)', () => {
    makeResourcesDir(tmpRoot, ['tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md', 'en.lproj']);
    expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'darwin' })).not.toThrow();
    expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'win32' })).not.toThrow();
  });

  // A repo-structure sentinel (`src`) AND a secret/exfil leak-name (`secrets`)
  // must BOTH be fatal on BOTH platforms — the config leak vector a
  // --config.win.extraResources=[{to:'src'}] / [{to:'secrets'}] injection
  // produces. Fatal on every platform (F2), including win32 where L2a-2 is only
  // advisory.
  describe.each([
    ['src', 'repo-structure sentinel'],
    ['secrets', 'secret/exfil leak-name'],
  ])('fatal beside app/ for %s (%s)', (leakName) => {
    it.each(['darwin', 'win32'])('throws on platform=%s', (platform) => {
      makeResourcesDir(tmpRoot, ['tessdata', leakName]);
      expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform }))
        .toThrow(/not permitted extraResources destinations/i);
    });
  });

  // F5 — an escaping sibling symlink beside app/ is fatal regardless of its name
  // (the leak-name tripwire only inspects names).
  it('fails closed on an escaping sibling symlink beside app/ (F5)', () => {
    makeResourcesDir(tmpRoot, ['tessdata']);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'l2a1-outside-'));
    try {
      fs.symlinkSync(outside, path.join(tmpRoot, 'leak'), dirLinkType);
      expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'darwin' }))
        .toThrow(/resolving outside/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('accepts a sibling symlink whose target stays inside the bundle (F5 negative)', () => {
    makeResourcesDir(tmpRoot, ['tessdata']);
    fs.symlinkSync(path.join(tmpRoot, 'tessdata'), path.join(tmpRoot, 'tessdata-link'), dirLinkType);
    expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'darwin' })).not.toThrow();
  });

  // F3 — the fail-closed readDirOrThrow path: a resources dir that cannot be
  // read refuses to ship rather than silently skipping (a `catch { return [] }`
  // mutation would turn this into a green build).
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses to ship when the resources dir cannot be read (fails closed) (F3)',
    () => {
      makeResourcesDir(tmpRoot, ['tessdata']);
      fs.chmodSync(tmpRoot, 0o000);
      try {
        expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'darwin' }))
          .toThrow(/could not be fully inspected/i);
      } finally {
        fs.chmodSync(tmpRoot, 0o755); // let afterEach clean it up
      }
    }
  );
});

describe('assertResourcesSiblingsAllowlist (L2a-2)', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l2a2-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes (no throw, no warn) on a realistic resources dir (AC5)', () => {
    makeResourcesDir(tmpRoot, ['tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md', 'en.lproj', 'pl.lproj']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'darwin' })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts app.asar in place of app/ (pins the derived Electron-owned entry)', () => {
    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'app.asar'), 'asar');
    fs.mkdirSync(path.join(tmpRoot, 'tessdata'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'win32' })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('is FATAL on macOS for an unexpected non-config, non-.lproj sibling', () => {
    makeResourcesDir(tmpRoot, ['tessdata', 'icon-extra', 'stray.dat']);
    expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'darwin' }))
      .toThrow(/unexpected/i);
  });

  it('is ADVISORY (warn, no throw) on win32 for the same unexpected sibling (F2)', () => {
    makeResourcesDir(tmpRoot, ['tessdata', 'icon-extra', 'stray.dat']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'win32' })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stray.dat'));
  });

  it('still fails on win32 through L2a-1 when a REPO_ROOT_SENTINEL landed beside app/', () => {
    // L2a-2 is advisory on win32, but a sentinel is a fortiori caught fatally by
    // L2a-1 on every platform, so the config leak vector is never softened.
    makeResourcesDir(tmpRoot, ['src']);
    expect(() => assertResourcesDestNoRepoLeak(tmpRoot, { platform: 'win32' }))
      .toThrow(/not permitted extraResources destinations/i);
  });

  // F5 — the escaping-symlink check runs ahead of the platform-variant
  // enumeration and is fatal on BOTH platforms, even win32 where the enumeration
  // is only advisory.
  it.each(['darwin', 'win32'])('fails closed on an escaping sibling symlink on %s (F5)', (platform) => {
    makeResourcesDir(tmpRoot, ['tessdata']);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'l2a2-outside-'));
    try {
      fs.symlinkSync(outside, path.join(tmpRoot, 'leak'), dirLinkType);
      expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform }))
        .toThrow(/resolving outside/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('accepts a sibling symlink whose target stays inside the bundle (F5 negative)', () => {
    makeResourcesDir(tmpRoot, ['tessdata']);
    // Named `*.lproj` so the enumeration accepts it; target inside → no escape.
    fs.symlinkSync(path.join(tmpRoot, 'tessdata'), path.join(tmpRoot, 'fr.lproj'), dirLinkType);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'darwin' })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  // F3 — fail-closed readDirOrThrow path (the symlink pre-walk reads the dir).
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses to ship when the resources dir cannot be read (fails closed) (F3)',
    () => {
      makeResourcesDir(tmpRoot, ['tessdata']);
      fs.chmodSync(tmpRoot, 0o000);
      try {
        expect(() => assertResourcesSiblingsAllowlist(tmpRoot, { platform: 'darwin' }))
          .toThrow(/could not be fully inspected/i);
      } finally {
        fs.chmodSync(tmpRoot, 0o755); // let afterEach clean it up
      }
    }
  );
});

describe('assertExtraFilesDestNoRepoLeak (L2b)', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l2b-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedMacContents(root) {
    fs.writeFileSync(path.join(root, 'Info.plist'), '<plist/>');
    fs.mkdirSync(path.join(root, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(root, 'MacOS', 'Erfana'), 'macho');
    fs.mkdirSync(path.join(root, 'Frameworks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Resources'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Resources', 'app'), { recursive: true });
  }

  function seedWinRoot(root) {
    fs.writeFileSync(path.join(root, 'Erfana.exe'), 'exe');
    fs.writeFileSync(path.join(root, 'ffmpeg.dll'), 'dll');
    fs.writeFileSync(path.join(root, 'icudtl.dat'), 'dat');
    fs.mkdirSync(path.join(root, 'locales'), { recursive: true });
    fs.writeFileSync(path.join(root, 'locales', 'en-US.pak'), 'pak');
    fs.mkdirSync(path.join(root, 'resources', 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'resources', 'THIRD-PARTY-LICENSES.md'), 'md');
  }

  it('passes on a standard macOS Contents/ layout (AC5)', () => {
    seedMacContents(tmpRoot);
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'darwin' })).not.toThrow();
  });

  it('passes on a standard Windows output-root layout (AC5)', () => {
    seedWinRoot(tmpRoot);
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' })).not.toThrow();
  });

  it.each(['package.json', '.git', 'node_modules', 'src', 'specs', 'tsconfig.json'])(
    'throws on a %s sentinel at depth 1',
    (sentinel) => {
      seedWinRoot(tmpRoot);
      if (sentinel.includes('.')) {
        fs.writeFileSync(path.join(tmpRoot, sentinel), 'x');
      } else {
        fs.mkdirSync(path.join(tmpRoot, sentinel), { recursive: true });
      }
      expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' }))
        .toThrow(/repository\/extra-content leak/i);
    }
  );

  it.each(['src', 'package.json'])(
    'recurses ≥2 levels to catch a nested bundled/%s (F3)',
    (sentinel) => {
      seedMacContents(tmpRoot);
      const bundled = path.join(tmpRoot, 'bundled');
      fs.mkdirSync(bundled, { recursive: true });
      if (sentinel.includes('.')) {
        fs.writeFileSync(path.join(bundled, sentinel), 'x');
      } else {
        fs.mkdirSync(path.join(bundled, sentinel), { recursive: true });
      }
      expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'darwin' }))
        .toThrow(/repository\/extra-content leak/i);
    }
  );

  it.each(['secret.ts', 'secret.js', 'secret.cjs', 'secret.mjs'])(
    'fires the source-extension tripwire on a renamed copy (%s) (F3)',
    (renamed) => {
      seedWinRoot(tmpRoot);
      fs.writeFileSync(path.join(tmpRoot, renamed), 'export const leak = 1;');
      expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' }))
        .toThrow(/repository\/extra-content leak/i);
    }
  );

  it.each(['darwin', 'win32'])(
    'tolerates the app\'s own .js at depth ≥3 on %s despite .js in the source-extension net (F6)',
    (platform) => {
      // Seed a REAL .js — the app's own JavaScript, which in a genuine bundle
      // lives at `(Resources|resources)/app/out/**` (depth ≥3, beyond MAX_DEPTH=2).
      // Without this file the .not.toThrow() below was vacuous: it discriminated
      // nothing about the .js net. With it, a walk that OVER-FIRES by descending
      // past MAX_DEPTH would flag this legitimate .js and fail the test (F6).
      const appRoot = platform === 'darwin' ? 'Resources' : 'resources';
      if (platform === 'darwin') {
        seedMacContents(tmpRoot);
      } else {
        seedWinRoot(tmpRoot);
      }
      const outDir = path.join(tmpRoot, appRoot, 'app', 'out', 'main');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.js'), 'export const main = 1;');
      expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform })).not.toThrow();
    }
  );

  it('does not throw on resources/ or LICENSE at the root (excluded from sentinels)', () => {
    seedWinRoot(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'LICENSE'), 'x');
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' })).not.toThrow();
  });

  it('throws when the extraFiles dest does not exist (fails closed)', () => {
    expect(() => assertExtraFilesDestNoRepoLeak(path.join(tmpRoot, 'missing'), { platform: 'darwin' }))
      .toThrow(/not found/i);
  });

  // F3 — fail-closed readDirOrThrow path on a mid-walk subtree the sentinel scan
  // descends into, so a `catch { return [] }` silent-skip mutation fails here.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses to ship when a subtree at the extraFiles dest cannot be read (fails closed) (F3)',
    () => {
      seedWinRoot(tmpRoot);
      const locked = path.join(tmpRoot, 'sub');
      fs.mkdirSync(locked, { recursive: true });
      fs.writeFileSync(path.join(locked, 'x'), 'x');
      fs.chmodSync(locked, 0o000);
      try {
        expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' }))
          .toThrow(/could not be fully inspected/i);
      } finally {
        fs.chmodSync(locked, 0o755); // let afterEach clean it up
      }
    }
  );

  // L2 — pin the MAX_DEPTH=2 boundary. The walk scans depth 1 (the dest's
  // direct children) and depth 2 (their children) only, so the legitimate
  // Resources/app/package.json (macOS) / resources/app/package.json (win32),
  // which sits at depth 3, is tolerated. These tests fail if MAX_DEPTH is bumped.
  it('tolerates the legitimate Resources/app/package.json at depth 3 (macOS, MAX_DEPTH boundary)', () => {
    seedMacContents(tmpRoot);
    // Resources (d1) / app (d2) / package.json (d3) — a sentinel name past the walk.
    fs.writeFileSync(path.join(tmpRoot, 'Resources', 'app', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, 'Resources', 'app', 'foo.ts'), 'export const x = 1;');
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'darwin' })).not.toThrow();
  });

  it('tolerates the legitimate resources/app/package.json at depth 3 (win32, MAX_DEPTH boundary)', () => {
    seedWinRoot(tmpRoot);
    // resources (d1) / app (d2) / package.json (d3) — a sentinel name past the walk.
    fs.writeFileSync(path.join(tmpRoot, 'resources', 'app', 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, 'resources', 'app', 'foo.ts'), 'export const x = 1;');
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' })).not.toThrow();
  });

  // L3 — the L2b symlink-skip branch: the sentinel/source-extension walk skips
  // symlinked entries (it never follows a link out of the dest), but F5's
  // assertNoSymlinkEscape now makes an escaping symlink at the dest FATAL. The
  // thrown error is the escape ("resolving outside"), NOT a repository-leak from
  // following the link into the sentinel tree — proving the walk did not descend.
  it('fails closed on a symlinked directory whose target escapes the dest (F5)', () => {
    seedMacContents(tmpRoot);
    // A tree full of sentinels living OUTSIDE the dest.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'l2b-outside-'));
    fs.writeFileSync(path.join(outside, 'package.json'), '{}');
    fs.writeFileSync(path.join(outside, 'leak.ts'), 'export const x = 1;');
    try {
      // An innocuously-named symlink at the dest pointing at that tree.
      fs.symlinkSync(outside, path.join(tmpRoot, 'vendored'), 'dir');
      let captured;
      try {
        assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'darwin' });
      } catch (err) {
        captured = err;
      }
      expect(captured?.message).toMatch(/resolving outside/i);
      // The escape fired, not a repository-leak from following the link.
      expect(captured?.message).not.toMatch(/repository\/extra-content leak/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('a symlink NAMED like a sentinel still throws via the name check', () => {
    seedWinRoot(tmpRoot);
    const target = path.join(tmpRoot, 'innocuous-target');
    fs.writeFileSync(target, 'x');
    // The link's NAME is a repo-root sentinel; the name check fires before any
    // symlink skip, so the leak is caught regardless of what it points at.
    fs.symlinkSync(target, path.join(tmpRoot, 'package.json'));
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' }))
      .toThrow(/repository\/extra-content leak/i);
  });

  it('a symlinked source-extension file is skipped by the extension tripwire', () => {
    seedWinRoot(tmpRoot);
    const target = path.join(tmpRoot, 'innocuous-target');
    fs.writeFileSync(target, 'export const x = 1;');
    // Named with a source extension but a symlink → the extension check requires
    // a non-symlink, so this is skipped rather than flagged (and must not crash).
    fs.symlinkSync(target, path.join(tmpRoot, 'linked.ts'));
    expect(() => assertExtraFilesDestNoRepoLeak(tmpRoot, { platform: 'win32' })).not.toThrow();
  });
});

// ---- verifyExtraContent — the wired aggregate of the five #55 guards (F1) ----
//
// This is the top lens-review finding: deleting any single guard call from
// afterPack was green on every required check. Extracting the block into
// verifyExtraContent lets a fabricated context + packed tree plant a leak at each
// layer and assert the aggregate throws, so removing any one call fails a test in
// the required Unit-tests job.
describe('verifyExtraContent (F1 wiring)', () => {
  let resDir; // bundleResources (the dir containing app/, beside the extraResources dest)
  let filesDir; // the resolved extraFiles dest

  beforeEach(() => {
    resDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-res-'));
    filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-files-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(resDir, { recursive: true, force: true });
    fs.rmSync(filesDir, { recursive: true, force: true });
  });

  // A clean afterPack-shaped context; `config`/`platformOpts` patch the merged
  // config the L1 guard reads. extraResources defaults to the real shipped set.
  function makeContext({ config = {}, platformOpts = {}, platform = 'darwin' } = {}) {
    return {
      electronPlatformName: platform,
      packager: {
        config: { extraResources: REAL_EXTRA_RESOURCES, ...config },
        platformSpecificBuildOptions: { ...platformOpts },
      },
    };
  }

  function seedCleanResources(siblings = ['tessdata', 'LICENSE', 'THIRD-PARTY-LICENSES.md', 'en.lproj']) {
    makeResourcesDir(resDir, siblings);
  }
  // A standard macOS Contents/ layout at the extraFiles dest (app under Resources/).
  function seedCleanExtraFiles() {
    fs.writeFileSync(path.join(filesDir, 'Info.plist'), '<plist/>');
    fs.mkdirSync(path.join(filesDir, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(filesDir, 'MacOS', 'Erfana'), 'macho');
    fs.mkdirSync(path.join(filesDir, 'Resources', 'app'), { recursive: true });
  }

  it('passes a clean bundle with the real config (no leak planted) (AC5)', () => {
    seedCleanResources();
    seedCleanExtraFiles();
    expect(() =>
      verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: filesDir })
    ).not.toThrow();
  });

  it('throws when a leak is planted at L1 (config shape) — proves the L1 call is wired', () => {
    seedCleanResources();
    seedCleanExtraFiles();
    const ctx = makeContext({ config: { extraFiles: [{ from: '.', to: '.' }] } });
    expect(() => verifyExtraContent(ctx, { bundleResources: resDir, extraFilesDir: filesDir }))
      .toThrow(/nothing is permitted/i);
  });

  it('throws when a leak is planted at L1 via a `from` rename into an allowed dest (F5)', () => {
    seedCleanResources();
    seedCleanExtraFiles();
    const ctx = makeContext({ config: { extraResources: [{ from: 'src', to: 'tessdata' }] } });
    expect(() => verifyExtraContent(ctx, { bundleResources: resDir, extraFilesDir: filesDir }))
      .toThrow(/not an allowlisted extra-content source/i);
  });

  it('throws when a leak is planted at L2a-1 (leak-name beside app/) — proves the L2a-1 call is wired', () => {
    seedCleanResources(['tessdata', 'src']);
    seedCleanExtraFiles();
    expect(() => verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: filesDir }))
      .toThrow(/not permitted extraResources destinations/i);
  });

  it('throws when a leak is planted at L2a-2 (unexpected sibling on darwin) — proves the L2a-2 call is wired', () => {
    seedCleanResources(['tessdata', 'stray.dat']);
    seedCleanExtraFiles();
    expect(() => verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: filesDir }))
      .toThrow(/unexpected/i);
  });

  it('throws when a leak is planted at L2b (sentinel at the extraFiles dest) — proves the L2b call is wired', () => {
    seedCleanResources();
    seedCleanExtraFiles();
    fs.writeFileSync(path.join(filesDir, 'package.json'), '{}');
    expect(() => verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: filesDir }))
      .toThrow(/repository\/extra-content leak/i);
  });

  it('fails closed when the extraFiles dest is null (unknown platform)', () => {
    seedCleanResources();
    expect(() =>
      verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: null })
    ).toThrow(/cannot locate the extraFiles/i);
  });

  // LOW (QG-6/7/8): the two L2a guards share one resources-dir symlink walk, now
  // hoisted into verifyExtraContent (they take skipSymlinkCheck: true). Prove the
  // hoisted walk still fails closed on an escaping sibling symlink beside app/, so
  // deleting it from verifyExtraContent — not just the sub-guards — fails a test.
  it('fails closed on an escaping sibling symlink beside app/ via the hoisted L2a walk (F5)', () => {
    seedCleanResources();
    seedCleanExtraFiles();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-outside-'));
    try {
      fs.symlinkSync(outside, path.join(resDir, 'leak'), dirLinkType);
      expect(() =>
        verifyExtraContent(makeContext(), { bundleResources: resDir, extraFilesDir: filesDir })
      ).toThrow(/resolving outside/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
