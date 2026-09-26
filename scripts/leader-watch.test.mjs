// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { URL } from 'node:url'
import {
  evaluate,
  findWaitingRun,
  formatLogLine,
  lastAlertFrom,
  lastCampaignCommitMs,
  listRuns,
  main,
  newestCampaignFileMs,
  notify,
  parseLimit,
  readTail,
  TITLE,
} from './leader-watch.mjs'

const MIN = 60_000
const LIMIT = 30 * MIN
const POLL = 5 * MIN
const UUID = (p) => `${p}-0000-4000-8000-000000000000.ndjson`

// Replay of the release-0.21.0 campaign the spike measured: real leader commit
// times and real run-log write times, names and times only.
const fx = JSON.parse(readFileSync(new URL('./fixtures/leader-watch-replay.json', import.meta.url), 'utf8'))
const BASE = Date.parse(fx.base)

function stateAt(nowMs) {
  const s = (nowMs - BASE) / 1000
  const leaderAtMs = BASE + fx.leaderCommits.filter((t) => t <= s).pop() * 1000
  const runs = []
  for (const [id, times] of Object.entries(fx.runs)) {
    const t = times.filter((x) => x <= s).pop()
    if (t !== undefined) runs.push({ id, mtimeMs: BASE + t * 1000 })
  }
  return { leaderAtMs, runs }
}

// Polls every five minutes, as the launchd agent does, carrying the last alert
// time forward the way the log file does.
function replay(fromIso, toIso, rule = evaluate) {
  const alerts = []
  let lastAlertMs = null
  for (let nowMs = Date.parse(fromIso); nowMs <= Date.parse(toIso); nowMs += POLL) {
    const alert = rule({ nowMs, ...stateAt(nowMs), limitMs: LIMIT, lastAlertMs })
    if (alert) {
      lastAlertMs = nowMs
      alerts.push({ at: new Date(nowMs).toISOString().slice(0, 16), run: alert.run })
    }
  }
  return alerts
}

describe('replay of the three real outages (spike #179)', () => {
  it('alerts within 30 to 35 minutes of outage 1 (25 11:10–12:36, run 19b6c719 waiting)', () => {
    const alerts = replay('2026-09-25T10:30:00Z', '2026-09-25T12:40:00Z')
    expect(alerts[0]).toEqual({ at: '2026-09-25T11:40', run: '19b6c719' })
    expect(alerts.map((a) => a.at)).toEqual(['2026-09-25T11:40', '2026-09-25T12:10'])
  })

  it('alerts on outage 2 (25 13:48–15:27, run 4458b282 waiting) and repeats every 30 minutes', () => {
    const alerts = replay('2026-09-25T13:20:00Z', '2026-09-25T15:30:00Z')
    expect(alerts).toEqual([
      { at: '2026-09-25T14:10', run: '4458b282' },
      { at: '2026-09-25T14:40', run: '4458b282' },
      { at: '2026-09-25T15:10', run: '4458b282' },
    ])
  })

  it('alerts on outage 3 (26 06:49–13:51, run d71e7bf0 waiting) and stops when the leader returns', () => {
    const alerts = replay('2026-09-26T06:40:00Z', '2026-09-26T14:30:00Z')
    expect(alerts[0]).toEqual({ at: '2026-09-26T07:30', run: 'd71e7bf0' })
    expect(alerts.every((a) => a.run === 'd71e7bf0')).toBe(true)
    expect(alerts.at(-1).at).toBe('2026-09-26T13:30')
    expect(alerts).toHaveLength(13)
  })
})

describe('replay of a quiet period', () => {
  // The night of 25–26 September: the leader only ticked hourly, nothing waited.
  const night = ['2026-09-25T22:00:00Z', '2026-09-26T06:45:00Z']

  it('stays quiet overnight while no run is waiting', () => {
    expect(replay(...night)).toEqual([])
  })

  it('is a real quiet period: a plain "no leader commit for 30 minutes" rule would fire there', () => {
    // Control: without the waiting-run gate the same night alerts, so the
    // test above is quiet because of the gate, not because of the data.
    const plain = ({ nowMs, leaderAtMs, lastAlertMs }) =>
      nowMs - leaderAtMs > LIMIT && (lastAlertMs === null || nowMs - lastAlertMs >= LIMIT) ? { run: '-' } : null
    expect(replay(...night, plain).length).toBeGreaterThan(0)
  })

  it('stays quiet across the whole two days apart from the outages and the one known false alert', () => {
    const alerts = replay('2026-09-24T22:00:00Z', '2026-09-26T16:25:00Z')
    const outside = alerts.filter(
      (a) =>
        !(a.at >= '2026-09-25T11:10' && a.at <= '2026-09-25T12:36') &&
        !(a.at >= '2026-09-25T13:48' && a.at <= '2026-09-25T15:27') &&
        !(a.at >= '2026-09-26T06:49' && a.at <= '2026-09-26T13:51'),
    )
    // 26 15:27–15:42 in the spike: the leader was talking with the owner and
    // did not commit. A known limit of the commit signal, kept visible here.
    expect(outside).toEqual([{ at: '2026-09-26T15:30', run: '0d8a560d' }])
  })
})

describe('findWaitingRun', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const leaderAtMs = now - 60 * MIN

  it('ignores a run written before the leader last recorded something', () => {
    expect(findWaitingRun({ nowMs: now, leaderAtMs, runs: [{ id: 'a', mtimeMs: leaderAtMs - 1 }], limitMs: LIMIT })).toBeNull()
    expect(findWaitingRun({ nowMs: now, leaderAtMs, runs: [{ id: 'a', mtimeMs: leaderAtMs }], limitMs: LIMIT })).toBeNull()
  })

  it('ignores a run written within the limit', () => {
    expect(findWaitingRun({ nowMs: now, leaderAtMs, runs: [{ id: 'a', mtimeMs: now - 10 * MIN }], limitMs: LIMIT })).toBeNull()
  })

  it('picks the run that has waited longest', () => {
    const runs = [
      { id: 'late', mtimeMs: now - 35 * MIN },
      { id: 'early', mtimeMs: now - 50 * MIN },
      { id: 'fresh', mtimeMs: now - 5 * MIN },
    ]
    expect(findWaitingRun({ nowMs: now, leaderAtMs, runs, limitMs: LIMIT })?.id).toBe('early')
  })
})

describe('evaluate', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const base = { nowMs: now, leaderAtMs: now - 50 * MIN, runs: [{ id: 'd71e7bf0', mtimeMs: now - 40 * MIN }], limitMs: LIMIT }

  it('names the run and both durations', () => {
    expect(evaluate(base)).toEqual({
      run: 'd71e7bf0',
      silentMin: 50,
      message: 'Run d71e7bf0 has waited 40 min and the leader has recorded nothing for 50 min.',
    })
  })

  it('does not repeat within the limit, and repeats after it', () => {
    expect(evaluate({ ...base, lastAlertMs: now - 29 * MIN })).toBeNull()
    expect(evaluate({ ...base, lastAlertMs: now - 30 * MIN })).not.toBeNull()
  })
})

describe('log lines', () => {
  it('reads back the time of the last alert it wrote', () => {
    const t1 = Date.parse('2026-09-26T07:30:00Z')
    const t2 = Date.parse('2026-09-26T08:00:00Z')
    const text = [
      formatLogLine(t1, { run: 'd71e7bf0', silentMin: 40 }),
      'leader-watch: osascript failed; no notification shown',
      formatLogLine(t2, { run: 'd71e7bf0', silentMin: 70 }),
      '',
    ].join('\n')
    expect(lastAlertFrom(text)).toBe(t2)
  })

  it('ignores lines that only mention an alert', () => {
    expect(lastAlertFrom('note: 2026-09-26T07:30:00.000Z alert run=x\nx 2026-09-26T07:30:00Z alert ')).toBeNull()
    expect(lastAlertFrom('')).toBeNull()
  })
})

describe('parseLimit', () => {
  it('defaults to 30 and accepts whole minutes only', () => {
    expect(parseLimit(undefined)).toBe(30)
    expect(parseLimit('')).toBe(30)
    expect(parseLimit('45')).toBe(45)
    for (const bad of ['0', '-5', '1.5', '30m', '99999', ' 30']) expect(parseLimit(bad)).toBeNull()
  })
})

describe('file-system reads', () => {
  let dir
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'leader-watch-'))
    return dir
  }
  const teardown = () => rmSync(dir, { recursive: true, force: true })
  const touch = (file, ms) => utimesSync(file, ms / 1000, ms / 1000)

  it('lists run logs by name and time, skipping other names, folders and symlinks', () => {
    setup()
    try {
      const t = Date.parse('2026-09-26T10:00:00Z')
      writeFileSync(join(dir, UUID('d71e7bf0')), '{}')
      touch(join(dir, UUID('d71e7bf0')), t)
      writeFileSync(join(dir, 'd71e7bf0-0000-4000-8000-000000000000.handoff.md'), '')
      writeFileSync(join(dir, 'notes.ndjson'), '')
      mkdirSync(join(dir, UUID('aaaaaaaa')))
      writeFileSync(join(dir, 'outside.ndjson'), '')
      symlinkSync(join(dir, 'outside.ndjson'), join(dir, UUID('bbbbbbbb')))
      expect(listRuns(dir)).toEqual([{ id: 'd71e7bf0', mtimeMs: t }])
      expect(listRuns(join(dir, 'missing'))).toEqual([])
    } finally {
      teardown()
    }
  })

  it('takes the newest file one level inside the campaign folder, not following symlinks', () => {
    setup()
    try {
      const t1 = Date.parse('2026-09-26T09:00:00Z')
      const t2 = Date.parse('2026-09-26T09:30:00Z')
      mkdirSync(join(dir, 'c1'))
      mkdirSync(join(dir, 'c1', 'deeper'))
      writeFileSync(join(dir, 'c1', 'timeline.md'), '')
      touch(join(dir, 'c1', 'timeline.md'), t1)
      writeFileSync(join(dir, 'c1', 'deeper', 'x.md'), '')
      touch(join(dir, 'c1', 'deeper', 'x.md'), t2 + MIN)
      writeFileSync(join(dir, 'c1', 'decisions.md'), '')
      touch(join(dir, 'c1', 'decisions.md'), t2)
      touch(join(dir, 'c1', 'deeper'), t2 + MIN)
      writeFileSync(join(dir, 'README.md'), '')
      touch(join(dir, 'README.md'), t2 + 2 * MIN)
      symlinkSync(join(dir, 'c1'), join(dir, 'link'))
      expect(newestCampaignFileMs(dir)).toBe(t2)
      expect(newestCampaignFileMs(join(dir, 'missing'))).toBe(0)
    } finally {
      teardown()
    }
  })

  it('reads only the tail of a long log', () => {
    setup()
    try {
      const f = join(dir, 'log')
      writeFileSync(f, 'x'.repeat(200_000) + '\nend')
      const tail = readTail(f)
      expect(tail.length).toBe(64 * 1024)
      expect(tail.endsWith('\nend')).toBe(true)
      expect(readTail(join(dir, 'missing'))).toBe('')
    } finally {
      teardown()
    }
  })
})

describe('external commands', () => {
  it('asks git for the commit time on develop only, as an argument array', () => {
    const calls = []
    const exec = (cmd, args) => {
      calls.push([cmd, args])
      return '1790000000\n'
    }
    expect(lastCampaignCommitMs('/repo', exec)).toBe(1_790_000_000_000)
    expect(calls).toEqual([['git', ['-C', '/repo', 'log', '-1', '--format=%ct', 'develop', '--', '.xezar/campaigns']]])
  })

  it('reads an empty or failing git answer as unknown', () => {
    expect(lastCampaignCommitMs('/repo', () => '')).toBeNull()
    expect(
      lastCampaignCommitMs('/repo', () => {
        throw new Error('not a git repository')
      }),
    ).toBeNull()
  })

  it('passes the message to osascript as an argument, never inside the AppleScript', () => {
    const calls = []
    const message = 'Run "x" \\ end tell -- do shell script "rm"'
    notify(message, (cmd, args) => calls.push([cmd, args]))
    const [cmd, args] = calls[0]
    expect(cmd).toBe('osascript')
    expect(args.slice(-2)).toEqual([message, TITLE])
    const script = args.filter((_, i) => args[i - 1] === '-e').join('\n')
    expect(script).not.toContain(message)
  })
})

describe('launchd template', () => {
  const plist = readFileSync(new URL('./com.qodeca.erfana.leader-watch.plist', import.meta.url), 'utf8')
  const value = (key) => plist.match(new RegExp(`<key>${key}</key><string>([^<]*)</string>`))?.[1]

  it('logs stdout to the same file the script reads its last alert from, so alerts do not repeat every poll', () => {
    expect(value('LEADER_WATCH_LOG')).toBeTruthy()
    expect(value('StandardOutPath')).toBe(value('LEADER_WATCH_LOG'))
  })

  it('runs this script against the repository it names, every five minutes', () => {
    expect(plist).toContain('<string>__REPO__/scripts/leader-watch.mjs</string>')
    expect(value('LEADER_WATCH_REPO')).toBe('__REPO__')
    expect(plist).toMatch(/<key>StartInterval<\/key><integer>300<\/integer>/)
  })
})

describe('main', () => {
  const now = Date.parse('2026-09-26T08:00:00Z')
  const runsDir = '/repo/.local/xezar/runs'
  const fakeFs = (runMs, campaignMs = 0) => ({
    readdirSync: (p) => {
      if (p === runsDir) return [UUID('d71e7bf0')]
      if (p === '/repo/.xezar/campaigns') return ['c1']
      if (p === '/repo/.xezar/campaigns/c1') return ['timeline.md']
      throw new Error('ENOENT')
    },
    lstatSync: (p) => {
      if (p.endsWith('/c1')) return { isFile: () => false, isDirectory: () => true, mtimeMs: 0 }
      if (p.endsWith('timeline.md')) return { isFile: () => true, isDirectory: () => false, mtimeMs: campaignMs }
      return { isFile: () => true, isDirectory: () => false, mtimeMs: runMs }
    },
  })
  const commitAt = (ms) => String(Math.floor(ms / 1000))

  function run({ env = {}, argv = [], runMs = now - 40 * MIN, commitMs = now - 50 * MIN, campaignMs = 0, tail = '' } = {}) {
    const out = []
    const err = []
    const calls = []
    const exec = (cmd, args) => {
      calls.push([cmd, args])
      return cmd === 'git' ? commitAt(commitMs) : ''
    }
    const code = main(argv, { LEADER_WATCH_REPO: '/repo', ...env }, {
      now: () => now,
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      exec,
      fs: fakeFs(runMs, campaignMs),
      tail: () => tail,
      platform: 'darwin',
    })
    return { code, out, err, calls }
  }

  it('notifies once and writes one log line when a run waits on a silent leader', () => {
    const r = run()
    expect(r.code).toBe(0)
    expect(r.calls.map((c) => c[0])).toEqual(['git', 'osascript'])
    expect(r.out).toEqual(['2026-09-26T08:00:00.000Z alert run=d71e7bf0 leader-silent=50m'])
    expect(r.err).toEqual([])
  })

  it('stays quiet when the leader ticked in the campaign folder after the run stopped', () => {
    const r = run({ campaignMs: now - 20 * MIN })
    expect(r.calls.map((c) => c[0])).toEqual(['git'])
    expect(r.out).toEqual([])
  })

  it('does not repeat an alert logged within the limit', () => {
    const r = run({ env: { LEADER_WATCH_LOG: '/log' }, tail: `${new Date(now - 10 * MIN).toISOString()} alert run=d71e7bf0 leader-silent=40m\n` })
    expect(r.calls.map((c) => c[0])).toEqual(['git'])
    expect(r.out).toEqual([])
  })

  it('prints instead of notifying on --dry-run, on any platform', () => {
    const r = run({ argv: ['--dry-run'] })
    expect(r.calls.map((c) => c[0])).toEqual(['git'])
    expect(r.out[0]).toContain('(dry run) Run d71e7bf0 has waited 40 min')
  })

  it('refuses a missing or relative repository, a bad limit, and a non-macOS notification', () => {
    expect(run({ env: { LEADER_WATCH_REPO: '' } }).code).toBe(2)
    expect(run({ env: { LEADER_WATCH_REPO: 'erfana' } }).code).toBe(2)
    expect(run({ env: { LEADER_WATCH_MINUTES: 'soon' } }).code).toBe(2)
    const linux = main([], { LEADER_WATCH_REPO: '/repo' }, { err: () => {}, platform: 'linux', exec: () => { throw new Error('must not run') } })
    expect(linux).toBe(2)
  })

  it('checks nothing when git cannot give the leader commit time', () => {
    const r = run({ commitMs: 0 })
    expect(r.code).toBe(1)
    expect(r.calls.map((c) => c[0])).toEqual(['git'])
    expect(r.err[0]).toContain('nothing checked')
  })

  it('logs a failed notification to stderr and writes no alert line, so the next poll retries', () => {
    const out = []
    const err = []
    const code = main([], { LEADER_WATCH_REPO: '/repo' }, {
      now: () => now,
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      exec: (cmd) => {
        if (cmd === 'git') return commitAt(now - 50 * MIN)
        throw new Error('osascript: not allowed')
      },
      fs: fakeFs(now - 40 * MIN),
      tail: () => '',
      platform: 'darwin',
    })
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual(['leader-watch: osascript failed; no notification shown'])
  })

  it('reports unreadable metadata in fixed text, without the path or a stack, and never alerts', () => {
    const secretPath = '/Users/some-login/erfana/.xezar/campaigns/c1/timeline.md'
    for (const failing of ['/c1', 'timeline.md', '.ndjson']) {
      const base = fakeFs(now - 40 * MIN)
      const fs = {
        readdirSync: base.readdirSync,
        lstatSync: (p, opts) => {
          if (p.endsWith(failing)) {
            const e = new Error(`EACCES: permission denied, lstat '${secretPath}'`)
            e.code = 'EACCES'
            e.path = secretPath
            throw e
          }
          return base.lstatSync(p, opts)
        },
      }
      const out = []
      const err = []
      const calls = []
      const code = main([], { LEADER_WATCH_REPO: '/repo' }, {
        now: () => now,
        out: (s) => out.push(s),
        err: (s) => err.push(s),
        exec: (cmd) => {
          calls.push(cmd)
          return commitAt(now - 50 * MIN)
        },
        fs,
        tail: () => '',
        platform: 'darwin',
      })
      expect(code).toBe(1)
      expect(calls).toEqual(['git'])
      expect(out).toEqual([])
      expect(err).toEqual(['leader-watch: metadata unavailable; nothing checked'])
      const printed = [...out, ...err].join('\n')
      expect(printed).not.toContain('/repo')
      expect(printed).not.toContain('some-login')
      expect(printed).not.toMatch(/\bat \S+ \(|EACCES/)
    }
  })
})
