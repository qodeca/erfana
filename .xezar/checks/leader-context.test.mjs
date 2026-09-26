// Fixture tests for what the leader-context loader injects from a campaign folder (#174): the whole
// of decisions.md less any entry archived byte for byte, never an archive, and only the newest
// entries of the timeline. The guard cases
// (worktree, task env, not-the-leader) live in documented-output.mjs and are not repeated here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync as closeSyncReal, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync, writeSync as writeSyncReal } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatRecord, parseEntries, Refusal, run, visibleDecisions } from './decisions-archive.mjs';

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
  for (const name of ['leader-context.sh', 'decisions-archive.mjs']) cpSync(path.join(checks, name), path.join(root, '.xezar/checks', name));
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

test('(2) an archived entry is not injected but still exists on disk, in both files', () => {
  const entries = [
    '- 2026-01-01 09:00 - chat - "RESOLVED-ONE: ship the banner"\n  Done: #1 merged.\n',
    '- 2026-01-01 09:05 - chat - "STILL-OPEN: keep 0.21.0 scope"\n',
    '- 2026-01-01 09:10 - chat - "RESOLVED-TWO: stop the orphans"\n',
  ];
  const original = `# Decisions\n\n${entries.join('')}\n## 2026-01-02 – section\n- "STILL-OPEN-TOO"\n`;
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': original });
  const archivePath = path.join(campaign, 'archive-decisions.md');

  const dry = archive(campaign, '--move', '1,3');
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(!existsSync(archivePath), 'a dry run writes nothing');

  const moved = archive(campaign, '--move', '1,3', '--apply');
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original, 'decisions.md is never changed');
  const archived = readFileSync(archivePath, 'utf8');
  assert.ok(archived.includes(entries[0]) && archived.includes(entries[2]), 'copied verbatim, continuation lines included');
  assert.match(archive(campaign, '--list').stdout, /1 {2}\[archived\] - 2026-01-01 09:00/);

  const context = load(root);
  assert.ok(!context.includes('RESOLVED-ONE') && !context.includes('RESOLVED-TWO'), 'archived entries are not injected');
  assert.ok(context.includes(`# Decisions\n\n${entries[1]}\n## 2026-01-02 – section\n- "STILL-OPEN-TOO"\n`), 'everything else is injected, in order');
  assert.match(context, /2 entries of .*decisions\.md are left out above: each is named, by the sha256 of its exact bytes and its occurrence, in a complete record in .*archive-decisions\.md/);
  assert.match(context, /Not loaded, read on demand from .*archive-decisions\.md/);
});

test('an entry edited after archiving no longer matches and is injected again', () => {
  const entry = '- 2026-01-01 09:00 - chat - "RESOLVED: ship it"\n';
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': `# Decisions\n\n${entry}- "OPEN"\n` });
  assert.equal(archive(campaign, '--move', '1', '--apply').status, 0);
  assert.ok(!load(root).includes('RESOLVED: ship it'));
  // One byte changed in decisions.md: not the archived text any more, so it binds again.
  writeFileSync(path.join(campaign, 'decisions.md'), `# Decisions\n\n${entry.replace('ship it', 'ship it!')}- "OPEN"\n`);
  assert.ok(load(root).includes('"RESOLVED: ship it!"\n'));
  // And an archive copy that was edited no longer hides the original.
  writeFileSync(path.join(campaign, 'decisions.md'), `# Decisions\n\n${entry}- "OPEN"\n`);
  const archivePath = path.join(campaign, 'archive-decisions.md');
  writeFileSync(archivePath, readFileSync(archivePath, 'utf8').replace('ship it', 'ship  it'));
  const context = load(root);
  assert.ok(context.includes(entry));
  assert.match(context, /has a bad record \(line \d+: record body does not match its sha256\), so nothing was left out above/);
});

test('a missing decisions.md gives a loud warning instead of being skipped', () => {
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': '# Decisions\n' });
  unlinkSync(path.join(campaign, 'decisions.md'));
  assert.match(load(root), /\[WARNING: .*decisions\.md is missing, a symlink or unreadable - the owner decisions were NOT loaded/);
});

test('the archive script refuses a symlinked archive and extra arguments, and writes nothing', () => {
  const original = '# Decisions\n\n- "A"\n- "B"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  const range = archive(campaign, '--move', '3', '--apply');
  assert.equal(range.status, 2);
  assert.match(range.stderr, /--move 3 is outside 1-2/);
  const outside = path.join(scratch, 'outside.md');
  writeFileSync(outside, 'outside\n');
  symlinkSync(outside, path.join(campaign, 'archive-decisions.md'));
  const linked = archive(campaign, '--move', '1', '--apply');
  assert.equal(linked.status, 2);
  assert.match(linked.stderr, /archive-decisions\.md is not a regular file \(symlinks are refused\)/);
  const extra = archive(campaign, '--move', '1', '--bogus');
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /unknown argument: "--bogus"/);
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

// In-process runs with an injected writer, close or hook.
function applyWith(campaign, io, spec = '1') {
  return () =>
    run([campaign, '--move', spec, '--apply'], {
      cwd: path.resolve(campaign, '../../..'),
      io: { hook: () => {}, closeSync: closeSyncReal, writeChunk: (fd, buffer, offset, length) => writeSyncReal(fd, buffer, offset, length), ...io },
    });
}

const refused = (pattern) => (e) => e instanceof Refusal && pattern.test(e.message);

test('an append to decisions.md during a run is never lost, because nothing rewrites it', () => {
  const original = '# Decisions\n\n- "RESOLVED"\n- "OPEN"\n';
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': original });
  const late = '- "APPENDED-DURING-RUN"\n';
  const decisions = path.join(campaign, 'decisions.md');
  applyWith(campaign, { hook: () => appendFileSync(decisions, late) })();
  assert.equal(readFileSync(decisions, 'utf8'), original + late);
  const context = load(root);
  assert.ok(context.includes('- "OPEN"\n- "APPENDED-DURING-RUN"\n'), 'the late decision is injected');
  assert.ok(!context.includes('"RESOLVED"'));
});

test('a second run does not append the same entry twice', () => {
  const { campaign } = fixture({ 'decisions.md': '# Decisions\n\n- "RESOLVED"\n- "OPEN"\n' });
  assert.equal(archive(campaign, '--move', '1', '--apply').status, 0);
  const again = archive(campaign, '--move', '1', '--apply');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already archived, skipped[\s\S]*Nothing to archive/);
  assert.equal(readFileSync(path.join(campaign, 'archive-decisions.md'), 'utf8').split('- "RESOLVED"\n').length, 2, 'the entry is in the archive once');
});

test('two overlapping archive runs cannot both proceed', () => {
  const original = '# Decisions\n\n- "ONE"\n- "TWO"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  let second;
  applyWith(campaign, { hook: () => (second = archive(campaign, '--move', '1', '--apply')) })();
  assert.equal(second.status, 2);
  assert.match(second.stderr, /another archive run holds .*\.decisions-archive\.lock/);
  assert.equal(readFileSync(path.join(campaign, 'archive-decisions.md'), 'utf8').split('- "ONE"\n').length, 2, 'archived once');
  assert.deepEqual(readdirSync(campaign).sort(), ['archive-decisions.md', 'decisions.md'], 'the lock is released');
});

test('short writes are continued until every byte is appended', () => {
  const entry = `- "MOVE ME ${'y'.repeat(200)}"\n`;
  const { campaign } = fixture({ 'decisions.md': `# Decisions\n\n${entry}- "KEEP ME"\n` });
  applyWith(campaign, { writeChunk: (fd, buffer, offset, length) => writeSyncReal(fd, buffer, offset, Math.min(length, 7)) })();
  assert.ok(readFileSync(path.join(campaign, 'archive-decisions.md'), 'utf8').endsWith(`${entry}<!-- decision-archive end sha256=${parseEntries(entry).entries[0].sha} occurrence=1 -->\n`));
});

test('a truncated append is caught, and decisions.md still shows the entry', () => {
  const original = '# Decisions\n\n- "MOVE ME PLEASE"\n- "KEEP ME"\n';
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': original });
  // Reports every byte written but writes only half.
  const writeChunk = (fd, buffer, offset, length) => {
    writeSyncReal(fd, buffer, offset, Math.floor(length / 2));
    return length;
  };
  assert.throws(applyWith(campaign, { writeChunk }), refused(/does not read back with the appended block/));
  assert.equal(readFileSync(path.join(campaign, 'decisions.md'), 'utf8'), original);
  assert.ok(load(root).includes(original), 'a partial archive block hides nothing');
});

test('a lock whose close fails is still removed', () => {
  const original = '# Decisions\n\n- "A"\n';
  const { campaign } = fixture({ 'decisions.md': original });
  const failingClose = (fd) => {
    closeSyncReal(fd);
    throw new Error('injected close failure');
  };
  assert.throws(applyWith(campaign, { closeSync: failingClose }), /injected close failure/);
  assert.deepEqual(readdirSync(campaign), ['decisions.md']);
});

test('a symlinked ancestor or campaign cannot send the script outside the repository', () => {
  const original = '# Decisions\n\n- "OUTSIDE"\n';
  const { root } = fixture({ 'decisions.md': '# Decisions\n\n- "INSIDE"\n' });
  const outside = path.join(scratch, `outside-${counter}`);
  mkdirSync(path.join(outside, '20260101-fixture'), { recursive: true });
  writeFileSync(path.join(outside, '20260101-fixture/decisions.md'), original);
  const cli = (dir, ...args) => spawnSync('node', [path.join(checks, 'decisions-archive.mjs'), dir, ...args], { cwd: root, encoding: 'utf8' });

  // A campaign folder that is a link to an outside folder, passed with a trailing separator.
  symlinkSync(path.join(outside, '20260101-fixture'), path.join(root, '.xezar/campaigns/20260102-link'));
  for (const args of [['--list'], ['--move', '1', '--apply']]) {
    const result = cli('.xezar/campaigns/20260102-link/', ...args);
    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /not a campaign folder directly inside/);
    assert.ok(!result.stdout.includes('OUTSIDE'), 'outside text is not printed');
  }

  // The campaigns folder itself replaced by a link to the outside folder.
  renameSync(path.join(root, '.xezar/campaigns'), path.join(root, '.xezar/campaigns-real'));
  symlinkSync(outside, path.join(root, '.xezar/campaigns'));
  const result = cli('.xezar/campaigns/20260101-fixture', '--move', '1', '--apply');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /campaigns is not a directory \(symlinks are refused\)/);
  assert.deepEqual(readdirSync(path.join(outside, '20260101-fixture')), ['decisions.md'], 'nothing written outside');
});

// The identities of an archive built by the script itself, for the in-process cut sweep.
function archiveOf(campaign, spec) {
  assert.equal(archive(campaign, '--move', spec, '--apply').status, 0);
  return readFileSync(path.join(campaign, 'archive-decisions.md'), 'latin1');
}

test('an archive cut at any byte hides nothing it should not', () => {
  // The archived entry is a longer line that starts with a shorter OPEN entry, and the OPEN entry
  // is the last line of decisions.md with no final newline.
  const resolved = '- "Keep the banner on the release page"\n';
  const open = '- "Keep the banner"';
  const decisions = `# Decisions\n\n${resolved}- "OTHER OPEN"\n${open}`;
  const { campaign } = fixture({ 'decisions.md': decisions });
  const full = archiveOf(campaign, '1');
  const complete = visibleDecisions(decisions, full);
  assert.equal(complete.hidden, 1);
  assert.equal(complete.text, `# Decisions\n\n- "OTHER OPEN"\n${open}`, 'only the archived entry is left out, bytes unchanged');
  for (let cut = 0; cut < full.length; cut += 1) {
    const result = visibleDecisions(decisions, full.slice(0, cut));
    assert.equal(result.hidden, 0, `cut at ${cut} hid something`);
    assert.equal(result.text, decisions, `cut at ${cut} changed the injected text`);
  }
  // A cut record that happens to hold the open entry's exact bytes still hides nothing.
  const record = formatRecord(parseEntries(`${open}`).entries[0]);
  assert.equal(visibleDecisions(decisions, record).hidden, 1, 'a complete record for the open entry would hide it');
  assert.equal(visibleDecisions(decisions, record.slice(0, -1)).hidden, 0, 'without its final newline it hides nothing');
});

test('two identical entries in two sections: archiving the first hides only the first', () => {
  const decisions = '# Decisions\n\n## Resolved\n- "Keep the banner"\n\n## Open\n- "Keep the banner"\n';
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': decisions });
  archiveOf(campaign, '1');
  assert.match(archive(campaign, '--list').stdout, /^ {2}1 {2}\[archived\] - "Keep the banner"\n {2}2 {2}- "Keep the banner"\n$/);
  const again = archive(campaign, '--move', '2');
  assert.match(again.stdout, /Would archive 1 entry/, 'the second copy is not reported as already archived');
  assert.ok(load(root).includes('## Resolved\n\n## Open\n- "Keep the banner"\n'), 'the OPEN occurrence stays visible');
});

test('a later repeat of an archived entry stays visible until it is archived itself', () => {
  const decisions = '# Decisions\n\n- "A"\n- "B"\n- "A"\n';
  const { campaign } = fixture({ 'decisions.md': decisions });
  let archived = archiveOf(campaign, '1');
  assert.equal(visibleDecisions(decisions, archived).text, '# Decisions\n\n- "B"\n- "A"\n');
  archived = archiveOf(campaign, '3');
  assert.equal(visibleDecisions(decisions, archived).text, '# Decisions\n\n- "B"\n');
});

test('a well-formed record naming an occurrence that does not exist hides nothing', () => {
  const decisions = '# Decisions\n\n- "OPEN"\n';
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': decisions });
  const ghost = formatRecord(parseEntries('- "GHOST"\n').entries[0]);
  // Right bytes and hash, wrong occurrence: there is only one "OPEN".
  const second = formatRecord({ ...parseEntries(decisions).entries[0], occurrence: 2 });
  writeFileSync(path.join(campaign, 'archive-decisions.md'), `# Archive\n\n${ghost}${second}`);
  assert.deepEqual(visibleDecisions(decisions, readFileSync(path.join(campaign, 'archive-decisions.md'), 'latin1')), { text: decisions, hidden: 0, error: null });
  const context = load(root);
  assert.ok(context.includes(decisions));
  assert.ok(!context.includes('left out above') && !context.includes('bad record'));
});
