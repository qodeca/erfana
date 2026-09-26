// Fixture tests for what the leader-context loader injects from a campaign folder (#174): the whole
// of decisions.md, never an archive, and only the newest entries of the timeline. The guard cases
// (worktree, task env, not-the-leader) live in documented-output.mjs and are not repeated here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync as writeSyncReal } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Refusal, run } from './decisions-archive.mjs';

const checks = path.dirname(fileURLToPath(import.meta.url));
const scratch = realpathSync(mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'leader-context-test-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function fixture(files) {
  const root = path.join(scratch, `repo-${(counter += 1)}`);
  const campaign = path.join(root, '.xezar/campaigns/20260101-fixture');
  mkdirSync(path.join(root, '.xezar/checks'), { recursive: true });
  mkdirSync(path.join(root, '.xezar/docs'), { recursive: true });
  mkdirSync(campaign, { recursive: true });
  cpSync(path.join(checks, 'leader-context.sh'), path.join(root, '.xezar/checks/leader-context.sh'));
  writeFileSync(path.join(root, '.xezar/docs/leader-guide.md'), '# Fixture leader guide\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(campaign, name), text);
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'add', '-A'],
    ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'fixture'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return { root, campaign };
}

function load(root) {
  const env = { ...process.env, XEZAR_LEADER: '1' };
  delete env.XEZ_HANDOFF_FILE;
  delete env.XEZ_TODOS_FILE;
  delete env.XEZ_TASK_ID;
  const result = spawnSync('bash', [path.join(root, '.xezar/checks/leader-context.sh')], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
}

// Run from the fixture repository, as the script requires.
function archive(campaign, ...args) {
  const root = path.resolve(campaign, '../../..');
  return spawnSync('node', [path.join(checks, 'decisions-archive.mjs'), campaign, ...args], { cwd: root, encoding: 'utf8' });
}

function longDecisions() {
  const open = '- 2026-01-01 09:00 CEST - chat - "OPEN-DECISION: never merge on a red Windows check"\n  Standing rule: still binding.\n';
  const filler = Array.from(
    { length: 3000 },
    (_, i) => `- 2026-01-02 10:${String(i % 60).padStart(2, '0')} CEST - chat - "filler decision ${i} ${'x'.repeat(80)}"\n`,
  ).join('');
  return { open, text: `# Decisions\n\nOwner decisions in the owner's exact words, dated, append-only.\n\n${open}${filler}- 2026-01-03 LAST-DECISION\n` };
}

function timeline(count) {
  return `# Timeline 2026-01-01\n\n${Array.from({ length: count }, (_, i) => `- 2026-01-01 ${String(i).padStart(4, '0')} - EVENT-${i}\n  detail of event ${i}\n`).join('')}`;
}

test('(1) an open decision near the start of a long decisions.md is injected whole', () => {
  const { open, text } = longDecisions();
  assert.ok(Buffer.byteLength(text) > 262144, 'fixture must exceed the loader size warning');
  const { root } = fixture({ 'README.md': '# State\n', 'decisions.md': text });
  const context = load(root);
  assert.ok(context.includes(open), 'the open decision near the start is present, whole');
  assert.ok(context.includes(text), 'decisions.md is injected byte for byte, not cut');
  assert.match(context, /is injected WHOLE at every start/);
});

test('(2) an archived entry is not injected but still exists on disk', () => {
  const entries = [
    '- 2026-01-01 09:00 - chat - "RESOLVED-ONE: ship the banner"\n  Done: #1 merged.\n',
    '- 2026-01-01 09:05 - chat - "STILL-OPEN: keep 0.21.0 scope"\n',
    '- 2026-01-01 09:10 - chat - "RESOLVED-TWO: stop the orphans"\n',
  ];
  const original = `# Decisions\n\n${entries.join('')}\n## 2026-01-02 – section\n- "STILL-OPEN-TOO"\n`;
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': original });

  const dry = archive(campaign, '--move', '1,3');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original, 'a dry run writes nothing');
  assert.ok(!existsSync(path.join(campaign, 'archive-decisions.md')));

  const moved = archive(campaign, '--move', '1,3', '--apply');
  assert.equal(moved.status, 0, moved.stderr);
  const kept = readFileSync(path.join(campaign, 'decisions.md'), 'utf8');
  const archived = readFileSync(path.join(campaign, 'archive-decisions.md'), 'utf8');
  assert.equal(kept, `# Decisions\n\n${entries[1]}\n## 2026-01-02 – section\n- "STILL-OPEN-TOO"\n`);
  assert.ok(archived.includes(entries[0]) && archived.includes(entries[2]), 'moved verbatim, continuation lines included');
  for (const line of original.split('\n')) assert.ok(kept.includes(line) || archived.includes(line), `line lost: ${line}`);

  const context = load(root);
  assert.ok(!context.includes('RESOLVED-ONE') && !context.includes('RESOLVED-TWO'), 'archived entries are not injected');
  assert.ok(context.includes(entries[1]) && context.includes('STILL-OPEN-TOO'), 'open entries still are');
  assert.match(context, /Not loaded, read on demand from .*archive-decisions\.md/);
});

test('the archive script refuses a symlinked archive and a bad name, and writes nothing', () => {
  const original = '# Decisions\n\n- "A"\n- "B"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  const outside = path.join(scratch, 'outside.md');
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, path.join(campaign, 'archive-decisions.md'));
  assert.equal(archive(campaign, '--move', '1', '--apply').status, 2);
  assert.equal(archive(campaign, '--move', '1', '--to', '../x.md', '--apply').status, 2);
  assert.equal(archive(campaign, '--move', '3', '--apply').status, 2);
  assert.equal(readFileSync(outside, 'utf8'), 'outside\n');
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original);
});

test('(3) a timeline over the bound is cut to the newest entries with a pointer line', () => {
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': '# Decisions\n', 'timeline-2026-01-01.md': timeline(100) });
  const context = load(root);
  const full = path.join(campaign, 'timeline-2026-01-01.md');
  assert.ok(context.includes(`[timeline bounded: showing the newest 40 of 100 entries (at most their last 65536 bytes); the full timeline is on disk at ${full} (`));
  assert.ok(context.includes('# Timeline 2026-01-01'), 'heading kept');
  for (let i = 60; i < 100; i += 1) assert.ok(context.includes(`EVENT-${i}\n  detail of event ${i}\n`), `newest entry ${i} present with its detail`);
  assert.ok(!context.includes('EVENT-59\n') && !context.includes('EVENT-0\n'), 'older entries are left on disk');
  assert.equal(readFileSync(full, 'utf8'), timeline(100), 'the file on disk is untouched');
});

test('a timeline within the bound is injected whole, with no pointer', () => {
  const { root } = fixture({ 'README.md': '# State\n', 'timeline-2026-01-01.md': timeline(40) });
  const context = load(root);
  assert.ok(context.includes(timeline(40)));
  assert.ok(!context.includes('timeline bounded'));
});

// In-process runs with an injected writer or a hook just before the files are replaced.
function applyWith(campaign, io) {
  const writeChunk = io.writeChunk ?? ((fd, buffer, offset, length) => writeSyncReal(fd, buffer, offset, length));
  return () => run([campaign, '--move', '1', '--apply'], { cwd: path.resolve(campaign, '../../..'), io: { beforeCommit: () => {}, ...io, writeChunk } });
}

function unchanged(campaign, original) {
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original);
  assert.ok(!existsSync(path.join(campaign, 'archive-decisions.md')), 'no archive written');
  assert.deepEqual(readdirSync(campaign).filter((name) => name !== 'decisions.md'), [], 'no temp or lock file left');
}

test('a decision appended between the read and the replace is kept: the run refuses', () => {
  const original = '# Decisions\n\n- "RESOLVED"\n- "OPEN"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  const late = '- "APPENDED-DURING-RUN"\n';
  const decisions = path.join(campaign, 'decisions.md');
  assert.throws(applyWith(campaign, { beforeCommit: () => appendFileSync(decisions, late) }), (e) => e instanceof Refusal && /changed while this ran/.test(e.message));
  unchanged(campaign, original + late);
});

test('two overlapping archive runs cannot both proceed', () => {
  const original = '# Decisions\n\n- "ONE"\n- "TWO"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  let second;
  applyWith(campaign, { beforeCommit: () => (second = archive(campaign, '--move', '2', '--apply')) })();
  assert.equal(second.status, 2);
  assert.match(second.stderr, /another archive run holds .*\.decisions-archive\.lock/);
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), '# Decisions\n\n- "TWO"\n', 'only the first run moved');
  assert.ok(!existsSync(path.join(campaign, '.decisions-archive.lock')), 'the lock is released');
});

test('short writes are continued until every byte is written', () => {
  const original = `# Decisions\n\n- "MOVE ME ${'y'.repeat(200)}"\n- "KEEP ME"\n`;
  const { campaign } = fixture({ 'decisions.md': original });
  applyWith(campaign, { writeChunk: (fd, buffer, offset, length) => writeSyncReal(fd, buffer, offset, Math.min(length, 7)) })();
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), '# Decisions\n\n- "KEEP ME"\n');
  assert.ok(readFileSync(path.join(campaign, 'archive-decisions.md'), 'utf8').endsWith(`- "MOVE ME ${'y'.repeat(200)}"\n`));
});

for (const [which, target] of [['archive', 1], ['decisions', 2]]) {
  test(`a truncated ${which} write is caught before anything is replaced`, () => {
    const original = '# Decisions\n\n- "MOVE ME"\n- "KEEP ME"\n';
    const { campaign } = fixture({ 'decisions.md': original });
    let staged = 0;
    // Reports every byte written but writes only half of the file it was told to corrupt.
    const writeChunk = (fd, buffer, offset, length) => {
      if (offset === 0) staged += 1;
      if (staged === target) writeSyncReal(fd, buffer, offset, Math.floor(length / 2));
      else writeSyncReal(fd, buffer, offset, length);
      return length;
    };
    assert.throws(applyWith(campaign, { writeChunk }), (e) => e instanceof Refusal && /did not read back as written/.test(e.message));
    unchanged(campaign, original);
  });
}

test('a stale temp file is refused with a clear message', () => {
  const original = '# Decisions\n\n- "A"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  const stale = path.join(campaign, `archive-decisions.md.tmp-${process.pid}`);
  writeFileSync(stale, 'stale\n');
  assert.throws(applyWith(campaign, {}), (e) => e instanceof Refusal && /left by an interrupted run/.test(e.message));
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original);
  assert.equal(readFileSync(stale, 'utf8'), 'stale\n');
});

test('a symlinked ancestor or campaign cannot send the script outside the repository', () => {
  const original = '# Decisions\n\n- "OUTSIDE"\n';
  const { root } = fixture({ 'decisions.md': '# Decisions\n\n- "INSIDE"\n' });
  const outside = path.join(scratch, `outside-${counter}`);
  mkdirSync(path.join(outside, '20260101-fixture'), { recursive: true });
  writeFileSync(path.join(outside, '20260101-fixture/decisions.md'), original);

  // A campaign folder that is a link to an outside folder, passed with a trailing separator.
  symlinkSync(path.join(outside, '20260101-fixture'), path.join(root, '.xezar/campaigns/20260102-link'));
  for (const args of [['--list'], ['--move', '1', '--apply']]) {
    const result = spawnSync('node', [path.join(checks, 'decisions-archive.mjs'), '.xezar/campaigns/20260102-link/', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /not a campaign folder directly inside/);
    assert.ok(!result.stdout.includes('OUTSIDE'), 'outside text is not printed');
  }

  // The campaigns folder itself replaced by a link to the outside folder.
  renameSync(path.join(root, '.xezar/campaigns'), path.join(root, '.xezar/campaigns-real'));
  symlinkSync(outside, path.join(root, '.xezar/campaigns'));
  const result = spawnSync('node', [path.join(checks, 'decisions-archive.mjs'), '.xezar/campaigns/20260101-fixture', '--move', '1', '--apply'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /campaigns is not a directory \(symlinks are refused\)/);
  assert.equal(readFileSync(path.join(outside, '20260101-fixture/decisions.md'), 'utf8'), original, 'outside file unchanged');
  assert.ok(!existsSync(path.join(outside, '20260101-fixture/archive-decisions.md')));
});
