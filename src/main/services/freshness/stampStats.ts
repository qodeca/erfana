// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * The stat half of a file stamp (#478, plan decision 28), with no file-system
 * or crypto import, so a reader that only stats (the image viewer's read) can
 * stamp without loading the hashing stamper.
 *
 * @module services/freshness/stampStats
 */
import type { BigIntStats } from 'node:fs'

import type { FileStamp } from '../../../shared/freshness/freshnessTypes'

/** Microseconds of a nanosecond time, as exact milliseconds (a double holds them without loss). */
function nsToMs(ns: bigint): number {
  return Number(ns / 1000n) / 1000
}

/** The stamp of a `stat({ bigint: true })` result, with the hash when there is one. */
export function stampFromStats(stats: BigIntStats, hash?: string): FileStamp {
  const base = {
    size: Number(stats.size),
    mtimeMs: nsToMs(stats.mtimeNs),
    ctimeMs: nsToMs(stats.ctimeNs),
    ino: stats.ino.toString(),
  }
  return hash === undefined ? base : { ...base, hash }
}

/** Two stats describe the same, unmoved file (size, both times and id). */
export function sameStats(a: BigIntStats, b: BigIntStats): boolean {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino
}
