// Fixed application-gate dependency schedule. Workers never mutate attempt.json.
//
// THE INDEXES ARE POSITIONS IN `repo-gates.sh`'s canonical list, one-based. The caller passes
// the application phase's entries; the coverage and build commands carry ordering constraints, and the
// lanes come from committed pipeline config, with `GATE_APPLICATION_LANES` overriding it.
// Lanes split by `;`, a lane's gates by `,`, run in that order. An explicitly empty override
// means one lane in list order. The
// lanes must name every application gate exactly once, or the phase is refused: a gate that
// silently never ran is the one failure this file exists to prevent.
import { spawn } from 'node:child_process';
import { constants, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function configuredLanes() {
  // Fixed path, confined to this checkout. Bound the JSON and lane input before parsing;
  // there is no recursive walk, path probing from input, or regular-expression matching.
  const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
  const file = realpathSync(fileURLToPath(new URL('../../pipeline/config.json', import.meta.url)));
  const rel = relative(root, file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('gate config escapes repository');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    if (size > 65536) throw new Error('gate config exceeds 64 KiB');
    const bytes = Buffer.alloc(65537);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count > 65536) throw new Error('gate config exceeds 64 KiB');
    const lanes = JSON.parse(bytes.subarray(0, count).toString('utf8')).validation?.applicationLanes;
    if (lanes == null) return '';
    if (typeof lanes !== 'string' || lanes.length > 256) throw new Error('invalid configured application lanes');
    return lanes;
  } finally { closeSync(fd); }
}

const describing = process.argv[2] === '--describe';
const [library, mode, rawEntries, expectedScheduleJson] = describing
  ? [null, 'application', process.argv[3]]
  : process.argv.slice(2);
const entries = JSON.parse(rawEntries);
const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
if (!['application', 'serial'].includes(mode) || !entries.length || byIndex.size !== entries.length ||
    entries.some(e => !Number.isInteger(e.index) || e.index < 1 || typeof e.name !== 'string' || !e.name || typeof e.command !== 'string' || !e.command)) {
  throw new Error('invalid gate phase');
}
const laneSource = process.env.GATE_APPLICATION_LANES === undefined ? 'config' : 'environment';
const laneRaw = mode === 'application'
  ? (process.env.GATE_APPLICATION_LANES ?? configuredLanes()).trim()
  : '';
const APPLICATION_LANES = (() => {
  if (mode !== 'application') return [];
  const raw = laneRaw;
  if (!raw) return [entries.map((e) => e.index)];
  const lanes = raw.split(';').map((l) => l.split(',').map((n) => Number(n.trim())));
  const named = lanes.flat();
  if (named.some((n) => !Number.isInteger(n)) || named.length !== entries.length ||
      new Set(named).size !== named.length || named.some((n) => !byIndex.has(n))) {
    throw new Error(`invalid GATE_APPLICATION_LANES "${raw}": it must name each application gate (${[...byIndex.keys()].join(', ')}) exactly once`);
  }
  return lanes;
})();
if (mode === 'application') {
  // The guards bind to gate identities – the executable command, not only its display label –
  // and compare whitespace-normalised words, so a relabel or respacing cannot slip past them.
  const words = (text) => text.trim().split(/\s+/);
  const normal = (text) => words(text).join(' ');
  // #170 removed the separate unit-test gate on purpose: `test:cov` runs every unit test once and
  // enforces the floors. Naming it again would run the suite twice, and beside coverage it would
  // collide on test fixtures, so a list that brings it back – under any label, spelling or npm
  // alias (`run-script`) – is refused rather than scheduled.
  if (entries.some(e => words(e.name).includes('test:ci') || words(e.command).includes('test:ci'))) {
    throw new Error('npm run test:ci was dropped from the gate by #170 (test:cov runs every unit test); remove it or update the schedule constraints');
  }
  // Both are mandatory whenever application gates run: coverage deletes and rewrites out/, which
  // the build also writes, so they must share a lane with coverage first. A list missing either
  // identity is refused, never scheduled with the ordering guard switched off.
  const guarded = (identity) => {
    const matches = entries.filter(e => normal(e.name) === identity || normal(e.command) === identity);
    if (matches.length !== 1) {
      throw new Error(`guarded application gate "${identity}" is ${matches.length ? 'named more than once' : 'missing (renamed or removed)'}; update the schedule constraints`);
    }
    const [entry] = matches;
    if (normal(entry.name) !== identity || normal(entry.command) !== identity) {
      throw new Error(`guarded application gate "${identity}" has a label/command mismatch; update the schedule constraints`);
    }
    return entry.index;
  };
  const coverage = guarded('npm run test:cov');
  const build = guarded('npx electron-vite build');
  if (!APPLICATION_LANES.some(lane => lane.indexOf(coverage) >= 0 && lane.indexOf(build) > lane.indexOf(coverage))) {
    throw new Error('coverage and build must share a lane, with coverage before build');
  }
}
const resolvedSchedule = {source: laneSource, raw: laneRaw, lanes: APPLICATION_LANES};
if (describing) {
  process.stdout.write(`${JSON.stringify(resolvedSchedule)}\n`);
  process.exit(0);
}
if (mode === 'application') {
  let expected;
  try { expected = JSON.parse(expectedScheduleJson); } catch { throw new Error('missing or invalid recorded application schedule'); }
  if (JSON.stringify(expected) !== JSON.stringify(resolvedSchedule)) {
    throw new Error('application schedule changed after it was recorded; refusing to run');
  }
}
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
