// Fixture tests for what the leader-context loader injects from a campaign folder (#174): the whole
// of decisions.md, always, and only the newest entries of the timeline. The guard cases (worktree,
// task env, not-the-leader) live in documented-output.mjs and are not repeated here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('(2) every entry of a long decisions.md is injected whole, and an archive-decisions.md is ignored', () => {
  const { open, text } = longDecisions();
  // An archive file that names entries of decisions.md: archiving is not supported, so it must
  // neither be injected nor filter anything out.
  const archiveText = `# Archive\n\n${open}- 2026-01-03 LAST-DECISION\nARCHIVE-ONLY-MARKER\n`;
  const { root } = fixture({ 'README.md': '# State\n', 'decisions.md': text, 'archive-decisions.md': archiveText });
  const context = load(root);
  assert.ok(context.includes(text), 'decisions.md is injected byte for byte, every entry included');
  for (const line of text.split('\n').filter((l) => l.startsWith('- '))) assert.ok(context.includes(line), `entry missing: ${line.slice(0, 60)}`);
  assert.ok(!context.includes('ARCHIVE-ONLY-MARKER'), 'the archive file is not injected');
  assert.ok(!/archive-decisions\.md/.test(context), 'the archive file is not even named');
});

test('a missing decisions.md gives a loud warning instead of being skipped', () => {
  const { root, campaign } = fixture({ 'README.md': '# State\n', 'decisions.md': '# Decisions\n' });
  unlinkSync(path.join(campaign, 'decisions.md'));
  assert.match(load(root), /\[WARNING: .*decisions\.md is missing, a symlink or unreadable - the owner decisions were NOT loaded/);
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
