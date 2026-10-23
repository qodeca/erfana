// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';

process.env.ERFANA_MEDIA_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'erfana-media-cache-'));
const require = createRequire(import.meta.url);
const afterSign = require('./resign.js');
const { verifySignedWindowsBundle } = afterSign;
const { buildFuseConfig } = require('./fuses.js');
const { FuseV1Options, FuseState } = require('@electron/fuses');

const HEADER = '{"files":{"out":{"files":{}}}}';
const HASH = crypto.createHash('sha256').update(HEADER).digest('hex');
const fakeAsar = { getRawHeader: () => ({ headerString: HEADER, header: {}, headerSize: HEADER.length }) };
const wireFor = (config) => {
  const wire = { version: '1' };
  for (const i of Object.values(FuseV1Options).filter((v) => typeof v === 'number')) {
    wire[i] = config[i] ? FuseState.ENABLE : FuseState.DISABLE;
  }
  return wire;
};
const reseditWith = (list) => ({
  NtExecutable: { from: () => ({}) },
  NtExecutableResource: {
    from: () => ({
      entries: list === null ? [] : [{ type: 'INTEGRITY', id: 'ELECTRONASAR', bin: Buffer.from(JSON.stringify(list)) }],
    }),
  },
});

describe('afterSign on Windows (verifySignedWindowsBundle)', () => {
  let tmpRoot;
  let context;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resign-win-'));
    fs.mkdirSync(path.join(tmpRoot, 'resources'));
    fs.writeFileSync(path.join(tmpRoot, 'resources', 'app.asar'), 'x');
    fs.writeFileSync(path.join(tmpRoot, 'Erfana.exe'), 'MZ');
    context = { appOutDir: tmpRoot, electronPlatformName: 'win32', packager: { appInfo: { productFilename: 'Erfana' } } };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes when the signed exe keeps the pinned fuses and the archive hash', async () => {
    const getCurrentFuseWire = vi.fn(async () => wireFor(buildFuseConfig('win32')));
    const result = await verifySignedWindowsBundle(context, {
      getCurrentFuseWire,
      asar: fakeAsar,
      resedit: reseditWith([{ file: 'resources\\app.asar', alg: 'SHA256', value: HASH }]),
    });
    expect(getCurrentFuseWire).toHaveBeenCalledWith(path.join(tmpRoot, 'Erfana.exe'));
    expect(result.integrity).toEqual({ algorithm: 'SHA256', hash: HASH });
  });

  it('fails when signing dropped the integrity resource', async () => {
    await expect(verifySignedWindowsBundle(context, {
      getCurrentFuseWire: async () => wireFor(buildFuseConfig('win32')),
      asar: fakeAsar,
      resedit: reseditWith(null),
    })).rejects.toThrow(/No embedded asar integrity hash/);
  });

  it('fails when the hash no longer matches the archive', async () => {
    await expect(verifySignedWindowsBundle(context, {
      getCurrentFuseWire: async () => wireFor(buildFuseConfig('win32')),
      asar: fakeAsar,
      resedit: reseditWith([{ file: 'resources\\app.asar', alg: 'SHA256', value: '0'.repeat(64) }]),
    })).rejects.toThrow(/does not match app\.asar on disk/);
  });

  it('fails when a fuse changed', async () => {
    const wire = wireFor(buildFuseConfig('win32'));
    wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] = FuseState.DISABLE;
    await expect(verifySignedWindowsBundle(context, {
      getCurrentFuseWire: async () => wire,
      asar: fakeAsar,
      resedit: reseditWith([{ file: 'resources\\app.asar', alg: 'SHA256', value: HASH }]),
    })).rejects.toThrow(/EnableEmbeddedAsarIntegrityValidation=48/);
  });

  it('is what afterSign runs for win32, and other non-darwin platforms are a no-op', async () => {
    // With no fakes the real check runs against the 2-byte stub exe and fails – proving it is wired in.
    await expect(afterSign(context)).rejects.toThrow();
    await expect(afterSign({ ...context, electronPlatformName: 'linux' })).resolves.toBeUndefined();
  });
});
