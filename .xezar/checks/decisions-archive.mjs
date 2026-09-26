#!/usr/bin/env node
// Move resolved entries out of a campaign's decisions.md into an archive-*.md file in the same
// folder, verbatim. The leader-context loader injects decisions.md whole at every session start
// and never injects an archive, so this is the one way to shrink what the leader loads without
// cutting a live decision.
//
//   node .xezar/checks/decisions-archive.mjs <campaign-dir> --list
//   node .xezar/checks/decisions-archive.mjs <campaign-dir> --move 3,5-7 [--to archive-decisions.md] [--apply]
//
// `--list` numbers the entries. `--move` without `--apply` only prints what would move. An entry is
// a line starting `- ` plus the indented lines under it; headings, prose and blank lines never move.
//
// It never deletes. `--apply` takes an exclusive lock file in the campaign folder, stages both new
// files as temp files and reads each one back before anything is replaced, re-reads decisions.md and
// the archive and refuses if either changed since the run read them, then renames the archive into
// place first and decisions.md second: a failure in between leaves an entry in both files, never in
// neither. The result is re-checked line for line before the command reports success. Which entries
// are resolved is the leader's judgement; this script only moves what it is told to.
//
// Trust boundary: campaign files are committed, so their content is untrusted data. Run it from
// inside the repository: the campaign folder must resolve (realpath) to a direct child of that
// repository's real `.xezar/campaigns`, whose `.xezar` and `campaigns` are not symlinks, so no link
// in the path can point it elsewhere. It refuses symlinked files, bounds the input size, uses no
// backtracking-prone pattern, and accepts only a fixed archive-name shape.
import { spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;
const ARCHIVE_NAME = /^archive-[A-Za-z0-9._-]+\.md$/;

export class Refusal extends Error {}

function fail(message) {
  throw new Refusal(message);
}

function readRegular(file) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    fail(`${file} does not exist`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${file} is not a regular file (symlinks are refused)`);
  if (stat.size > MAX_BYTES) fail(`${file} is ${stat.size} bytes, over the ${MAX_BYTES}-byte limit`);
  return readFileSync(file, 'utf8');
}

// Lines keep their own terminators, so joining them back gives the exact original bytes.
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function parseEntries(text) {
  const lines = splitLines(text);
  const entries = [];
  let section = null;
  let current = null;
  lines.forEach((line, index) => {
    if (line.startsWith('- ')) {
      current = { start: index, end: index + 1, section };
      entries.push(current);
    } else if (current && /^[ \t]/.test(line) && line.trim() !== '') {
      current.end = index + 1;
    } else {
      current = null;
      if (line.startsWith('#')) section = line.replace(/\n$/, '');
    }
  });
  return { lines, entries };
}

export function parseSelection(spec, count) {
  const chosen = new Set();
  for (const part of spec.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) fail(`bad --move value: ${JSON.stringify(part)} (use numbers from --list, e.g. 3,5-7)`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from || to > count) fail(`--move ${part} is outside 1-${count}`);
    for (let n = from; n <= to; n += 1) chosen.add(n);
  }
  return [...chosen].sort((a, b) => a - b);
}

export function planMove(text, numbers, stamp) {
  const { lines, entries } = parseEntries(text);
  const moving = new Set();
  const blocks = [];
  let lastSection;
  for (const n of numbers) {
    const entry = entries[n - 1];
    for (let i = entry.start; i < entry.end; i += 1) moving.add(i);
    if (entry.section && entry.section !== lastSection) blocks.push(`\n### From: ${entry.section.replace(/^#+\s*/, '')}\n\n`);
    lastSection = entry.section;
    let body = lines.slice(entry.start, entry.end).join('');
    if (!body.endsWith('\n')) body += '\n';
    blocks.push(body);
  }
  const kept = lines.filter((_, i) => !moving.has(i)).join('');
  const moved = lines.filter((_, i) => moving.has(i));
  const appended = `\n## Moved from decisions.md on ${stamp}\n\n${blocks.join('')}`;
  return { kept, moved, appended };
}

// Writes every byte (a short write is continued, not ignored), fsyncs, and reads the temp file back.
// Returns the temp path; the caller renames it into place only after every check has passed.
function stage(file, content, io) {
  const temp = `${file}.tmp-${process.pid}`;
  let fd;
  try {
    fd = openSync(temp, 'wx');
  } catch (error) {
    fail(error.code === 'EEXIST' ? `${temp} already exists, left by an interrupted run: check it, then remove it and retry` : `cannot create ${temp}: ${error.code ?? error.message}`);
  }
  try {
    const bytes = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const written = io.writeChunk(fd, bytes, offset, bytes.length - offset);
      if (!(written > 0)) fail(`writing ${temp} made no progress`);
      offset += written;
    }
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(temp);
    throw error;
  }
  closeSync(fd);
  if (readFileSync(temp, 'utf8') !== content) {
    unlinkSync(temp);
    fail(`${temp} did not read back as written; nothing was replaced`);
  }
  return temp;
}

// The real directory of the campaign, confined to the repository's own .xezar/campaigns.
function campaignDir(dir, cwd) {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (top.status !== 0) fail('run it from inside the repository (git rev-parse --show-toplevel failed)');
  const root = realpathSync(top.stdout.trim());
  for (const part of ['.xezar', '.xezar/campaigns']) {
    let stat;
    try {
      stat = lstatSync(path.join(root, part));
    } catch {
      fail(`${path.join(root, part)} does not exist`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${path.join(root, part)} is not a directory (symlinks are refused)`);
  }
  const campaigns = path.join(root, '.xezar/campaigns');
  let real;
  try {
    real = realpathSync(path.resolve(cwd, dir));
  } catch {
    fail(`${dir} does not exist`);
  }
  if (path.dirname(real) !== campaigns || !lstatSync(real).isDirectory()) fail(`${dir} resolves to ${real}, which is not a campaign folder directly inside ${campaigns}`);
  return real;
}

const defaultIo = { writeChunk: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length), beforeCommit: () => {} };

export function run(argv, { cwd = process.cwd(), io = defaultIo } = {}) {
  const [arg, ...rest] = argv;
  if (!arg || arg.startsWith('--')) fail('usage: decisions-archive.mjs <campaign-dir> --list | --move <n[,n-m]> [--to archive-<name>.md] [--apply]');
  let spec = null;
  let archiveName = 'archive-decisions.md';
  let apply = false;
  const list = rest[0] === '--list' && rest.length === 1;
  for (let i = 0; !list && i < rest.length; i += 1) {
    if (rest[i] === '--move' && rest[i + 1] !== undefined) spec = rest[(i += 1)];
    else if (rest[i] === '--to' && rest[i + 1] !== undefined) archiveName = rest[(i += 1)];
    else if (rest[i] === '--apply') apply = true;
    else fail(`unknown argument: ${JSON.stringify(rest[i])}`);
  }
  if (!list && spec === null) fail('nothing to do: pass --list, or --move <numbers>');
  if (!ARCHIVE_NAME.test(archiveName)) fail(`--to must be a file name shaped archive-<name>.md, got ${JSON.stringify(archiveName)}`);

  const dir = campaignDir(arg, cwd);
  const decisionsPath = path.join(dir, 'decisions.md');
  const archivePath = path.join(dir, archiveName);
  if (!apply) return report(dir, decisionsPath, archivePath, list, spec, null);

  // One writer at a time. A lock left by a crashed run is removed by hand, after a look.
  const lockPath = path.join(dir, '.decisions-archive.lock');
  try {
    closeSync(openSync(lockPath, 'wx'));
  } catch (error) {
    fail(error.code === 'EEXIST' ? `another archive run holds ${lockPath}; if none is running, remove it and retry` : `cannot create ${lockPath}: ${error.code ?? error.message}`);
  }
  try {
    report(dir, decisionsPath, archivePath, list, spec, io);
  } finally {
    unlinkSync(lockPath);
  }
}

function report(dir, decisionsPath, archivePath, list, spec, io) {
  const original = readRegular(decisionsPath);
  const { lines, entries } = parseEntries(original);
  if (list) {
    entries.forEach((entry, i) => {
      const first = lines[entry.start].replace(/\n$/, '');
      console.log(`${String(i + 1).padStart(3)}  ${first.length > 120 ? `${first.slice(0, 117)}...` : first}`);
    });
    return;
  }
  if (entries.length === 0) fail(`${decisionsPath} has no entries`);

  const numbers = parseSelection(spec, entries.length);
  const existing = present(archivePath) ? readRegular(archivePath) : null;
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const { kept, moved, appended } = planMove(original, numbers, stamp);

  console.log(`${io ? 'Moving' : 'Would move'} ${numbers.length} entr${numbers.length === 1 ? 'y' : 'ies'} (${moved.length} lines) from ${decisionsPath} to ${archivePath}:`);
  for (const n of numbers) console.log(`  ${n}  ${lines[entries[n - 1].start].replace(/\n$/, '').slice(0, 117)}`);
  if (!io) {
    console.log('Dry run: nothing written. Add --apply to move them.');
    return;
  }

  const header = existing === null || existing === '' ? '# Archive – resolved decisions\n\nEntries moved verbatim from decisions.md once resolved. Never loaded at session start; read on demand.\n' : '';
  const archiveContent = `${existing ?? ''}${header}${appended}`;
  const staged = [];
  try {
    staged.push(stage(archivePath, archiveContent, io));
    staged.push(stage(decisionsPath, kept, io));
    io.beforeCommit();
    // Nothing is replaced if either file moved on since it was read (an append by the leader, say).
    if (readRegular(decisionsPath) !== original) fail(`${decisionsPath} changed while this ran; nothing was replaced, run it again`);
    if ((present(archivePath) ? readRegular(archivePath) : null) !== existing) fail(`${archivePath} changed while this ran; nothing was replaced, run it again`);
    renameSync(staged.shift(), archivePath);
    renameSync(staged.shift(), decisionsPath);
  } finally {
    for (const temp of staged) unlinkSync(temp);
  }

  // Nothing may be lost: every original line must now sit in decisions.md or in the archive.
  const after = readFileSync(decisionsPath, 'utf8');
  const archived = readFileSync(archivePath, 'utf8');
  if (after !== kept || archived !== archiveContent || !moved.every((line) => archived.includes(line.replace(/\n$/, '')))) {
    fail(`verification failed after writing; compare ${decisionsPath} and ${archivePath} with git before committing`);
  }
  console.log('Done. Every moved line is in the archive; commit both files together.');
}

// lstat, not exists: a dangling symlink must reach readRegular and be refused, not be overwritten.
function present(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1]?.endsWith('decisions-archive.mjs')) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`decisions-archive: ${error.message}`);
    process.exit(2);
  }
}
