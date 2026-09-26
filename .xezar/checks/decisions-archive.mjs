#!/usr/bin/env node
// Archive resolved entries of a campaign's decisions.md so the leader-context loader stops
// injecting them, without ever changing decisions.md.
//
//   node .xezar/checks/decisions-archive.mjs <campaign-dir> --list
//   node .xezar/checks/decisions-archive.mjs <campaign-dir> --move 3,5-7 [--apply]
//
// `--list` numbers the entries and marks those already archived. `--move` without `--apply` only
// prints what would be archived. An entry is a line starting `- ` plus the indented lines under it;
// headings, prose and blank lines are never archived.
//
// Append-only, by construction. The script never rewrites, renames or deletes any file: it only
// APPENDS the chosen entries, byte for byte, to archive-decisions.md in the same folder (O_APPEND,
// every byte written, fsync, then read back). decisions.md is only read, so an append to it during a
// run cannot be lost. The loader hides a decisions.md entry only when the identical entry block is
// also in archive-decisions.md; an entry edited afterwards no longer matches and is injected again.
// The lock file stops two runs from appending the same entry twice; safety does not depend on it.
// Which entries are resolved is the leader's judgement; this script only archives what it is told.
//
// `--visible <decisions.md> <archive.md>` prints decisions.md with the archived entries left out.
// It is the loader's filter, so the loader and this script share one parser.
//
// Trust boundary: campaign files are committed, so their content is untrusted data. Run it from
// inside the repository: the campaign folder must resolve (realpath) to a direct child of that
// repository's real `.xezar/campaigns`, whose `.xezar` and `campaigns` are not symlinks, so no link
// in the path can point it elsewhere. It refuses symlinked files (O_NOFOLLOW on the append), bounds
// the input size and uses no backtracking-prone pattern.
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;
export const ARCHIVE = 'archive-decisions.md';

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
  for (const entry of entries) {
    entry.block = lines.slice(entry.start, entry.end).join('');
    if (!entry.block.endsWith('\n')) entry.block += '\n';
  }
  return { lines, entries };
}

// decisions.md without the entries whose exact block is also in the archive. Everything else –
// headings, prose, blank lines, any entry not matched byte for byte – is kept, in order.
export function visibleDecisions(text, archiveText) {
  const archived = new Set(parseEntries(archiveText).entries.map((entry) => entry.block));
  const { lines, entries } = parseEntries(text);
  const hidden = new Set();
  let count = 0;
  for (const entry of entries) {
    if (!archived.has(entry.block)) continue;
    count += 1;
    for (let i = entry.start; i < entry.end; i += 1) hidden.add(i);
  }
  return { text: lines.filter((_, i) => !hidden.has(i)).join(''), hidden: count };
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

// The appended block: a dated heading, then each entry verbatim under a heading naming its section.
export function planArchive(entries, numbers, stamp) {
  const blocks = [];
  let lastSection;
  for (const n of numbers) {
    const entry = entries[n - 1];
    if (entry.section && entry.section !== lastSection) blocks.push(`\n### From: ${entry.section.replace(/^#+\s*/, '')}\n\n`);
    lastSection = entry.section;
    blocks.push(entry.block);
  }
  return `\n## Archived from decisions.md on ${stamp}\n\n${blocks.join('')}`;
}

// The repository's real .xezar/campaigns; the campaign must resolve to a direct child of it.
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

// Appends every byte (a short write is continued, not ignored) and fsyncs. Never truncates.
function appendAll(file, content, io) {
  let fd;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o644);
  } catch (error) {
    fail(`cannot open ${file} for appending: ${error.code ?? error.message} (symlinks are refused)`);
  }
  try {
    const bytes = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const written = io.writeChunk(fd, bytes, offset, bytes.length - offset);
      if (!(written > 0)) fail(`appending to ${file} made no progress`);
      offset += written;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const defaultIo = { writeChunk: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length), closeSync, hook: () => {} };

export function run(argv, { cwd = process.cwd(), io = defaultIo } = {}) {
  const [arg, ...rest] = argv;
  if (arg === '--visible' && rest.length === 2) {
    const archive = lstatExists(rest[1]) ? readRegular(rest[1]) : '';
    const { text, hidden } = visibleDecisions(readRegular(rest[0]), archive);
    process.stdout.write(text);
    process.stderr.write(`${hidden}\n`);
    return;
  }
  if (!arg || arg.startsWith('--')) fail('usage: decisions-archive.mjs <campaign-dir> --list | --move <n[,n-m]> [--apply]');
  let spec = null;
  let apply = false;
  const list = rest[0] === '--list' && rest.length === 1;
  for (let i = 0; !list && i < rest.length; i += 1) {
    if (rest[i] === '--move' && rest[i + 1] !== undefined) spec = rest[(i += 1)];
    else if (rest[i] === '--apply') apply = true;
    else fail(`unknown argument: ${JSON.stringify(rest[i])}`);
  }
  if (!list && spec === null) fail('nothing to do: pass --list, or --move <numbers>');

  const dir = campaignDir(arg, cwd);
  const decisionsPath = path.join(dir, 'decisions.md');
  const archivePath = path.join(dir, ARCHIVE);
  if (!apply) return archiveEntries(decisionsPath, archivePath, list, spec, null);

  // Only stops two runs from appending the same entry twice; a stale one is removed by hand.
  const lockPath = path.join(dir, '.decisions-archive.lock');
  let fd;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    fail(error.code === 'EEXIST' ? `another archive run holds ${lockPath}; if none is running, remove it and retry` : `cannot create ${lockPath}: ${error.code ?? error.message}`);
  }
  // Acquired: from here on every exit, a failed close included, removes the lock.
  try {
    io.closeSync(fd);
    archiveEntries(decisionsPath, archivePath, list, spec, io);
  } finally {
    unlinkSync(lockPath);
  }
}

function archiveEntries(decisionsPath, archivePath, list, spec, io) {
  const { entries } = parseEntries(readRegular(decisionsPath));
  const archiveText = lstatExists(archivePath) ? readRegular(archivePath) : '';
  const archived = new Set(parseEntries(archiveText).entries.map((entry) => entry.block));
  const label = (entry) => {
    const first = entry.block.split('\n')[0];
    return first.length > 117 ? `${first.slice(0, 117)}...` : first;
  };
  if (list) {
    entries.forEach((entry, i) => console.log(`${String(i + 1).padStart(3)}  ${archived.has(entry.block) ? '[archived] ' : ''}${label(entry)}`));
    return;
  }
  if (entries.length === 0) fail(`${decisionsPath} has no entries`);

  const chosen = parseSelection(spec, entries.length);
  const numbers = chosen.filter((n) => !archived.has(entries[n - 1].block));
  for (const n of chosen) if (!numbers.includes(n)) console.log(`  ${n}  already archived, skipped: ${label(entries[n - 1])}`);
  if (numbers.length === 0) {
    console.log('Nothing to archive.');
    return;
  }
  console.log(`${io ? 'Archiving' : 'Would archive'} ${numbers.length} entr${numbers.length === 1 ? 'y' : 'ies'} of ${decisionsPath} into ${archivePath} (decisions.md is not changed):`);
  for (const n of numbers) console.log(`  ${n}  ${label(entries[n - 1])}`);
  if (!io) {
    console.log('Dry run: nothing written. Add --apply to archive them.');
    return;
  }

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const header = archiveText === '' ? '# Archive – resolved decisions\n\nCopies of resolved decisions.md entries. The loader leaves out any decisions.md entry whose exact text is here; decisions.md itself is never changed.\n' : '';
  const block = `${header}${planArchive(entries, numbers, stamp)}`;
  io.hook('append');
  appendAll(archivePath, block, io);

  const after = readRegular(archivePath);
  if (!after.includes(block)) fail(`${archivePath} does not read back with the appended block; decisions.md was not changed, so nothing is hidden or lost – check the archive with git`);
  console.log('Done. decisions.md is unchanged; the loader now leaves these entries out. Commit archive-decisions.md.');
}

function lstatExists(file) {
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
