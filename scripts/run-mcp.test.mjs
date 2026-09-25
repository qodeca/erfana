// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, delimiter, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeFakeNpx, isAlive } from './lib/mcp-stand-in.mjs'

// Issue #145: the MCP wrapper must not leave its server running once the
// client is gone, even when the server ignores SIGTERM (the orphans seen on
// 25 Sep 2026 only stopped on SIGKILL). The wrapper runs `npx`, so the
// stand-in `npx` is put first on PATH.
const WRAPPER = join(dirname(fileURLToPath(import.meta.url)), 'run-mcp.js')
const STOP_TIMEOUT_MS = 10_000

let dir
let pidsFile
let wrapper
let started = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'erfana-run-mcp-'))
  pidsFile = join(dir, 'pids.json')
  writeFakeNpx(dir)
})

afterEach(() => {
  // Never leave a stand-in behind if an assertion failed: kill by saved PID only.
  for (const pid of [wrapper?.pid, ...started]) {
    if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL')
  }
  started = []
  wrapper = undefined
  rmSync(dir, { recursive: true, force: true })
})

async function startWrapper(...npxArgs) {
  wrapper = spawn(process.execPath, [WRAPPER, ...npxArgs], {
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, MCP_STAND_IN_PIDS: pidsFile },
  })
  const exited = new Promise((resolve) => wrapper.on('exit', (code, signal) => resolve({ code, signal })))
  const pids = await vi.waitFor(() => JSON.parse(readFileSync(pidsFile, 'utf8')), {
    timeout: STOP_TIMEOUT_MS,
    interval: 25,
  })
  started = [pids.launcher, pids.server]
  expect(isAlive(pids.launcher)).toBe(true)
  expect(isAlive(pids.server)).toBe(true)
  return { pids, exited }
}

async function expectAllGone({ launcher, server }, exited) {
  await vi.waitFor(
    () => {
      expect(isAlive(server)).toBe(false)
      expect(isAlive(launcher)).toBe(false)
    },
    { timeout: STOP_TIMEOUT_MS, interval: 50 },
  )
  await exited
  expect(isAlive(wrapper.pid)).toBe(false)
}

describe.skipIf(process.platform === 'win32')('run-mcp.js stops its server tree', () => {
  it('when its stdin closes and the server ignores SIGTERM', async () => {
    const { pids, exited } = await startWrapper('-y', 'fake-server')
    wrapper.stdin.end()
    await expectAllGone(pids, exited)
  }, 20_000)

  it('when it receives SIGTERM and the server ignores SIGTERM', async () => {
    const { pids, exited } = await startWrapper('-y', 'fake-server')
    wrapper.kill('SIGTERM')
    await expectAllGone(pids, exited)
  }, 20_000)

  it('when it receives SIGHUP and the launcher also ignores SIGTERM', async () => {
    const { pids, exited } = await startWrapper('-y', 'fake-server', 'stubborn')
    wrapper.kill('SIGHUP')
    await expectAllGone(pids, exited)
  }, 20_000)

  it('when the launcher exits on its own, it cleans up the server and exits', async () => {
    const { pids, exited } = await startWrapper('-y', 'fake-server')
    process.kill(pids.launcher, 'SIGKILL')
    await expectAllGone(pids, exited)
  }, 20_000)

  it('passes stdin through to the server launcher', async () => {
    const { pids, exited } = await startWrapper('-y', 'fake-server')
    const message = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n'
    wrapper.stdin.write(message)
    await vi.waitFor(() => expect(readFileSync(`${pidsFile}.stdin`, 'utf8')).toBe(message), {
      timeout: STOP_TIMEOUT_MS,
      interval: 25,
    })
    expect(isAlive(pids.server)).toBe(true)
    wrapper.stdin.end()
    await expectAllGone(pids, exited)
  }, 20_000)
})
