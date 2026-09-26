// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
// PreToolUse hook for `mcp__chrome-devtools__evaluate_script` (#177).
//
// Run as `node scripts/devtools-evaluate-guard.mjs`; the hook payload arrives
// on stdin. A call passes only when its function states a purpose and its
// first statement refuses to run anywhere but the app under test:
//
//   async () => {
//     /* purpose: read the active tab label */
//     if (location.protocol + '//' + location.host + location.pathname !== 'http://localhost:5173/') throw 'not the app under test';
//     ...
//   }
//
// The tool input carries no page URL (it evaluates in whichever page is
// selected), so the hook cannot check the origin itself. It checks that the
// page will: nothing in the function runs before that guard. The app's
// origins mirror src/main/ipc/senderValidation.ts – the electron-vite dev
// server (ELECTRON_RENDERER_URL, default http://localhost:5173) and the exact
// bundled renderer entry, out/renderer/index.html under the project root.
//
// On a pass the hook prints nothing, so the session's own permission rules
// still decide. Anything else – another tool, unreadable or oversized input,
// a missing purpose, another origin, a file write or a service worker – is
// denied with the reason. The input is contributor-influenced, so it is size-
// capped before any regex, the regexes are anchored with no nested
// quantifiers, and the function is compiled (never run) to prove it is one
// arrow function with nothing chained after it.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { URL, pathToFileURL, fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const TOOL_NAME = 'mcp__chrome-devtools__evaluate_script'
export const MAX_INPUT_CHARS = 64 * 1024
export const MAX_FUNCTION_CHARS = 16 * 1024
export const DEFAULT_DEV_ORIGIN = 'http://localhost:5173'

// Plain identifiers only: a default value or a destructuring pattern would
// run before the guard.
const PARAMS = String.raw`\(\s*(?:[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*)?\)`
const PREFIX = new RegExp(
  String.raw`^\s*(?:async\s+)?(${PARAMS})\s*=>\s*\{\s*` +
    String.raw`\/\*\s*purpose:([^*\r\n]{0,300})\*\/\s*` +
    String.raw`if\s*\(\s*location\.protocol\s*\+\s*(['"])\/\/\3\s*\+\s*location\.host\s*\+\s*location\.pathname\s*` +
    String.raw`!==\s*(['"])([^'"\\\r\n]{1,2048})\4\s*\)\s*throw\s+(['"])[^'"\\\r\n]{0,200}\6\s*;?`
)
// A `function location() {}` anywhere in the body is hoisted above the guard
// and would answer it, and a unicode escape can spell the same name. So
// `location` may only appear as a member access, and no `\u` escape is admitted.
const BARE_LOCATION = /(?<![.\w$])location(?![\w$])(?!\s*\??\.)/
const UNICODE_ESCAPE = /\\u/
const MIN_PURPOSE_CHARS = 8

export function allowedTargets(env = process.env, projectDir = process.cwd()) {
  let dev = DEFAULT_DEV_ORIGIN
  if (env.ELECTRON_RENDERER_URL) {
    try {
      dev = new URL(env.ELECTRON_RENDERER_URL).origin
    } catch {
      // An unparseable override falls back to the default dev origin.
    }
  }
  const root = env.CLAUDE_PROJECT_DIR || projectDir
  return [`${dev}/`, `${dev}/index.html`, pathToFileURL(resolve(root, 'out/renderer/index.html')).href]
}

function deny(reason) {
  return { allowed: false, reason: `evaluate_script refused (#177): ${reason}` }
}

function compiles(source) {
  try {
    new vm.Script(source)
    return true
  } catch {
    return false
  }
}

export function decide(payload, targets) {
  if (!payload || typeof payload !== 'object') return deny('the hook payload is not a JSON object.')
  if (payload.tool_name !== TOOL_NAME) {
    return deny(`this hook only admits ${TOOL_NAME}, not ${JSON.stringify(String(payload.tool_name))}.`)
  }
  const input = payload.tool_input
  if (!input || typeof input !== 'object') return deny('the call has no tool input.')
  if (input.serviceWorkerId !== undefined) return deny('evaluating in a service worker is not allowed.')
  if (input.filePath !== undefined) return deny('filePath writes a file; return the result inline instead.')
  const fn = input.function
  if (typeof fn !== 'string' || fn.length === 0) return deny('the call has no function.')
  if (fn.length > MAX_FUNCTION_CHARS) return deny(`the function is over ${MAX_FUNCTION_CHARS} characters.`)

  const match = PREFIX.exec(fn)
  if (!match) {
    return deny(
      'the function must open with a purpose comment and the origin guard, e.g. ' +
        "`async () => { /* purpose: <why> */ if (location.protocol + '//' + location.host + location.pathname !== '<app URL>') throw 'not the app under test'; ... }`."
    )
  }
  if (UNICODE_ESCAPE.test(fn)) return deny('\\u escapes are not allowed in the function.')
  if (BARE_LOCATION.test(fn)) return deny('`location` may only be used as `location.<property>`; it cannot be declared or passed.')
  if (match[2].trim().length < MIN_PURPOSE_CHARS) {
    return deny(`state a purpose of at least ${MIN_PURPOSE_CHARS} characters in the /* purpose: ... */ comment.`)
  }
  const target = match[5]
  if (!targets.includes(target)) {
    return deny(`${JSON.stringify(target)} is not the app under test; allowed: ${targets.join(', ')}.`)
  }
  // The tool evaluates `(${fn})`. It must be exactly one arrow function: a
  // block body that closes the string, valid both as that expression and as
  // an object property value, which rejects `f), evil(), (g` and `f, x: g`.
  if (!fn.trimEnd().endsWith('}') || !compiles(`(${fn})`) || !compiles(`({ k: ${fn} })`)) {
    return deny('the function must be a single arrow function with a block body and nothing after it.')
  }
  return { allowed: true }
}

export function hookOutput(decision) {
  if (decision.allowed) return ''
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: decision.reason
    }
  })
}

export function run(raw, env = process.env, projectDir = process.cwd()) {
  if (raw.length > MAX_INPUT_CHARS) return hookOutput(deny(`the hook payload is over ${MAX_INPUT_CHARS} characters.`))
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return hookOutput(deny('the hook payload is not valid JSON.'))
  }
  return hookOutput(decide(payload, allowedTargets(env, projectDir)))
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = run(readStdin())
  if (out) process.stdout.write(`${out}\n`)
}
