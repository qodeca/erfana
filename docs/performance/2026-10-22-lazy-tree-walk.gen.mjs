// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Generates the two scratch projects of docs/performance/2026-10-22-lazy-tree-walk.md.
// Usage: node docs/performance/2026-10-22-lazy-tree-walk.gen.mjs <scratch folder>
/* global process, console -- a Node script; docs/ has no Node globals in the lint config */
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const base = process.argv[2]
if (!base) {
  console.error('Usage: node 2026-10-22-lazy-tree-walk.gen.mjs <scratch folder>')
  process.exit(1)
}
let files = 0
const touch = (p) => {
  writeFileSync(p, '')
  files++
}

function project(name, { plainFolders, plainFiles, venvPkgs, venvFilesPerDir, distFiles }) {
  const root = join(base, name)
  rmSync(root, { recursive: true, force: true })
  files = 0
  // Plain project content: docs/sNN/tNN/*.md
  for (let i = 0; i < plainFolders; i++) {
    const d = join(root, 'docs', `s${Math.floor(i / 20)}`, `t${i}`)
    mkdirSync(d, { recursive: true })
    for (let f = 0; f < plainFiles; f++) touch(join(d, `note-${f}.md`))
  }
  // A large ignored folder: .venv is on the default watcher ignore list and,
  // unlike node_modules, not tree-hidden – so the old walk listed all of it
  for (let p = 0; p < venvPkgs; p++) {
    for (const sub of ['', 'sub', 'sub/deep']) {
      const d = join(root, '.venv', 'lib', 'python3.12', 'site-packages', `pkg${p}`, sub)
      mkdirSync(d, { recursive: true })
      for (let f = 0; f < venvFilesPerDir; f++) touch(join(d, `m${f}.py`))
    }
  }
  if (distFiles) {
    mkdirSync(join(root, 'dist'), { recursive: true })
    for (let f = 0; f < distFiles; f++) touch(join(root, 'dist', `chunk-${f}.js`))
  }
  touch(join(root, 'README.md'))
  console.log(name, 'files', files)
}

// A: ~25k files, ~20k of them in an ignored .venv and 400 in an ignored dist
project('mixed-25k', { plainFolders: 100, plainFiles: 40, venvPkgs: 400, venvFilesPerDir: 17, distFiles: 400 })
// B: ~120k files, none ignored – the entry cap case
project('plain-120k', { plainFolders: 3000, plainFiles: 40, venvPkgs: 0, venvFilesPerDir: 0, distFiles: 0 })
