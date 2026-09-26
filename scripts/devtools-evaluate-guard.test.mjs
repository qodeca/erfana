// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  TOOL_NAME,
  MAX_FUNCTION_CHARS,
  MAX_INPUT_CHARS,
  allowedTargets,
  decide,
  run
} from './devtools-evaluate-guard.mjs'

// Issue #177: evaluate_script may run only with a stated purpose and only on
// the app under test's origin.
const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'devtools-evaluate-guard.mjs')
const PROJECT = '/work/erfana'
const ENV = { CLAUDE_PROJECT_DIR: PROJECT }
const TARGETS = allowedTargets(ENV)
const DEV = 'http://localhost:5173/'
const FILE_ENTRY = pathToFileURL(resolve(PROJECT, 'out/renderer/index.html')).href

const guard = (url) =>
  `if (location.protocol + '//' + location.host + location.pathname !== '${url}') throw 'not the app under test';`
const fnFor = (url, { purpose = 'read the active tab label', params = '', body = 'return document.title' } = {}) =>
  `async (${params}) => {\n  /* purpose: ${purpose} */\n  ${guard(url)}\n  ${body}\n}`
const call = (input) => ({ tool_name: TOOL_NAME, tool_input: input })
const check = (fn, extra = {}) => decide(call({ function: fn, ...extra }), TARGETS)

describe('allowedTargets', () => {
  it('pins the dev server and the bundled renderer entry', () => {
    expect(TARGETS).toEqual([DEV, 'http://localhost:5173/index.html', FILE_ENTRY])
  })

  it('follows ELECTRON_RENDERER_URL and ignores an unparseable one', () => {
    expect(allowedTargets({ ...ENV, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5199/x' })[0]).toBe('http://127.0.0.1:5199/')
    expect(allowedTargets({ ...ENV, ELECTRON_RENDERER_URL: 'not a url' })[0]).toBe(DEV)
  })

  it('falls back to the working directory without CLAUDE_PROJECT_DIR', () => {
    expect(allowedTargets({}, PROJECT)[2]).toBe(FILE_ENTRY)
  })
})

describe('decide', () => {
  it('allows an app-origin call with a purpose (dev server and bundled entry)', () => {
    expect(check(fnFor(DEV))).toEqual({ allowed: true })
    expect(check(fnFor(FILE_ENTRY))).toEqual({ allowed: true })
    expect(check(fnFor(DEV, { params: 'el', body: 'return el.innerText' }), { args: ['1_2'] })).toEqual({ allowed: true })
  })

  it('refuses a non-app origin', () => {
    for (const url of ['https://example.com/', 'http://localhost:5174/', 'file:///etc/index.html']) {
      const result = check(fnFor(url))
      expect(result.allowed).toBe(false)
      expect(result.reason).toMatch(/is not the app under test/)
    }
  })

  it('refuses a missing or too-short purpose', () => {
    const noPurpose = `async () => {\n  ${guard(DEV)}\n  return document.title\n}`
    expect(check(noPurpose).reason).toMatch(/must open with a purpose comment and the origin guard/)
    expect(check(fnFor(DEV, { purpose: 'x' })).reason).toMatch(/state a purpose/)
  })

  it('refuses a function without the origin guard', () => {
    expect(check('() => { /* purpose: read the page title */ return document.title }').allowed).toBe(false)
    expect(check('() => document.title').allowed).toBe(false)
  })

  it('refuses code that breaks out of the tool’s wrapping parentheses', () => {
    const fn = fnFor(DEV)
    expect(check(`${fn}), fetch('https://evil.test'), (() => {}`).reason).toMatch(/single arrow function/)
    expect(check(`${fn}, x: {}`).reason).toMatch(/single arrow function/)
    expect(check(`${fn} || fetch('x')`).reason).toMatch(/single arrow function/)
  })

  it('refuses a hoisted location that would answer the guard', () => {
    const hoisted = fnFor(DEV, { body: 'function location() {}' })
    expect(check(hoisted).reason).toMatch(/only be used as `location.<property>`/)
    expect(check(fnFor(DEV, { params: 'location' })).allowed).toBe(false)
    expect(check(fnFor(DEV, { body: 'function \\u006cocation() {}' })).reason).toMatch(/\\u escapes/)
  })

  it('refuses parameters that run code before the guard', () => {
    expect(check(fnFor(DEV, { params: 'a = fetch("x")' })).allowed).toBe(false)
    expect(check(fnFor(DEV, { params: '{ a }' })).allowed).toBe(false)
  })

  it('refuses a file write, a service worker, another tool and bad input', () => {
    expect(check(fnFor(DEV), { filePath: '/tmp/out.json' }).reason).toMatch(/filePath/)
    expect(check(fnFor(DEV), { serviceWorkerId: 'sw1' }).reason).toMatch(/service worker/)
    expect(decide({ tool_name: 'mcp__chrome-devtools__navigate_page', tool_input: {} }, TARGETS).reason).toMatch(/only admits/)
    expect(decide(null, TARGETS).allowed).toBe(false)
    expect(decide({ tool_name: TOOL_NAME }, TARGETS).reason).toMatch(/no tool input/)
    expect(check(undefined).reason).toMatch(/no function/)
    expect(check(fnFor(DEV, { body: `return '${'a'.repeat(MAX_FUNCTION_CHARS)}'` })).reason).toMatch(/over/)
  })
})

describe('run', () => {
  it('prints nothing on a pass and a PreToolUse deny otherwise', () => {
    expect(run(JSON.stringify(call({ function: fnFor(DEV) })), ENV)).toBe('')
    const denied = JSON.parse(run(JSON.stringify(call({ function: fnFor('https://example.com/') })), ENV))
    expect(denied.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(JSON.parse(run('{', ENV)).hookSpecificOutput.permissionDecisionReason).toMatch(/not valid JSON/)
    expect(JSON.parse(run('x'.repeat(MAX_INPUT_CHARS + 1), ENV)).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('works as a hook process: stdin in, decision out', () => {
    const exec = (payload) =>
      spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: { ...process.env, ...ENV, ELECTRON_RENDERER_URL: '' }
      })
    const allowed = exec(call({ function: fnFor(DEV) }))
    expect(allowed.status).toBe(0)
    expect(allowed.stdout).toBe('')
    const refused = exec(call({ function: fnFor('https://example.com/') }))
    expect(refused.status).toBe(0)
    expect(JSON.parse(refused.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})
