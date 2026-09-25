// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Privacy pass of the capture (design § Privacy, layers 2 and 3).
 *
 * The deny-list is built at run time from this machine and this operator and
 * is never written to disk. A finding names the KIND of match, never the
 * matched value, so a report or a log line cannot leak what it caught.
 *
 * Matching is literal (`indexOf`) or a hand-written linear scanner; the few
 * regular expressions have no nested quantifiers, so a hostile or huge text
 * cannot make the pass slow (ReDoS).
 */

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

/** Mail domains the fixture may show (RFC 2606 reserved names). */
export const ALLOWED_MAIL_DOMAINS = ['example.org', 'example.com']

/** Phrases that describe account usage (design § Privacy, layer 2). */
export const USAGE_PHRASES = ['usage limit', 'weekly limit', 'rate limit']

/** Shortest literal worth matching: shorter values would hit ordinary words. */
const MIN_LITERAL = 3

/**
 * Build the deny-list for this machine.
 *
 * @param {object} [o]
 * @param {Record<string, string|undefined>} [o.env]
 * @param {string[]} [o.secrets] - values that must never be shown (token, key)
 * @param {() => {username: string, homedir: string}} [o.userInfo]
 * @param {() => string} [o.hostname]
 * @param {(args: string[]) => string} [o.git] - `git config --get …`, '' if unset
 * @param {() => string} [o.fullName] - the account's full name ('' if unknown)
 * @returns {Array<{ kind: string, value: string, word: boolean }>}
 */
export function buildDenyList({
  env = process.env,
  secrets = [],
  userInfo = () => os.userInfo(),
  hostname = () => os.hostname(),
  git = defaultGit,
  fullName = defaultFullName
} = {}) {
  const entries = []
  const add = (kind, value, word = false) => {
    if (typeof value !== 'string') return
    const v = value.trim()
    if (v.length < MIN_LITERAL) return
    if (entries.some((e) => e.kind === kind && e.value.toLowerCase() === v.toLowerCase())) return
    entries.push({ kind, value: v, word })
  }
  const info = userInfo()
  add('username', info.username)
  add('home-path', info.homedir)
  const host = hostname()
  add('hostname', host)
  add('hostname', host.replace(/\.local$/i, ''))
  const gitEmail = git(['user.email'])
  const gitName = git(['user.name'])
  add('git-email', gitEmail)
  add('git-name', gitName)
  add('full-name', fullName())
  // First and last names on their own, matched as whole words only.
  for (const name of [gitName, fullName()]) {
    for (const part of String(name || '').split(/[\s,.]+/)) add('name-part', part, true)
  }
  for (const secret of secrets) add('secret', secret)
  if (env.ANTHROPIC_API_KEY) add('secret', env.ANTHROPIC_API_KEY)
  // Extra terms the operator names (an organisation or account label).
  for (const term of String(env.ERFANA_CAPTURE_DENY_EXTRA || '').split(',')) add('operator-term', term, true)
  return entries
}

function defaultGit(args) {
  try {
    return execFileSync('git', ['config', '--get', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function defaultFullName() {
  if (process.platform !== 'darwin') return ''
  try {
    return execFileSync('id', ['-F'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch)

function findLiteral(hay, needle, word) {
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at === -1) return false
    if (!word) return true
    if (!isWordChar(hay[at - 1]) && !isWordChar(hay[at + needle.length])) return true
    from = at + 1
  }
}

const LOCAL_CHARS = /[A-Za-z0-9._%+-]/
const DOMAIN_CHARS = /[A-Za-z0-9.-]/
const MAX_LOCAL = 64
const MAX_DOMAIN = 255

/**
 * Email addresses in the text, by a linear scan outward from each `@`. Each
 * expansion is bounded (64 / 255 characters), so the pass is linear in the
 * text length.
 */
export function findEmails(text) {
  const found = []
  let at = text.indexOf('@')
  while (at !== -1) {
    let s = at
    while (s > 0 && at - s < MAX_LOCAL && LOCAL_CHARS.test(text[s - 1])) s--
    let e = at + 1
    while (e < text.length && e - at <= MAX_DOMAIN && DOMAIN_CHARS.test(text[e])) e++
    let domain = text.slice(at + 1, e)
    while (domain.endsWith('.') || domain.endsWith('-')) domain = domain.slice(0, -1)
    const local = text.slice(s, at)
    const dot = domain.lastIndexOf('.')
    const tld = dot === -1 ? '' : domain.slice(dot + 1)
    if (local.length > 0 && dot > 0 && tld.length >= 2 && /^[A-Za-z]+$/.test(tld)) {
      found.push({ local, domain: domain.toLowerCase() })
    }
    at = text.indexOf('@', at + 1)
  }
  return found
}

function isAllowedMailDomain(domain) {
  return ALLOWED_MAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/** `sk-ant-…` / `sk-…` key shapes: at least 16 key characters after the prefix. */
const TOKEN_SHAPE = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16}/
/** A money amount such as `$0.42` (account cost). */
const MONEY = /\$ ?\d/

/**
 * Match a text (a PTY stream, the page's DOM text or an OCR result) against
 * the deny-list. The literal checks run on the raw text, before and
 * independently of the email allow rule, so an allowed address such as
 * `<user name>@example.org` still reports the user name.
 *
 * @returns {string[]} the kinds that matched, sorted, without duplicates
 */
export function scanText(text, denyList) {
  const kinds = new Set()
  const hay = String(text).toLowerCase()
  for (const entry of denyList) {
    if (findLiteral(hay, entry.value.toLowerCase(), entry.word)) kinds.add(entry.kind)
  }
  for (const email of findEmails(String(text))) {
    if (!isAllowedMailDomain(email.domain)) kinds.add('email')
  }
  if (TOKEN_SHAPE.test(String(text))) kinds.add('token-shape')
  if (MONEY.test(String(text))) kinds.add('money')
  for (const phrase of USAGE_PHRASES) if (hay.includes(phrase)) kinds.add('usage')
  return [...kinds].sort()
}

/** Remove ANSI/OSC escape sequences so a PTY stream reads as screen text. */
export function stripAnsi(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x1b) {
      const next = s[i + 1]
      if (next === '[') {
        i += 2
        while (i < s.length && !(s.charCodeAt(i) >= 0x40 && s.charCodeAt(i) <= 0x7e)) i++
        continue
      }
      if (next === ']' || next === 'P' || next === '_' || next === '^') {
        i += 2
        while (i < s.length && s.charCodeAt(i) !== 0x07 && !(s[i] === '\x1b' && s[i + 1] === '\\')) i++
        if (s[i] === '\x1b') i++
        continue
      }
      i++
      continue
    }
    if (c < 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) continue
    out += s[i]
  }
  return out
}

/**
 * Which frames of an encoded loop the privacy pass reads: at least one per
 * second, plus the first and the last (R138-11).
 *
 * @param {number} frameCount
 * @param {number} fps
 * @returns {number[]} frame indexes, ascending
 */
export function sampleFrames(frameCount, fps) {
  if (!Number.isInteger(frameCount) || frameCount <= 0) return []
  if (!(fps > 0)) throw new Error('fps must be positive')
  const step = Math.max(1, Math.floor(fps))
  const set = new Set([0, frameCount - 1])
  for (let i = 0; i < frameCount; i += step) set.add(i)
  return [...set].sort((a, b) => a - b)
}

/**
 * The same rule by time, for encodings whose frames are not evenly spaced:
 * every whole second from 0, plus a moment just before the end (the last
 * frame). The margin covers a container whose length rounds to one frame
 * less than the edit's (a 12 fps frame is 83 ms).
 *
 * @param {number} duration - seconds
 * @returns {number[]}
 */
export function sampleTimes(duration) {
  if (!(duration > 0)) return []
  const times = []
  for (let t = 0; t < duration - 0.25; t += 1) times.push(t)
  const last = Math.max(0, duration - 0.25)
  if (last > times[times.length - 1]) times.push(Math.round(last * 1000) / 1000)
  return times
}

/**
 * Resolve tesseract.js (installed through @llamaindex/liteparse). Fails closed
 * with a message that says what to do.
 */
export function resolveTesseract(fromDir) {
  const require = createRequire(path.join(fromDir, 'noop.js'))
  try {
    return require('tesseract.js')
  } catch {
    throw new Error(
      'tesseract.js is not installed (it comes with @llamaindex/liteparse). Run `npm ci`; the privacy OCR cannot run without it.'
    )
  }
}

/** Where tesseract.js keeps its language file between runs. */
export function ocrCacheDir(env = process.env) {
  return env.ERFANA_CAPTURE_OCR_CACHE || path.join(os.homedir(), 'Library', 'Caches', 'erfana-capture', 'tesseract')
}

/**
 * One OCR worker for the whole run.
 *
 * @returns {Promise<{ read: (file: string|Buffer) => Promise<{ text: string, words: Array<{ text: string, bbox: { x0: number, y0: number, x1: number, y1: number } }> }>, close: () => Promise<void> }>}
 */
export async function createOcr(repoRoot) {
  const tesseract = resolveTesseract(repoRoot)
  const cachePath = ocrCacheDir()
  fs.mkdirSync(cachePath, { recursive: true })
  const worker = await tesseract.createWorker('eng', 1, { cachePath })
  return {
    async read(image) {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
      const words = []
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            for (const w of line.words || []) words.push({ text: w.text, bbox: w.bbox })
          }
        }
      }
      return { text: data.text || '', words }
    },
    async close() {
      await worker.terminate()
    }
  }
}
