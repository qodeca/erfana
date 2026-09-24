// Fixed application-gate dependency schedule. Workers never mutate attempt.json.
//
// THE INDEXES ARE POSITIONS IN `repo-gates.sh`'s canonical list, one-based. Nothing here knows
// which gates a project has: `repo-gates.sh` passes the application phase's entries, and the
// lanes come from `GATE_APPLICATION_LANES` beside the list (`3,6,7;4;5` — lanes split by `;`,
// a lane's gates by `,`, run in that order). Unset or empty means one lane in list order. The
// lanes must name every application gate exactly once, or the phase is refused: a gate that
// silently never ran is the one failure this file exists to prevent.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [library, mode, rawEntries] = process.argv.slice(2);
const entries = JSON.parse(rawEntries);
const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
if (!['application', 'serial'].includes(mode) || !entries.length || byIndex.size !== entries.length ||
    entries.some(e => !Number.isInteger(e.index) || e.index < 1 || typeof e.name !== 'string' || !e.name || typeof e.command !== 'string' || !e.command)) {
  throw new Error('invalid gate phase');
}
const APPLICATION_LANES = (() => {
  if (mode !== 'application') return [];
  const raw = (process.env.GATE_APPLICATION_LANES ?? '').trim();
  if (!raw) return [entries.map((e) => e.index)];
  const lanes = raw.split(';').map((l) => l.split(',').map((n) => Number(n.trim())));
  const named = lanes.flat();
  if (named.some((n) => !Number.isInteger(n)) || named.length !== entries.length ||
      new Set(named).size !== named.length || named.some((n) => !byIndex.has(n))) {
    throw new Error(`invalid GATE_APPLICATION_LANES "${raw}": it must name each application gate (${[...byIndex.keys()].join(', ')}) exactly once`);
  }
  return lanes;
})();
if (process.platform === 'win32') throw new Error('gate process-group supervision requires a POSIX host');
const directory = join(process.env.GATE_ATTEMPT_DIR, 'workers');
mkdirSync(directory, { recursive: true });
const groups = new Set();
let stopped = false;
let infrastructureFailed = false;
const posix = process.platform !== 'win32';
const worker = '. "$1"; GATE_INDEX=$(($2-1)); GATE_WORKER_RESULT="$GATE_ATTEMPT_DIR/workers/$2.json"; gate_run "$3" bash -c "$4"';

function signal(pid, kind) {
  try { process.kill(posix ? -pid : pid, kind); }
  catch (error) { if (error.code !== 'ESRCH') infrastructureFailed = true; }
}
function interrupt() {
  stopped = true;
  for (const pid of groups) signal(pid, 'SIGTERM');
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

// A worker's close does not prove its descendants exited. Its owned POSIX group
// gets a bounded cleanup, even when a grandchild ignores TERM or the worker exited first.
async function reap(pid) {
  if (!posix) return;
  try { process.kill(-pid, 0); } catch (error) {
    if (error.code === 'ESRCH') return;
    infrastructureFailed = true;
  }
  signal(pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 2000));
  signal(pid, 'SIGKILL');
}

async function run(entry) {
  if (stopped) return;
  try {
    const child = spawn('bash', ['-c', worker, 'gate-worker', library,
      String(entry.index), entry.name, entry.command], {
      detached: posix, stdio: ['ignore', 'ignore', 'ignore'], env: process.env,
    });
    const pid = child.pid;
    if (pid) groups.add(pid);
    // Command output goes to durable gate logs. No pipe can be held by a descendant.
    await new Promise((resolve) => {
      let killTimer;
      const escalate = () => {
        if (!pid) return;
        signal(pid, 'SIGTERM');
        killTimer ??= setTimeout(() => signal(pid, 'SIGKILL'), 2000);
      };
      process.on('SIGINT', escalate);
      process.on('SIGTERM', escalate);
      child.on('error', () => { infrastructureFailed = true; });
      child.on('close', (code, sig) => {
        try {
          writeFileSync(join(directory, `${entry.index}.exit.json`), JSON.stringify({code, signal: sig}), {flag: 'wx', mode: 0o600});
          const result = JSON.parse(readFileSync(join(directory, `${entry.index}.json`), 'utf8'));
          const expected = result.status === 'not-run' ? 1 : result.exitCode;
          if (sig || code === null || code !== expected) infrastructureFailed = true;
        } catch { infrastructureFailed = true; }
        if (killTimer) clearTimeout(killTimer);
        process.off('SIGINT', escalate);
        process.off('SIGTERM', escalate);
        resolve();
      });
      if (stopped) escalate();
    });
    if (pid) { await reap(pid); groups.delete(pid); }
  } catch (error) {
    infrastructureFailed = true;
    process.stderr.write(`gate scheduler: ${error.message}\n`);
  }
}
async function lane(indices) {
  for (const index of indices) {
    if (stopped) break;
    await run(byIndex.get(index)); // ordinary failure never skips a successor
  }
}
await Promise.all((mode === 'application' ? APPLICATION_LANES : [entries.map(e => e.index)]).map(lane));
process.exitCode = stopped ? 130 : infrastructureFailed ? 1 : 0;
