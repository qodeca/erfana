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
    expect(patch).toContain("+          'defines': [ 'NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS' ],");
  });

  // microsoft/node-pty#990 (#305): close the pseudoconsole when the shell exits on its own,
  // so no conhost.exe is left behind per pty.
  it('the committed patch file carries the #990 pseudoconsole close', () => {
    const patch = fs.readFileSync(patchFile, 'utf8');
    expect(patch).toContain('+void SetupExitCallback(Napi::Env env, Napi::Function cb, pty_baton* baton, PFNCLOSEPSEUDOCONSOLE pfnClosePseudoConsole) {');
    expect(patch).toContain('+    if (hpc != nullptr && pfnClosePseudoConsole != nullptr) {');
    expect(patch).not.toContain('status == napi_ok && hpc != nullptr');
    expect(patch).toContain('+        handle->hpc = nullptr;');
  });

  it.skipIf(!fs.existsSync(conpty))('installed conpty.cc closes the pseudoconsole once, outside the lock, also when closing', () => {
    const src = fs.readFileSync(conpty, 'utf8');
    expect(src).toContain('pty_baton* baton, PFNCLOSEPSEUDOCONSOLE pfnClosePseudoConsole)');
    expect(src).toContain('hpc = baton->hpc;');
    expect(src).toContain('if (hpc != nullptr && pfnClosePseudoConsole != nullptr) {');
    // Our adaptation of #990: the close is NOT skipped on napi_closing (deadlocks the quit)
    expect(src).not.toContain('status == napi_ok && hpc != nullptr');
    expect(src).toContain('handle->hpc = nullptr;');
    expect(src).toContain('pfnClosePseudoConsole && handle->hpc != nullptr');
    // The close runs after the erase block ends, so it never holds g_ptyHandlesMutex.
    expect(src.indexOf('pfnClosePseudoConsole(hpc);')).toBeGreaterThan(src.indexOf('tsfn.BlockingCall(exit_event, callback)'));
    // PtyKill nulls hpc, so its handle must be non-const
    expect(src).toMatch(/\n {2}pty_baton\* handle = get_pty_baton\(lock, id\);/);
  });

  // Our own additions (not upstream): resize/clear/kill must not touch a pseudoconsole
  // or shell that is already closed.
  it('the committed patch file carries the null-hpc / null-hShell guards', () => {
    const patch = fs.readFileSync(patchFile, 'utf8');
    expect(patch).toContain('+  HANDLE hShell = nullptr;');
    expect(patch).toContain('+      if (pfnResizePseudoConsole && handle->hpc != nullptr)');
    expect(patch).toContain('+      if (pfnClearPseudoConsole && handle->hpc != nullptr)');
    expect(patch).toContain('+    if (useConptyDll && handle->hShell != nullptr) {');
  });

  it.skipIf(!fs.existsSync(conpty))('installed conpty.cc skips closed pseudoconsoles and unset shells', () => {
    const src = fs.readFileSync(conpty, 'utf8');
    expect(src).toContain('HANDLE hShell = nullptr;');
    expect(src).toContain('pfnResizePseudoConsole && handle->hpc != nullptr');
    expect(src).toContain('pfnClearPseudoConsole && handle->hpc != nullptr');
    expect(src).toContain('useConptyDll && handle->hShell != nullptr');
  });

  // Second crash cause (#305): a shell exiting during Electron teardown fires the exit
  // ThreadSafeFunction when JS cannot run; without the define node-addon-api throws and
  // std::terminate ends the process (0xc0000409).
  it.skipIf(!fs.existsSync(path.join(ptyDir, 'binding.gyp')))('installed binding.gyp defines NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS for conpty', () => {
    const gyp = fs.readFileSync(path.join(ptyDir, 'binding.gyp'), 'utf8');
    const conptyTarget = gyp.slice(gyp.indexOf("'target_name': 'conpty',"), gyp.indexOf("'target_name': 'conpty_console_list'"));
    expect(conptyTarget).toContain('NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS');
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
