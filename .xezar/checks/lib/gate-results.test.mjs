// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
//
// #170 dropped `npm run test:ci` from the canonical gate list, which changes the command-list id.
// A task's seal compares its record against the list in ITS OWN checkout, so an attempt recorded
// before the switch and one recorded after it must both seal and both verify: no result is
// rejected mid-wave. A record whose id no longer matches its own checkout is refused and re-run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const results = fileURLToPath(new URL('./gate-results.mjs', import.meta.url));
const repoGates = fileURLToPath(new URL('../repo-gates.sh', import.meta.url));

const BEFORE_170 = [
  'npm ci', '.xezar/checks/security-scan.sh', 'npm run lint:check', 'npm run lint:css',
  'npm run design -- --check', 'npm run typecheck', 'npm run test:ci', 'npm run test:cov',
  'npx electron-vite build', 'npm run check:headers', '.xezar/checks/repository-checks.sh',
];
const AFTER_170 = BEFORE_170.filter(name => name !== 'npm run test:ci');
// The same derivation as repo-gates.sh's gate_list_id: sha256 of the {name, command} JSON list.
const listId = names => createHash('sha256').update(JSON.stringify(names.map(name => ({ name, command: name })))).digest('hex');
const OLD_ID = listId(BEFORE_170);
const NEW_ID = listId(AFTER_170);

function cli(...args) {
  return spawnSync(process.execPath, [results, ...args], { encoding: 'utf8' });
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'gate-seal-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'file.txt'), 'x\n');
  git('add', 'file.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init');
  return { repo, head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
}

// One passing gate attempt recorded through the same CLI repo-gates.sh uses, then sealed.
function recordAndSeal({ repo, head, tree }, runId, names, commandListId, expectedListId = commandListId) {
  const runDir = join(repo, '.local/xezar/tasks', runId);
  const gatesRoot = join(runDir, 'gates');
  mkdirSync(gatesRoot, { recursive: true });
  const claim = JSON.parse(cli('reserve', '--gates-root', gatesRoot, '--head', head, '--stamp', '1', '--pid', '1').stdout);
  const fingerprint = { headSha: head, treeFingerprint: 'tree-fp', depsFingerprint: 'deps-fp' };
  assert.equal(cli('begin', '--dir', claim.attemptDir, '--json', JSON.stringify({
    attemptId: claim.attemptId, sequence: claim.sequence, runId, producer: 'gates', branch: 'feature/x',
    baseRef: 'origin/develop', baseSha: head, headSha: head, treeSha: tree, commandListId,
    required: names, repo: null, before: fingerprint,
  })).status, 0);
  names.forEach((name, i) => {
    const log = `${String(i + 1).padStart(2, '0')}.log`;
    const logHeader = `# ${name}\n`;
    writeFileSync(join(claim.attemptDir, 'logs', log), `${logHeader}ok\n`);
    assert.equal(cli('record', '--dir', claim.attemptDir, '--json', JSON.stringify({ name, command: name, status: 'passed', exitCode: 0, log, logHeader })).status, 0);
  });
  writeFileSync(join(claim.attemptDir, 'security.json'), JSON.stringify({ kind: 'xezar.security-result', schemaVersion: 1, status: 'pass', head }));
  const complete = cli('complete', '--dir', claim.attemptDir, '--json', JSON.stringify({ after: fingerprint, endedAt: 'now' }), '--install-gate', 'npm ci');
  assert.equal(complete.stdout.trim(), 'passed', complete.stderr);
  const manifest = join(runDir, 'manifest.json');
  const seal = cli('seal', '--manifest', manifest, '--gates-root', gatesRoot, '--json', JSON.stringify({
    headSha: head, treeSha: tree, branch: 'feature/x', commandListId: expectedListId, treeFingerprint: 'tree-fp',
    depsFingerprint: 'deps-fp', dirty: false, securityGate: '.xezar/checks/security-scan.sh', installGate: 'npm ci',
  }));
  return { seal, manifest };
}

function verify(repo, manifest, currentListId) {
  const result = cli('verify', '--manifest', manifest, '--repo', repo, '--command-list-id', currentListId,
    '--deps-fingerprint', 'deps-fp', '--install-gate', 'npm ci', '--json');
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test('the committed gate list is the #170 list, without test:ci', () => {
  const listed = JSON.parse(execFileSync('bash', [repoGates, '--list', '--json'], { encoding: 'utf8' }));
  assert.deepEqual(listed.gates.map(g => g.name), AFTER_170);
  assert.equal(listed.commandListId, NEW_ID);
  assert.notEqual(OLD_ID, NEW_ID);
});

test('attempts recorded before and after #170 both seal and verify against their own list', () => {
  const fx = fixture();
  try {
    const before = recordAndSeal(fx, 'run-before-170', BEFORE_170, OLD_ID);
    assert.equal(before.seal.status, 0, before.seal.stderr);
    const after = recordAndSeal(fx, 'run-after-170', AFTER_170, NEW_ID);
    assert.equal(after.seal.status, 0, after.seal.stderr);

    // Audited from a checkout that already has the new list: the old seal stays VERIFIED
    // history, and is only reported as not reusable for new work.
    const old = verify(fx.repo, before.manifest, NEW_ID);
    assert.equal(old.status, 0);
    assert.equal(old.report.historicalValidity, 'VERIFIED');
    assert.equal(old.report.reusableHere, 'no');
    assert.deepEqual(old.report.inputComparison.differing, ['the current gate command list']);

    const current = verify(fx.repo, after.manifest, NEW_ID);
    assert.equal(current.status, 0);
    assert.equal(current.report.historicalValidity, 'VERIFIED');
    assert.equal(current.report.reusableHere, 'yes');
    assert.equal(JSON.parse(readFileSync(after.manifest, 'utf8')).gateEvidence.commandListId, NEW_ID);
  } finally {
    rmSync(fx.repo, { recursive: true, force: true });
  }
});

test('an old-list attempt sealed from a checkout that already has the new list is refused, so the gates re-run', () => {
  const fx = fixture();
  try {
    const { seal } = recordAndSeal(fx, 'run-mixed-170', BEFORE_170, OLD_ID, NEW_ID);
    assert.equal(seal.status, 1);
    assert.match(seal.stderr, /commandListId changed since the attempt/);
  } finally {
    rmSync(fx.repo, { recursive: true, force: true });
  }
});
