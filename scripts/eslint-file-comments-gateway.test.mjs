// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.

/**
 * 024-NFR-005 item 10, proven to fire: only
 * `src/renderer/src/services/comments/fileCommentGateway.ts` may touch
 * `window.api.fileComments` (spec 024 architecture note 001 § 8 C15).
 *
 * Each case lints a sample as if it lived at a real renderer path, so a config
 * edit that drops the selectors, downgrades them to a warning, or lets a later
 * block replace `no-restricted-syntax` without them turns this red.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })
const ERROR = 2
const GATEWAY = 'src/renderer/src/services/comments/fileCommentGateway.ts'
const MESSAGE = 'Only services/comments/fileCommentGateway.ts may touch window.api.fileComments'

/** The file-comment rule's messages for `code` linted as if it were the file at `rel`. */
async function fileCommentMessages(rel, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, rel) })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith(MESSAGE))
}

const SAMPLES = {
  member: 'export const f = (api: { fileComments: unknown }): unknown => api.fileComments\n',
  computed: "export const f = (api: Record<string, unknown>): unknown => api['fileComments']\n",
  presence: "declare function hasBridge(name: string): boolean\nexport const ok = hasBridge('fileComments')\n",
  destructure: 'export const f = ({ fileComments }: { fileComments: unknown }): unknown => fileComments\n'
}

describe('024-AC-028 item 10: only fileCommentGateway.ts touches window.api.fileComments', () => {
  it.each(Object.entries(SAMPLES))('fails a component that reaches the bridge (%s), as an error', async (_name, code) => {
    const messages = await fileCommentMessages('src/renderer/src/components/Comments/probe.tsx', code)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((m) => m.severity === ERROR)).toBe(true)
  })

  it('fails another gateway that reaches it', async () => {
    expect(await fileCommentMessages('src/renderer/src/services/previewGateway.ts', SAMPLES.member)).not.toHaveLength(0)
  })

  it('fails a file that owns another banned pattern', async () => {
    expect(await fileCommentMessages('src/renderer/src/utils/fileUtils.ts', SAMPLES.member)).not.toHaveLength(0)
  })

  it('passes the gateway itself', async () => {
    expect(await fileCommentMessages(GATEWAY, SAMPLES.member)).toHaveLength(0)
  })
})
