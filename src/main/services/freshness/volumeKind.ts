// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * What kind of volume a watched file lives on (#478 G7, plan decision 46).
 *
 * Native file events are unreliable on network shares and WSL: a change made
 * from another machine, or inside the Linux VM, often raises nothing. A tab
 * whose file lives there follows it with `liveRefresh: 'limited'` – an info
 * notice and a safety-net check while visible – instead of trusting events.
 *
 * - Windows: a real path that starts with `\\` is a network share
 *   (`\\wsl$\…` and `\\wsl.localhost\…` are WSL). A mapped drive letter is
 *   only caught when `realpath` resolved it to its UNC form.
 * - Linux: the `statfs` type of the file's volume – NFS, SMB/CIFS, 9p (WSL's
 *   Windows drives) and FUSE are limited.
 * - macOS: always `local` (a documented limit – no cheap, reliable probe).
 *
 * Never throws: a failed `statfs` answers `local`, so the tab keeps live
 * events (the safety net still runs on focus and show).
 *
 * @module services/freshness/volumeKind
 */
import { statfs as nodeStatfs } from 'node:fs/promises'

import { logger } from '../LoggingService'
import { normaliseResolved, hostPathFlavour, type PathFlavour } from '../../utils/pathCompare'
import { redactedLogError, redactPath } from '../../utils/redactUserInput'

/** Where a file lives, as far as live events are concerned. */
export type VolumeKind = 'local' | 'network' | 'wsl'

/** The part of `fs.statfs` this module reads. */
export type StatfsFn = (path: string) => Promise<{ type: number | bigint }>

/** Linux `statfs` magic numbers of volumes whose native events cannot be trusted (`linux/magic.h`). */
export const LIMITED_FS_MAGIC = {
  NFS: 0x6969,
  SMB: 0x517b,
  SMB2: 0xfe534d42,
  CIFS: 0xff534d42,
  V9FS: 0x01021997,
  FUSE: 0x65735546,
} as const

const LIMITED_MAGICS: ReadonlySet<number> = new Set(Object.values(LIMITED_FS_MAGIC))

const UNC_PREFIX = '\\\\'
const WSL_PREFIXES = ['\\\\wsl$\\', '\\\\wsl.localhost\\']

/** Injected for tests: the path flavour (platform included) and `statfs`. */
export interface VolumeKindDeps {
  flavour?: PathFlavour
  statfs?: StatfsFn
}

/** The Windows answer, from the path alone. */
function windowsVolumeKind(real: string, flavour: PathFlavour): VolumeKind {
  const resolved = normaliseResolved(real, flavour)
  const lower = resolved.toLowerCase()
  if (WSL_PREFIXES.some((prefix) => lower.startsWith(prefix))) return 'wsl'
  return resolved.startsWith(UNC_PREFIX) ? 'network' : 'local'
}

/** The Linux answer, from the volume's `statfs` type. */
async function linuxVolumeKind(real: string, statfs: StatfsFn): Promise<VolumeKind> {
  try {
    const { type } = await statfs(real)
    // `statfs` reports the magic as a signed 32-bit value on some builds (CIFS is negative); compare unsigned
    const magic = Number(BigInt.asUintN(32, BigInt(type)))
    return LIMITED_MAGICS.has(magic) ? 'network' : 'local'
  } catch (error) {
    logger.debug(`volumeKind: statfs failed for ${redactPath(real)}; treating it as local`, {
      error: redactedLogError(error)?.message,
    })
    return 'local'
  }
}

/**
 * The volume kind of `real`, a path already resolved by `realpath`.
 *
 * @param real - the file's real path (pass `realpath` output, not a requested path)
 */
export async function volumeKind(real: string, deps: VolumeKindDeps = {}): Promise<VolumeKind> {
  const flavour = deps.flavour ?? hostPathFlavour
  if (flavour.platform === 'win32') return windowsVolumeKind(real, flavour)
  if (flavour.platform === 'linux') return linuxVolumeKind(real, deps.statfs ?? nodeStatfs)
  return 'local'
}
