// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scheduler = fileURLToPath(new URL('./gate-parallel.mjs', import.meta.url));
const indices = [3, 4, 5, 6, 7, 8, 9];
const gateName = (index) => index === 7 ? 'npm run test:cov' : index === 8 ? 'npx electron-vite build' : `gate-${index}`;

function runSchedule(override, expectedStatus = 0, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'gate-lanes-'));
  const library = join(directory, 'library.sh');
  const events = join(directory, 'events');
  writeFileSync(library, `gate_run() {\n  local name="$1"; shift\n  "$@"\n  local code=$?\n  printf '{"status":"%s","exitCode":%s}\\n' "$([ "$code" -eq 0 ] && echo passed || echo failed)" "$code" > "$GATE_WORKER_RESULT"\n  return "$code"\n}\n`);
  const entries = (options.indices ?? indices).map((index) => ({
    index,
    name: options.renameIndex === index ? `renamed gate-${index}` : options.names?.[index] ?? gateName(index),
    command: `printf 'start ${index}\\n' >> '${events}'; sleep 0.2; printf 'end ${index}\\n' >> '${events}'`,
  }));
  const env = { ...process.env, GATE_ATTEMPT_DIR: directory };
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
    error: 'dropped from the gate by #170',
  });
  assert.deepEqual(events, []);
});

test('application run refuses a schedule changed after recording', () => {
  const events = runSchedule(indices.join(','), 1, {recordedOverride: null, error: 'application schedule changed'});
  assert.deepEqual(events, []);
});

test('renaming coverage or build does not disable their ordering guard', () => {
  for (const renameIndex of [7, 8]) {
    const events = runSchedule(undefined, 1, {renameIndex, error: 'guarded application command was renamed'});
    assert.deepEqual(events, []);
  }
});

test('schedule description records the default source and resolved lanes', () => {
  const entries = indices.map(index => ({index, name: gateName(index), command: 'true'}));
  const env = { ...process.env };
  delete env.GATE_APPLICATION_LANES;
  const result = spawnSync(process.execPath, [scheduler, '--describe', JSON.stringify(entries)], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { source: 'config', raw: '3,4,5,6,9;7,8', lanes: [[3,4,5,6,9],[7,8]] });
});
