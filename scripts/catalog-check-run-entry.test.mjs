// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
// The catalog check's one run-code exception (#177, PR #202 S-2): the safe app
// start is admitted as an exact entry, only in the RUNS_CODE workflows, and a
// general run prefix is refused everywhere. Runs the real check on a copy of
// this repository's .xezar folder.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = path.join(ROOT, '.xezar/checks/catalog-check.mjs')
const ENTRY = '"node .xezar/checks/review-run-app.mjs"'
let dir

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-run-entry-'))
  fs.cpSync(path.join(ROOT, '.xezar'), path.join(dir, '.xezar'), { recursive: true })
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function withWorkflow(name, edit, fn) {
  const file = path.join(dir, '.xezar/workflows', `${name}.yaml`)
  const original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, edit(original))
  try {
    return fn(spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' }))
  } finally {
    fs.writeFileSync(file, original)
  }
}

describe('catalog check: the safe app start entry', () => {
  it('accepts the committed qa and design-review workflows', () => {
    const result = spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' })
    expect(result.stdout + result.stderr).toContain('CATALOG OK')
    for (const name of ['qa', 'design-review']) {
      expect(fs.readFileSync(path.join(dir, '.xezar/workflows', `${name}.yaml`), 'utf8')).toContain(ENTRY)
    }
  })

  it('refuses the entry in a workflow that is not allowed to run code', () => {
    withWorkflow('code-review', (text) => text.replace('"jq -n"', `"jq -n", ${ENTRY}`), (result) => {
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toMatch(/code-review\.yaml step "review": bashAllowlist entry "node \.xezar\/checks\/review-run-app\.mjs" is not a reading prefix/)
    })
  })

  it('refuses a general run prefix even in qa', () => {
    for (const entry of ['"npm ci"', '"npm run dev"', '"git checkout --detach"', '"node .xezar/checks/review-run-app.mjs --x"']) {
      withWorkflow('qa', (text) => text.replace(ENTRY, entry), (result) => {
        expect(result.status).not.toBe(0)
        expect(result.stdout + result.stderr).toContain(`qa.yaml step "review": bashAllowlist entry ${entry} is not a reading prefix`)
      })
    }
  })
})
