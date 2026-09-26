// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scheduler = fileURLToPath(new URL('./gate-parallel.mjs', import.meta.url));
const indices = [3, 4, 5, 6, 7, 8, 9, 10];

function runSchedule(override) {
  const directory = mkdtempSync(join(tmpdir(), 'gate-lanes-'));
  const library = join(directory, 'library.sh');
  const events = join(directory, 'events');
  writeFileSync(library, `gate_run() {\n  local name="$1"; shift\n  "$@"\n  local code=$?\n  printf '{"status":"%s","exitCode":%s}\\n' "$([ "$code" -eq 0 ] && echo passed || echo failed)" "$code" > "$GATE_WORKER_RESULT"\n  return "$code"\n}\n`);
  const entries = indices.map((index) => ({
    index,
    name: `gate-${index}`,
    command: `printf 'start ${index}\\n' >> '${events}'; sleep 0.2; printf 'end ${index}\\n' >> '${events}'`,
  }));
  const env = { ...process.env, GATE_ATTEMPT_DIR: directory };
  if (override === undefined) delete env.GATE_APPLICATION_LANES;
  else env.GATE_APPLICATION_LANES = override;
  const result = spawnSync(process.execPath, [scheduler, library, 'application', JSON.stringify(entries)], { env, encoding: 'utf8' });
  const lines = readFileSync(events, 'utf8').trim().split('\n');
  rmSync(directory, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  return lines;
}

test('default schedule starts coverage before lint and other application work finish', () => {
  const events = runSchedule();
  assert.ok(events.indexOf('start 8') < events.indexOf('end 6'), events.join(', '));
  assert.ok(events.indexOf('start 8') < events.indexOf('end 7'), events.join(', '));
});

test('environment lane override can restore serial order', () => {
  const events = runSchedule(indices.join(','));
  assert.ok(events.indexOf('start 8') > events.indexOf('end 7'), events.join(', '));
});
