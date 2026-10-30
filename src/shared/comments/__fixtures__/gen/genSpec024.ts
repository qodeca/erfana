// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Writes the spec 024 goldens (`v1-spec024/`) from the real serializer and
 * planner (`spec024.ts`), then `v1-spec024.lock.json`: the SHA-256 of every
 * file in the folder, `cases.ts` included.
 *
 * Run from the repository root, bundled the way `npm run fixtures:html-comments`
 * bundles `genFixtures.ts`:
 *
 *   npx esbuild src/shared/comments/__fixtures__/gen/genSpec024.ts --bundle --platform=node \
 *     --log-level=warning --outfile=temp/fixtures-spec024.cjs && node temp/fixtures-spec024.cjs
 *
 * With the format unchanged every file comes out byte-identical. The folder is
 * append only: a diff in an existing file is a format change, made only on
 * purpose, with the spec and the lock.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spec024Goldens } from './spec024'

const FIXTURES_DIR = 'src/shared/comments/__fixtures__'
const FOLDER = 'v1-spec024'

function main(): void {
  const root = process.cwd()
  const fix = join(root, FIXTURES_DIR)
  if (!existsSync(join(fix, FOLDER, 'cases.ts'))) {
    throw new Error(`run from the repository root; the working directory is ${root}`)
  }
  for (const [name, bytes] of spec024Goldens()) writeFileSync(join(fix, FOLDER, name), bytes)
  const files: Record<string, string> = {}
  for (const name of readdirSync(join(fix, FOLDER)).sort()) {
    files[`${FOLDER}/${name}`] = createHash('sha256').update(readFileSync(join(fix, FOLDER, name))).digest('hex')
  }
  writeFileSync(join(fix, `${FOLDER}.lock.json`), JSON.stringify({ algorithm: 'sha256', files }, null, 2) + '\n')
  console.log(`spec 024 goldens written under ${FIXTURES_DIR}/${FOLDER}`)
}

main()
