// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Pinned external tools that are not npm packages: vale, lychee, gitleaks, trufflehog.
//
// Each tool is downloaded from its official GitHub release into the git-ignored
// `.local/bin/<tool>-<version>/`, and the archive is checked against the SHA-256 written
// below before it is unpacked. The same versions and hashes as `secret-scan.yml`, so a
// local run repeats CI. Nothing is taken from PATH, so every machine runs the same build.
//
//   node scripts/tools.mjs install [tool...]      download the named tools (default: all)
//   node scripts/tools.mjs path <tool>            print the binary path (installs it first)
//   node scripts/tools.mjs run <tool> [args...]   run it (installs it first)
//
// To bump a tool: change `version`, then copy every hash from that release's checksums
// file (or the per-asset `.sha256` files for lychee).

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_ROOT = join(ROOT, '.local', 'bin')

/** platform key: `${process.platform}-${process.arch}` */
export const TOOLS = {
  vale: {
    version: '3.26.0',
    url: (v, asset) => `https://github.com/errata-ai/vale/releases/download/v${v}/${asset}`,
    assets: {
      'darwin-arm64': [
        'vale_3.26.0_macOS_arm64.tar.gz',
        'a6c3370f53bad93086c6b85f3163676e44e08049d69743afdcc13f3aab5b7482'
      ],
      'darwin-x64': [
        'vale_3.26.0_macOS_64-bit.tar.gz',
        'df42b317be6ece6a6a70d06b952deec581d047046eb93ea4632f58da56a86ff9'
      ],
      'linux-x64': [
        'vale_3.26.0_Linux_64-bit.tar.gz',
        '22aa69a556558e4a9dfc63c17030777383d8d3c48dcdfad655fa98e839d666ed'
      ],
      'linux-arm64': [
        'vale_3.26.0_Linux_arm64.tar.gz',
        '3154179f4611140c9af54a8b3bc6a90bc02b73fe6c1f635369604dde0490406d'
      ],
      'win32-x64': [
        'vale_3.26.0_Windows_64-bit.zip',
        'c42f4b413aa29b6b36fa4e3ac0c18322588a54ac860db4c84b8255997f7d1ec2'
      ],
      'win32-arm64': [
        'vale_3.26.0_Windows_arm64.zip',
        '673b27eea6e70ad25f99c5687b63c987a72a5ceadc6c9e730da50df6ba1fb022'
      ]
    }
  },
  lychee: {
    version: '0.24.2',
    url: (v, asset) =>
      `https://github.com/lycheeverse/lychee/releases/download/lychee-v${v}/${asset}`,
    assets: {
      'darwin-arm64': [
        'lychee-aarch64-apple-darwin.tar.gz',
        'c9d3740ea2d891854d37116c9fba840f37b6e7c89d330e7db84ac333631c4977'
      ],
      'darwin-x64': [
        'lychee-x86_64-apple-darwin.tar.gz',
        '887503a9cff667d322b8d0892b40bf49976eb9507af8483220a3706cdad55978'
      ],
      'linux-x64': [
        'lychee-x86_64-unknown-linux-gnu.tar.gz',
        '1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a'
      ],
      'linux-arm64': [
        'lychee-aarch64-unknown-linux-gnu.tar.gz',
        '91a7bd65685da41b90ccb9bc867a3d649a7818042dae04ff405e55a25bddee4c'
      ],
      'win32-x64': [
        'lychee-x86_64-pc-windows-msvc.zip',
        '32975d1493ee1a975d6bb41e4fb56fe419cb442ded628bb772ba2e614acfacad'
      ]
    }
  },
  gitleaks: {
    version: '8.30.1',
    url: (v, asset) => `https://github.com/gitleaks/gitleaks/releases/download/v${v}/${asset}`,
    assets: {
      'darwin-arm64': [
        'gitleaks_8.30.1_darwin_arm64.tar.gz',
        'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5'
      ],
      'darwin-x64': [
        'gitleaks_8.30.1_darwin_x64.tar.gz',
        'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709'
      ],
      'linux-x64': [
        'gitleaks_8.30.1_linux_x64.tar.gz',
        '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'
      ],
      'linux-arm64': [
        'gitleaks_8.30.1_linux_arm64.tar.gz',
        'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'
      ],
      'win32-x64': [
        'gitleaks_8.30.1_windows_x64.zip',
        'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e'
      ],
      'win32-arm64': [
        'gitleaks_8.30.1_windows_arm64.zip',
        'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f'
      ]
    }
  },
  trufflehog: {
    version: '3.95.5',
    url: (v, asset) =>
      `https://github.com/trufflesecurity/trufflehog/releases/download/v${v}/${asset}`,
    assets: {
      'darwin-arm64': [
        'trufflehog_3.95.5_darwin_arm64.tar.gz',
        '0a08b46f63d48ccb894689b68b5e7b91ac5efa09b9684a3457d388456887c213'
      ],
      'darwin-x64': [
        'trufflehog_3.95.5_darwin_amd64.tar.gz',
        '8091a92ad3ef6c46244f5b6b9683c72296381d77f63e8a979e913d8d58df595d'
      ],
      'linux-x64': [
        'trufflehog_3.95.5_linux_amd64.tar.gz',
        '8d151a19465973bec226be5992a2a11b053f4ab92c77861f642089892ae9aa58'
      ],
      'linux-arm64': [
        'trufflehog_3.95.5_linux_arm64.tar.gz',
        'bb876c4e5a84fa4fdbda4fc24143ed2d12eac32cfd3f7e41c79cbd7d33607b4a'
      ],
      'win32-x64': [
        'trufflehog_3.95.5_windows_amd64.tar.gz',
        '4421ac2786b2a356d62d2f4c59798bba5069c7a9f4dc7af9558061568b642c4d'
      ],
      'win32-arm64': [
        'trufflehog_3.95.5_windows_arm64.tar.gz',
        'bfece06dcbb4e1b4d366376294e702fa548f782048b32501cb58f97d713b7110'
      ]
    }
  }
}

const PLATFORM = `${process.platform}-${process.arch}`
const EXE = process.platform === 'win32' ? '.exe' : ''

function fail(message) {
  console.error(`tools: ${message}`)
  process.exit(2)
}

function toolDir(name) {
  return join(BIN_ROOT, `${name}-${TOOLS[name].version}`)
}

/** The binary may sit at the archive root or one folder down (lychee). */
function findBinary(dir, file) {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === file && statSync(full).isFile()) return full
    if (statSync(full).isDirectory()) {
      const nested = findBinary(full, file)
      if (nested) return nested
    }
  }
  return null
}

export function binaryPath(name) {
  return findBinary(toolDir(name), `${name}${EXE}`)
}

export async function install(name) {
  const tool = TOOLS[name]
  if (!tool) fail(`unknown tool "${name}" (known: ${Object.keys(TOOLS).join(', ')})`)
  const existing = binaryPath(name)
  if (existing) return existing
  const asset = tool.assets[PLATFORM]
  if (!asset) fail(`${name} ${tool.version} has no pinned build for ${PLATFORM}`)
  const [file, sha256] = asset
  const url = tool.url(tool.version, file)
  console.error(`tools: downloading ${name} ${tool.version} (${file})`)
  const response = await globalThis.fetch(url)
  if (!response.ok) fail(`${url} answered ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) fail(`${file}: SHA-256 is ${actual}, expected ${sha256}. Not unpacked.`)
  const dir = toolDir(name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, file)
  writeFileSync(archive, bytes)
  // bsdtar (macOS, Windows 10+) reads .zip and .tar.gz; GNU tar (Linux) gets only .tar.gz here.
  const untar = spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
  rmSync(archive, { force: true })
  if (untar.status !== 0) fail(`could not unpack ${file} with tar`)
  const binary = binaryPath(name)
  if (!binary) fail(`${file} holds no ${name}${EXE}`)
  if (process.platform !== 'win32') chmodSync(binary, 0o755)
  return binary
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'install') {
    for (const name of rest.length ? rest : Object.keys(TOOLS)) {
      console.log(`${name} ${TOOLS[name]?.version ?? ''}: ${await install(name)}`)
    }
    return
  }
  if (command === 'path' && rest.length === 1) {
    console.log(await install(rest[0]))
    return
  }
  if (command === 'run' && rest.length >= 1) {
    const [name, ...args] = rest
    const binary = await install(name)
    const run = spawnSync(binary, args[0] === '--' ? args.slice(1) : args, {
      stdio: 'inherit',
      cwd: ROOT
    })
    if (run.error) fail(`${name}: ${run.error.message}`)
    process.exit(run.status ?? 1)
  }
  fail('usage: node scripts/tools.mjs install [tool...] | path <tool> | run <tool> [args...]')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
