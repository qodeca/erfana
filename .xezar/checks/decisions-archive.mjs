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
// APPENDS records to archive-decisions.md in the same folder (O_APPEND, every byte written, fsync,
// then read back). decisions.md is only read, so an append to it during a run cannot be lost.
//
// A record names exactly ONE entry by the file's history, not by a count: the entry's start and end
// byte offsets in decisions.md, the SHA-256 of the entry's bytes, and the SHA-256 of the whole file
// from byte 0 to the entry's end. A record is self-delimiting and self-checking:
//
//   <!-- decision-archive begin from=<n> to=<n> sha256=<hex> prefix-sha256=<hex> -->
//   <the entry, byte for byte; a newline is added only if the entry had none>
//   <!-- decision-archive end from=<n> to=<n> sha256=<hex> -->
//
// The loader hides an entry only when a complete record's offsets land exactly on that entry's
// boundaries in the current file AND both hashes match the current bytes. decisions.md is
// append-only, so a correct record stays valid as the file grows; any edit, insertion or reorder at
// or before the entry changes the prefix hash, and the record then hides nothing (the loader says
// how many records it ignored). A record past the end of the file hides nothing, and still hides
// nothing once the file grows past it with other bytes. Any incomplete or malformed record – a cut
// append, a hand edit – hides nothing at all: the whole decisions.md is injected with a one-line
// note. Matching is on original bytes (files are read as latin1, one char per byte), with no
// newline or whitespace normalisation. The script writes a record only for an entry present in the
// file it just re-read. The lock file stops two runs from appending the same record twice; safety
// does not depend on it. Which entries are resolved is the leader's judgement.
//
// `--visible <decisions.md> <archive.md>` prints decisions.md with the archived entries left
// out, and one status line on stderr. It is the loader's filter, so both sides share one parser.
//
// Trust boundary: campaign files are committed, so their content is untrusted data. Run it from
// inside the repository: the campaign folder must resolve (realpath) to a direct child of that
// repository's real `.xezar/campaigns`, whose `.xezar` and `campaigns` are not symlinks, so no link
// in the path can point it elsewhere. It refuses symlinked files (O_NOFOLLOW on the append), bounds
// the input size and uses no backtracking-prone pattern.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  // latin1: one char per byte, so slicing, lengths and hashes are on the file's exact bytes.
  return readFileSync(file, 'latin1');
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
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length);
  for (const entry of entries) {
    entry.block = lines.slice(entry.start, entry.end).join('');
    entry.from = offsets[entry.start];
    entry.to = offsets[entry.end];
    entry.sha = sha256(entry.block);
  }
  return { lines, entries };
}

function sha256(latin1) {
  return createHash('sha256').update(Buffer.from(latin1, 'latin1')).digest('hex');
}

const HEX = '([0-9a-f]{64})';
const BEGIN = new RegExp(`^<!-- decision-archive begin from=(0|[1-9][0-9]{0,8}) to=([1-9][0-9]{0,8}) sha256=${HEX} prefix-sha256=${HEX} -->\n$`);

// The record for an entry of `text` (the decisions.md it was parsed from).
export function formatRecord(entry, text) {
  const tail = entry.block.endsWith('\n') ? '' : '\n';
  const name = `from=${entry.from} to=${entry.to} sha256=${entry.sha}`;
  return `<!-- decision-archive begin ${name} prefix-sha256=${sha256(text.slice(0, entry.to))} -->\n${entry.block}${tail}<!-- decision-archive end ${name} -->\n`;
}

// The complete, hash-checked records, or an error naming the first bad line. Text outside records is
// free prose and ignored; a line outside a record that starts like a marker is an error, so a record
// cannot be half-recognised.
export function parseArchive(text) {
  const records = [];
  let pos = 0;
  let line = 1;
  const bad = (why) => ({ records: [], error: `line ${line}: ${why}` });
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? text.length : nl + 1;
    const head = text.slice(pos, lineEnd);
    if (!head.startsWith('<!-- decision-archive')) {
      pos = lineEnd;
      line += 1;
      continue;
    }
    const match = BEGIN.exec(head);
    if (!match) return bad('malformed or incomplete record header');
    const [from, to] = [Number(match[1]), Number(match[2])];
    const [, , , sha, prefix] = match;
    if (to <= from) return bad('record offsets are out of order');
    const body = text.slice(lineEnd, lineEnd + (to - from));
    let at = lineEnd + (to - from);
    if (body.length !== to - from) return bad('record body is incomplete');
    if (!body.endsWith('\n')) {
      if (text[at] !== '\n') return bad('record body is incomplete');
      at += 1;
    }
    const end = `<!-- decision-archive end from=${from} to=${to} sha256=${sha} -->\n`;
    if (text.slice(at, at + end.length) !== end) return bad('record has no matching end line');
    if (sha256(body) !== sha) return bad('record body does not match its sha256');
    records.push({ from, to, sha, prefix });
    at += end.length;
    for (let i = pos; i < at; i += 1) if (text[i] === '\n') line += 1;
    pos = at;
  }
  return { records, error: null };
}

// Which entries of `text` a record validly names, and how many records name nothing.
export function matchRecords(text, entries, records) {
  const byRange = new Map(entries.map((entry, i) => [`${entry.from}:${entry.to}`, i]));
  const archived = new Set();
  let stale = 0;
  for (const record of records) {
    const i = byRange.get(`${record.from}:${record.to}`);
    const valid = i !== undefined && record.to <= text.length && entries[i].sha === record.sha && sha256(text.slice(0, record.to)) === record.prefix;
    if (valid) archived.add(i);
    else stale += 1;
  }
  return { archived, stale };
}

// decisions.md without the entries a valid record names. Everything else – headings, prose, blank
// lines, every entry no valid record names – is kept, in order. A bad archive hides nothing.
export function visibleDecisions(text, archiveText) {
  const { records, error } = parseArchive(archiveText);
  if (error) return { text, hidden: 0, stale: 0, error };
  const { lines, entries } = parseEntries(text);
  const { archived, stale } = matchRecords(text, entries, records);
  const hidden = new Set();
  for (const i of archived) for (let l = entries[i].start; l < entries[i].end; l += 1) hidden.add(l);
  return { text: lines.filter((_, l) => !hidden.has(l)).join(''), hidden: archived.size, stale, error: null };
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
export function planArchive(text, entries, numbers, stamp) {
  const blocks = [];
  let lastSection;
  for (const n of numbers) {
    const entry = entries[n - 1];
    if (entry.section && entry.section !== lastSection) blocks.push(`\n### From: ${entry.section.replace(/^#+\s*/, '')}\n\n`);
    lastSection = entry.section;
    blocks.push(formatRecord(entry, text));
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
    const bytes = Buffer.from(content, 'latin1');
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
    const { text, hidden, stale, error } = visibleDecisions(readRegular(rest[0]), archive);
    process.stdout.write(Buffer.from(text, 'latin1'));
    process.stderr.write(error ? `fallback ${error}\n` : `hidden ${hidden} stale ${stale}\n`);
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
  const decisions = readRegular(decisionsPath);
  const { entries } = parseEntries(decisions);
  const archiveText = lstatExists(archivePath) ? readRegular(archivePath) : '';
  const { records, error } = parseArchive(archiveText);
  const { archived } = matchRecords(decisions, entries, records);
  if (error && !list) fail(`${archivePath} ${error}; fix it (git) before archiving more – until then the loader hides nothing`);
  if (error) console.log(`note: ${archivePath} ${error}; the loader hides nothing until it is fixed`);
  const label = (entry) => {
    const first = Buffer.from(entry.block.split('\n')[0], 'latin1').toString('utf8');
    return first.length > 117 ? `${first.slice(0, 117)}...` : first;
  };
  if (list) {
    entries.forEach((entry, i) => console.log(`${String(i + 1).padStart(3)}  ${archived.has(i) ? '[archived] ' : ''}${label(entry)}`));
    return;
  }
  if (entries.length === 0) fail(`${decisionsPath} has no entries`);

  const chosen = parseSelection(spec, entries.length);
  const numbers = chosen.filter((n) => !archived.has(n - 1));
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
  const header = archiveText === '' ? '# Archive – resolved decisions\n\nRecords of resolved decisions.md entries, each bound to one entry by its byte offsets and the hash of decisions.md up to it. The loader leaves those entries out of its copy of decisions.md; decisions.md itself is never changed. Do not edit a record: a malformed record makes the loader hide nothing.\n' : '';
  // Everything is handled as latin1 (one char per byte); the header is UTF-8 text, so convert it.
  const block = `${Buffer.from(header, 'utf8').toString('latin1')}${planArchive(decisions, entries, numbers, stamp)}`;
  io.hook('append');
  // Only an entry present in the file as it is now: decisions.md may have grown, never changed below.
  const now = readRegular(decisionsPath);
  if (!numbers.every((n) => entries[n - 1].to <= now.length && now.slice(0, entries[n - 1].to) === decisions.slice(0, entries[n - 1].to))) {
    fail(`${decisionsPath} changed (not just appended to) while this ran; nothing was written, run it again`);
  }
  appendAll(archivePath, block, io);

  const after = readRegular(archivePath);
  const check = parseArchive(after);
  const named = check.error ? new Set() : matchRecords(now, parseEntries(now).entries, check.records).archived;
  if (!after.includes(block) || check.error || !numbers.every((n) => named.has(n - 1))) fail(`${archivePath} does not read back with the appended block; decisions.md was not changed, so nothing is hidden or lost – check the archive with git`);
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
