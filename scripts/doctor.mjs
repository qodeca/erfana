// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// `npm run doctor` – checks that this machine can run every check and test in package.json.
//
// Each row is ok, warn or fail. A fail means `npm ci` or the required CI checks cannot run
// here; a warn means only an optional suite (Linux e2e, doc lint, secret scan) is affected.
// Every non-ok row prints the install line for this OS. Exit code: 1 when any row fails.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOLS, binaryPath } from './tools.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OS = process.platform
const rows = []

function add(status, item, detail, fix = '') {
  rows.push({ status, item, detail, fix })
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: OS === 'win32', timeout: 30_000 })
  if (r.error || r.status !== 0) return null
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
}

function byOs(mac, linux, win) {
  return OS === 'darwin' ? mac : OS === 'win32' ? win : linux
}

// Node – the major in .nvmrc.
const wantNode = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()
const haveNode = process.versions.node.split('.')[0]
if (haveNode === wantNode) add('ok', 'Node', `v${process.versions.node}`)
else
  add(
    'fail',
    'Node',
    `v${process.versions.node}, .nvmrc wants ${wantNode}`,
    `nvm install ${wantNode} (or fnm/volta/mise)`
  )

// A Node built against a shared libnode (Homebrew's node@24) cannot run from a copy under
// another name, which the e2e shell-guard tests (025-AC-077) do.
const nodeLib = join(dirname(process.execPath), '..', 'lib')
if (existsSync(nodeLib) && readdirSync(nodeLib).some(f => /^libnode\./.test(f)))
  add(
    'warn',
    'Node build',
    `${process.execPath} links a shared libnode – the 025-AC-077 e2e tests fail with it`,
    'use the nodejs.org build: nvm, fnm, volta, mise or the nodejs.org installer'
  )

// npm – the packageManager field.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const wantNpm = String(pkg.packageManager ?? '').replace(/^npm@/, '')
const haveNpm = run('npm', ['--version'])
if (!haveNpm) add('fail', 'npm', 'not found', 'reinstall Node')
else if (wantNpm && haveNpm.split('.')[0] !== wantNpm.split('.')[0])
  add('warn', 'npm', `${haveNpm}, package.json wants ${wantNpm}`, `npm install -g npm@${wantNpm}`)
else add('ok', 'npm', haveNpm)

// Python – node-gyp builds node-pty with it; 3.13 is known to fail.
const pythonCmd =
  process.env.npm_config_python || process.env.PYTHON || byOs('python3', 'python3', 'python')
const pyOut = run(pythonCmd, ['--version'])
const py = pyOut?.match(/Python (\d+)\.(\d+)\.(\d+)/)
if (!py)
  add(
    'fail',
    'Python',
    `"${pythonCmd}" not found`,
    byOs(
      'brew install python@3.12',
      'sudo apt install python3',
      'winget install Python.Python.3.12'
    )
  )
else if (py[1] === '3' && py[2] === '13')
  add(
    'fail',
    'Python',
    `${py[0]} – node-pty fails to build on 3.13`,
    'install 3.12 (see .python-version) and set npm_config_python to it'
  )
else add('ok', 'Python', py[0].replace('Python ', ''))

// C++ toolchain for native modules.
if (OS === 'darwin') {
  const xcode = run('xcode-select', ['-p'])
  if (xcode) add('ok', 'C++ toolchain', xcode)
  else add('fail', 'C++ toolchain', 'Xcode Command Line Tools missing', 'xcode-select --install')
} else if (OS === 'linux') {
  const cxx = run('c++', ['--version']) && run('make', ['--version'])
  if (cxx) add('ok', 'C++ toolchain', 'c++ and make found')
  else add('fail', 'C++ toolchain', 'c++ or make missing', 'sudo apt install build-essential')
} else {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
  const vs =
    existsSync(vswhere) &&
    run(`"${vswhere}"`, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'displayName'
    ])
  if (vs) add('ok', 'C++ toolchain', vs)
  else
    add(
      'fail',
      'C++ toolchain',
      'Visual Studio C++ build tools not found',
      'see docs/build/windows.md (Desktop development with C++)'
    )
}

// git – the claim, link and trace checks read `git ls-files`.
const git = run('git', ['--version'])
if (git) add('ok', 'git', git.replace('git version ', ''))
else
  add(
    'fail',
    'git',
    'not found',
    byOs('xcode-select --install', 'sudo apt install git', 'winget install Git.Git')
  )

// Installed dependencies.
if (existsSync(join(ROOT, 'node_modules', '.package-lock.json')))
  add('ok', 'node_modules', 'installed')
else add('fail', 'node_modules', 'missing', 'npm ci')

// Docker – only `npm run test:e2e:linux` needs it, and the checkout must be shared into the VM.
const dockerInfo = run('docker', ['info', '--format', '{{.ServerVersion}}'])
if (!dockerInfo) {
  add(
    'warn',
    'Docker',
    'not reachable – only test:e2e:linux needs it',
    byOs(
      'brew install colima docker && colima start',
      'https://docs.docker.com/engine/install/',
      'install Docker Desktop, or run the suite from WSL'
    )
  )
} else {
  const seen = run('docker', [
    'run',
    '--rm',
    '-v',
    `${ROOT}:/work`,
    'alpine:3',
    'test',
    '-f',
    '/work/package.json'
  ])
  if (seen !== null) add('ok', 'Docker', `${dockerInfo}, checkout shared`)
  else
    add(
      'warn',
      'Docker',
      `${dockerInfo}, but the checkout is not shared into the Docker VM (or alpine:3 could not be pulled)`,
      'Colima: add the folder under mounts: in ~/.colima/<profile>/colima.yaml, then colima restart; Docker Desktop: Settings > Resources > File sharing'
    )
}

// Pinned tools (scripts/tools.mjs).
for (const name of Object.keys(TOOLS)) {
  const path = binaryPath(name)
  if (path) add('ok', name, `${TOOLS[name].version} in .local/bin`)
  else
    add(
      'warn',
      name,
      `not installed (${name === 'vale' || name === 'lychee' ? 'lint:docs' : 'check:secrets'} installs it on first use)`,
      'npm run tools'
    )
}

// Report.
const width = Math.max(...rows.map(r => r.item.length))
const mark = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' }
console.log(`Erfana doctor – ${OS}-${process.arch}\n`)
for (const r of rows) {
  console.log(`${mark[r.status]}  ${r.item.padEnd(width)}  ${r.detail}`)
  if (r.status !== 'ok' && r.fix) console.log(`      ${''.padEnd(width)}  fix: ${r.fix}`)
}
const failed = rows.filter(r => r.status === 'fail').length
const warned = rows.filter(r => r.status === 'warn').length
console.log(
  `\n${failed} failed, ${warned} warnings. Tools by script: CONTRIBUTING.md § Tools by script.`
)
process.exit(failed ? 1 : 0)
