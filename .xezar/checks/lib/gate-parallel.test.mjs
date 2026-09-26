// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scheduler = fileURLToPath(new URL('./gate-parallel.mjs', import.meta.url));
const repoGates = fileURLToPath(new URL('../repo-gates.sh', import.meta.url));
const indices = [3, 4, 5, 6, 7, 8, 9];
// The shipped application gates, by their one-based position in repo-gates.sh.
const shipped = {
  3: 'npm run lint:check', 4: 'npm run lint:css', 5: 'npm run design -- --check', 6: 'npm run typecheck',
  7: 'npm run test:cov', 8: 'npx electron-vite build', 9: 'npm run check:headers',
};
const gateName = (index) => shipped[index] ?? `gate-${index}`;
// The scheduler only runs canonical commands, so the harness runs them for real through
// stand-in npm and npx scripts on PATH that record which gate started and ended.
const fakeTool = (tool, events) => `#!/bin/sh
i=
${Object.entries(shipped).filter(([, c]) => c.startsWith(`${tool} `)).map(([i, c]) => `[ "$*" = "${c.slice(tool.length + 1)}" ] && i=${i}`).join('\n')}
[ -n "$i" ] || exit 9
printf 'start %s\\n' "$i" >> '${events}'; sleep 0.2; printf 'end %s\\n' "$i" >> '${events}'
`;

function runSchedule(override, expectedStatus = 0, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gate-lanes-'));
  const library = join(directory, 'library.sh');
  const events = join(directory, 'events');
  writeFileSync(library, `gate_run() {\n  local name="$1"; shift\n  "$@"\n  local code=$?\n  printf '{"status":"%s","exitCode":%s}\\n' "$([ "$code" -eq 0 ] && echo passed || echo failed)" "$code" > "$GATE_WORKER_RESULT"\n  return "$code"\n}\n`);
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const tool of ['npm', 'npx']) writeFileSync(join(bin, tool), fakeTool(tool, events), { mode: 0o755 });
  const entries = (options.indices ?? indices).map((index) => ({
    index,
    name: options.renameIndex === index ? `renamed gate-${index}` : options.names?.[index] ?? gateName(index),
    command: options.commands?.[index] ?? gateName(index),
  }));
  const env = { ...process.env, GATE_ATTEMPT_DIR: directory, PATH: `${bin}:${process.env.PATH}` };
  if (override === undefined) delete env.GATE_APPLICATION_LANES;
  else env.GATE_APPLICATION_LANES = override;
  const describedEnv = { ...env };
  if (options.recordedOverride === null) delete describedEnv.GATE_APPLICATION_LANES;
  const description = spawnSync(process.execPath, [scheduler, '--describe', JSON.stringify(entries)], { env: describedEnv, encoding: 'utf8' });
  const expected = description.status === 0
    ? description.stdout.trim()
    : JSON.stringify({source: 'config', raw: '3,4,5,6,9;7,8', lanes: [[3,4,5,6,9],[7,8]]});
  const result = spawnSync(process.execPath, [scheduler, library, 'application', JSON.stringify(entries), expected], { env, encoding: 'utf8' });
  const lines = existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n') : [];
  rmSync(directory, { recursive: true, force: true });
  assert.equal(result.status, expectedStatus, result.stderr);
  if (options.error) assert.match(result.stderr, new RegExp(options.error));
  return lines;
}

test('default schedule starts coverage before lint and other application work finish', () => {
  const events = runSchedule();
  assert.ok(events.indexOf('start 7') < events.indexOf('end 6'), events.join(', '));
  assert.ok(events.indexOf('start 7') < events.indexOf('end 9'), events.join(', '));
  assert.ok(events.indexOf('start 8') > events.indexOf('end 7'), events.join(', '));
});

test('default schedule runs every application gate exactly once and no separate unit-test gate', () => {
  const events = runSchedule();
  assert.deepEqual(events.filter(e => e.startsWith('start ')).sort(), indices.map(i => `start ${i}`).sort());
});

test('environment lane override can restore serial order', () => {
  const events = runSchedule(indices.join(','));
  assert.ok(events.indexOf('start 7') > events.indexOf('end 6'), events.join(', '));
});

test('override cannot overlap coverage with build', () => {
  const events = runSchedule('3,4,5,6,8,9;7', 1, {error: 'coverage and build must share a lane'});
  assert.deepEqual(events, []);
});

test('override cannot run build before coverage', () => {
  const events = runSchedule('3,4,5,6,9;8,7', 1, {error: 'coverage before build'});
  assert.deepEqual(events, []);
});

test('bringing test:ci back into the gate is refused, even sharing the coverage lane', () => {
  const events = runSchedule('3,4,5,6,9;7,10,8', 1, {
    indices: [...indices, 10],
    names: {10: 'npm run test:ci'},
    error: 'not a canonical gate identity',
  });
  assert.deepEqual(events, []);
});

test('application run refuses a schedule changed after recording', () => {
  const events = runSchedule(indices.join(','), 1, {recordedOverride: null, error: 'application schedule changed'});
  assert.deepEqual(events, []);
});

test('any application gate outside the allowlist is refused, whatever it is called', () => {
  const cases = {
    'quoted script name': ['unit tests', `npm run 'test:ci'`],
    'npm test': ['npm test', 'npm test'],
    'npm run test': ['npm run test', 'npm run test'],
    'npm run-script alias': ['npm run-script test:ci', 'npm run-script test:ci'],
    'inner whitespace': ['npm run  test:cov', 'npm run  test:cov'],
    'unknown command': ['npm run lint:fix', 'npm run lint:fix'],
    'harmless label mention': ['document test:ci removal', 'npm run check:headers'],
  };
  for (const [label, [name, command]] of Object.entries(cases)) {
    const events = runSchedule('3,4,5,6,9,10;7,8', 1, {
      indices: [...indices, 10], names: {10: name}, commands: {10: command},
      error: 'not a canonical gate identity; the application gates allowed by lib/gate-parallel.mjs APPLICATION_GATES are',
    });
    assert.deepEqual(events, [], label);
  }
});

test('outer whitespace is trimmed, so a padded canonical entry still runs', () => {
  const events = runSchedule(undefined, 0, {names: {3: ' npm run lint:check '}, commands: {3: 'npm run lint:check\n'}});
  assert.ok(events.includes('start 3'), events.join(', '));
});

test('a canonical gate named twice is refused', () => {
  const events = runSchedule('3,4,5,6,9,10;7,8', 1, {indices: [...indices, 10], names: {10: 'npm run typecheck'}, commands: {10: 'npm run typecheck'}, error: 'named more than once'});
  assert.deepEqual(events, []);
});

test('renaming coverage or build is refused, as is a label over another canonical command', () => {
  for (const renameIndex of [7, 8]) {
    const events = runSchedule(undefined, 1, {renameIndex, error: 'not a canonical gate identity'});
    assert.deepEqual(events, []);
  }
  const events = runSchedule(undefined, 1, {commands: {7: 'npm run typecheck'}, error: 'not a canonical gate identity'});
  assert.deepEqual(events, []);
});

test('renaming or removing both coverage and build refuses instead of switching the ordering guard off', () => {
  const renamed = runSchedule('3,4,5,6,9;8,7', 1, {names: {7: 'coverage', 8: 'build'}, commands: {7: 'true', 8: 'true'}, error: 'not a canonical gate identity'});
  assert.deepEqual(renamed, []);
  const removed = runSchedule('3,4,5,6,9', 1, {indices: [3, 4, 5, 6, 9], error: 'guarded application gate "npm run test:cov" is missing'});
  assert.deepEqual(removed, []);
});

test('every application gate repo-gates.sh ships is accepted', () => {
  const listed = spawnSync('bash', [repoGates, '--list', '--json'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const gates = JSON.parse(listed.stdout).gates;
  // Application gates are positions 3 to the one before last, as repo-gates.sh selects them.
  const entries = gates.map((gate, i) => ({index: i + 1, ...gate})).slice(2, -1);
  assert.deepEqual(Object.fromEntries(entries.map(e => [e.index, e.command])), shipped);
  const env = { ...process.env };
  delete env.GATE_APPLICATION_LANES;
  const result = spawnSync(process.execPath, [scheduler, '--describe', JSON.stringify(entries)], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('schedule description records the default source and resolved lanes', () => {
  const entries = indices.map(index => ({index, name: gateName(index), command: gateName(index)}));
  const env = { ...process.env };
  delete env.GATE_APPLICATION_LANES;
  const result = spawnSync(process.execPath, [scheduler, '--describe', JSON.stringify(entries)], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { source: 'config', raw: '3,4,5,6,9;7,8', lanes: [[3,4,5,6,9],[7,8]] });
});
