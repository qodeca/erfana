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
// It never deletes: the archive is written (appended) BEFORE decisions.md is replaced, so a failure
// in between leaves an entry in both files, never in neither, and the result is re-read and checked
// line for line against the original before the command reports success. Which entries are resolved
// is the leader's judgement; this script only moves what it is told to.
//
// Trust boundary: campaign files are committed, so their content is untrusted data. The script
// refuses symlinks, bounds the input size, uses no backtracking-prone pattern, and accepts only a
// fixed archive-name shape, so neither a file nor its name can point it outside the folder.
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;
const ARCHIVE_NAME = /^archive-[A-Za-z0-9._-]+\.md$/;

function fail(message) {
  console.error(`decisions-archive: ${message}`);
  process.exit(2);
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

function atomicWrite(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  const fd = openSync(temp, 'wx');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
}

function main(argv) {
  const [dir, ...rest] = argv;
  if (!dir || dir.startsWith('--')) fail('usage: decisions-archive.mjs <campaign-dir> --list | --move <n[,n-m]> [--to archive-<name>.md] [--apply]');
  let dirStat;
  try {
    dirStat = lstatSync(dir);
  } catch {
    fail(`${dir} does not exist`);
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) fail(`${dir} is not a directory (symlinks are refused)`);

  const decisionsPath = path.join(dir, 'decisions.md');
  const original = readRegular(decisionsPath);
  const { lines, entries } = parseEntries(original);

  if (rest[0] === '--list' && rest.length === 1) {
    entries.forEach((entry, i) => {
      const first = lines[entry.start].replace(/\n$/, '');
      console.log(`${String(i + 1).padStart(3)}  ${first.length > 120 ? `${first.slice(0, 117)}...` : first}`);
    });
    return;
  }

  let spec = null;
  let archiveName = 'archive-decisions.md';
  let apply = false;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--move' && rest[i + 1] !== undefined) spec = rest[(i += 1)];
    else if (rest[i] === '--to' && rest[i + 1] !== undefined) archiveName = rest[(i += 1)];
    else if (rest[i] === '--apply') apply = true;
    else fail(`unknown argument: ${JSON.stringify(rest[i])}`);
  }
  if (spec === null) fail('nothing to do: pass --list, or --move <numbers>');
  if (!ARCHIVE_NAME.test(archiveName)) fail(`--to must be a file name shaped archive-<name>.md, got ${JSON.stringify(archiveName)}`);
  if (entries.length === 0) fail(`${decisionsPath} has no entries`);

  const numbers = parseSelection(spec, entries.length);
  const archivePath = path.join(dir, archiveName);
  const existing = present(archivePath) ? readRegular(archivePath) : '';
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const { kept, moved, appended } = planMove(original, numbers, stamp);

  console.log(`${apply ? 'Moving' : 'Would move'} ${numbers.length} entr${numbers.length === 1 ? 'y' : 'ies'} (${moved.length} lines) from ${decisionsPath} to ${archivePath}:`);
  for (const n of numbers) console.log(`  ${n}  ${lines[entries[n - 1].start].replace(/\n$/, '').slice(0, 117)}`);
  if (!apply) {
    console.log('Dry run: nothing written. Add --apply to move them.');
    return;
  }

  const header = existing === '' ? '# Archive – resolved decisions\n\nEntries moved verbatim from decisions.md once resolved. Never loaded at session start; read on demand.\n' : '';
  atomicWrite(archivePath, `${existing}${header}${appended}`);
  atomicWrite(decisionsPath, kept);

  // Nothing may be lost: every original line must now sit in decisions.md or in the archive.
  const after = readFileSync(decisionsPath, 'utf8');
  const archived = readFileSync(archivePath, 'utf8');
  if (after !== kept || !archived.endsWith(appended) || !moved.every((line) => archived.includes(line.replace(/\n$/, '')))) {
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
  main(process.argv.slice(2));
}
