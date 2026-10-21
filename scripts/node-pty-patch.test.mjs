// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards patches/node-pty+1.1.0.patch (#305): the microsoft/node-pty#922 lock
// around the process-wide ptyHandles vector, and the Windows source-build
// switch that makes sure the patched conpty.cc is what gets compiled.
// Drop this file together with the patch once a stable node-pty >= 1.2 ships #922.
const root = path.resolve(import.meta.dirname, '..');
const ptyDir = path.join(root, 'node_modules', 'node-pty');
const conpty = path.join(ptyDir, 'src', 'win', 'conpty.cc');
const prebuild = path.join(ptyDir, 'scripts', 'prebuild.js');
const patchFile = path.join(root, 'patches', 'node-pty+1.1.0.patch');

describe('node-pty patch (#305)', () => {
  it('the committed patch file carries the #922 lock and the Windows source-build switch', () => {
    const patch = fs.readFileSync(patchFile, 'utf8');
    expect(patch).toContain('+static std::mutex g_ptyHandlesMutex;');
    expect(patch).toContain('-static bool remove_pty_baton(int id) {');
    expect(patch).toContain("+if (process.platform === 'win32') {");
  });

  it.skipIf(!fs.existsSync(conpty))('installed conpty.cc is patched (lock present, unlocked remove helper gone)', () => {
    const src = fs.readFileSync(conpty, 'utf8');
    expect(src).toContain('static std::mutex g_ptyHandlesMutex;');
    expect(src).toContain('std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);');
    expect(src).not.toContain('remove_pty_baton');
    expect(src).not.toContain('InterlockedIncrement(&ptyCounter)');
    expect(src).toContain('std::erase_if(ptyHandles');
  });

  it.skipIf(!fs.existsSync(prebuild))('installed prebuild.js never accepts the prebuild on win32', () => {
    expect(fs.readFileSync(prebuild, 'utf8')).toContain("process.platform === 'win32'");
  });
});
