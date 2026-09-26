// Fixture coverage for the dispatch brief catalogue guard (#175).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checks = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(checks, '..', '..');
const checker = path.join(checks, 'briefs-check.mjs');
const originalBriefs = readFileSync(path.join(repositoryRoot, '.xezar/docs/briefs.md'), 'utf8');
const scratch = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'briefs-check-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function run(name, text) {
  const briefs = path.join(scratch, `${(counter += 1)}-${name}.md`);
  writeFileSync(briefs, text);
  return spawnSync(process.execPath, [checker, repositoryRoot, briefs], { encoding: 'utf8' });
}

test('passes for the complete brief catalogue', () => {
  const result = run('complete', originalBriefs);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^briefs-check: 48 routing rows covered exactly once$/m);
});

test('fails when a routing-row heading is missing', () => {
  const result = run('missing', originalBriefs.replace(/^## Tracker only \(`tracker-only`\)[\s\S]*?(?=^## )/m, ''));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing routing row headings: tracker-only/);
});

test('fails when a routing-row heading is duplicated', () => {
  const result = run('duplicate', `${originalBriefs}\n## Duplicate tracker row (\`tracker-only\`)\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate routing row headings: tracker-only/);
});

test('fails when a heading names an unknown routing row', () => {
  const result = run('unknown', `${originalBriefs}\n## Unknown row (\`unknown-row\`)\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown routing row headings: unknown-row/);
});
