#!/usr/bin/env node
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const requestedRoot = process.argv[2];
if (process.argv.length > 3) {
  console.error('usage: fenced-quotes.mjs [repository-root]');
  process.exit(2);
}

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repositoryRoot = await realpath(requestedRoot ? path.resolve(requestedRoot) : scriptRoot);
const failures = [];
let checked = 0;
const trackedResult = spawnSync('git', ['-C', repositoryRoot, 'ls-files', '-z'], {
  encoding: 'utf8',
});
if (trackedResult.status !== 0) {
  failures.push(`could not read git index paths: ${trackedResult.stderr.trim() || 'git failed'}`);
}
const trackedPaths = trackedResult.status === 0
  ? trackedResult.stdout.split('\0').filter(Boolean)
  : [];

function withinRepository(candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function markdownFiles() {
  const found = new Set();

  async function walk(directory, keep) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && ['.local', 'node_modules', 'changelog.d'].includes(entry.name)) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, keep);
      else if (entry.isFile() && keep(absolute)) found.add(absolute);
    }
  }

  for (const directory of ['docs', '.xezar/docs']) {
    await walk(path.join(repositoryRoot, directory), (file) => file.endsWith('.md'));
  }
  await walk(
    path.join(repositoryRoot, 'designs'),
    (file) => path.basename(file) === 'README.md',
  );
  for (const entry of await readdir(repositoryRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) found.add(path.join(repositoryRoot, entry.name));
  }
  return [...found].sort();
}

function linesOf(buffer) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue;
    lines.push({ start, end: index + 1, text: buffer.subarray(start, index + 1).toString('utf8') });
    start = index + 1;
  }
  if (start < buffer.length) {
    lines.push({ start, end: buffer.length, text: buffer.subarray(start).toString('utf8') });
  }
  return lines;
}

function openingFence(text) {
  const match = text.match(/^( {0,3})(`{3,}|~{3,})(.*?)(?:\r?\n)?$/);
  if (!match) return null;
  if (match[2][0] === '`' && match[3].includes('`')) return null;
  return { marker: match[2][0], length: match[2].length, indentation: match[1].length };
}

function closesFence(text, fence) {
  const marker = fence.marker === '`' ? '`' : '~';
  const match = text.match(new RegExp(`^ {0,3}(${marker}{${fence.length},})[ \\t]*(?:\\r?\\n)?$`));
  return Boolean(match);
}

function parseSource(specification) {
  const range = specification.match(/^(.*)#L([1-9][0-9]*)-L([1-9][0-9]*)$/);
  return range
    ? { path: range[1], start: Number(range[2]), end: Number(range[3]) }
    : { path: specification, start: null, end: null };
}

async function expectedBytes(specification, document, lineNumber) {
  const source = parseSource(specification);
  const segments = source.path.split(/[\\/]/);
  if (
    !source.path ||
    path.isAbsolute(source.path) ||
    source.path.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(source.path) ||
    segments.includes('..')
  ) {
    failures.push(`${document}:${lineNumber}: source path escapes repository: ${source.path || '(empty)'}`);
    return null;
  }

  const lexicalPath = path.resolve(repositoryRoot, source.path);
  if (!withinRepository(lexicalPath)) {
    failures.push(`${document}:${lineNumber}: source path escapes repository: ${source.path}`);
    return null;
  }

  const gitPath = source.path.split(path.sep).join('/');
  const wrongCasePath = trackedPaths.find(
    (trackedPath) => trackedPath.toLowerCase() === gitPath.toLowerCase()
      && trackedPath !== gitPath,
  );
  if (wrongCasePath) {
    failures.push(
      `${document}:${lineNumber}: source path case does not match git index: ${source.path} (tracked as ${wrongCasePath})`,
    );
    return null;
  }

  let sourcePath;
  try {
    sourcePath = await realpath(lexicalPath);
    const metadata = await lstat(sourcePath);
    if (!metadata.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTFILE' });
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'does not exist' : 'is not a readable file';
    failures.push(`${document}:${lineNumber}: source ${source.path} ${reason}`);
    return null;
  }
  if (!withinRepository(sourcePath)) {
    failures.push(`${document}:${lineNumber}: source path resolves outside repository: ${source.path}`);
    return null;
  }

  const bytes = await readFile(sourcePath);
  if (source.start === null) return bytes;
  const sourceLines = linesOf(bytes);
  if (source.start > source.end || source.end > sourceLines.length) {
    failures.push(
      `${document}:${lineNumber}: source range is outside ${source.path}: L${source.start}-L${source.end}`,
    );
    return null;
  }
  return bytes.subarray(sourceLines[source.start - 1].start, sourceLines[source.end - 1].end);
}

async function checkDocument(absoluteDocument) {
  const relativeDocument = path.relative(repositoryRoot, absoluteDocument).split(path.sep).join('/');
  const bytes = await readFile(absoluteDocument);
  const lines = linesOf(bytes);
  let ordinaryFence = null;
  let pending = null;
  let quote = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (quote) {
      if (!closesFence(line.text, quote.fence)) continue;
      const actual = bytes.subarray(quote.contentStart, line.start);
      const expected = await expectedBytes(quote.source, relativeDocument, quote.markerLine);
      const matches = expected && (
        actual.equals(expected)
        || (expected.at(-1) !== 0x0a
          && actual.length === expected.length + 1
          && actual.at(-1) === 0x0a
          && actual.subarray(0, -1).equals(expected))
      );
      if (expected && !matches) {
        failures.push(
          `${relativeDocument}:${quote.markerLine}: fenced quote differs from ${quote.source}`,
        );
      } else if (expected) {
        checked += 1;
      }
      quote = null;
      continue;
    }

    if (ordinaryFence) {
      if (closesFence(line.text, ordinaryFence)) ordinaryFence = null;
      continue;
    }

    if (pending) {
      const fence = openingFence(line.text);
      if (!fence) {
        failures.push(
          `${relativeDocument}:${pending.line}: marker must be immediately followed by a fenced block`,
        );
        pending = null;
      } else {
        if (fence.indentation > 0) {
          failures.push(
            `${relativeDocument}:${pending.line}: marked fenced block must not be indented`,
          );
          ordinaryFence = fence;
          pending = null;
          continue;
        }
        quote = {
          source: pending.source,
          markerLine: pending.line,
          fence,
          contentStart: line.end,
        };
        pending = null;
        continue;
      }
    }

    const marker = line.text.match(/^ {0,3}<!-- from: (.+?) -->[ \t]*(?:\r?\n)?$/);
    if (marker) {
      pending = { source: marker[1], line: lineNumber };
      continue;
    }
    ordinaryFence = openingFence(line.text);
  }

  if (pending) {
    failures.push(`${relativeDocument}:${pending.line}: marker must be immediately followed by a fenced block`);
  }
  if (quote) {
    failures.push(`${relativeDocument}:${quote.markerLine}: marked fenced block is not closed`);
  }
}

for (const document of await markdownFiles()) await checkDocument(document);

if (failures.length > 0) {
  for (const failure of failures) console.error(`fenced-quotes: ${failure}`);
  process.exit(1);
}

console.log(`fenced-quotes: OK — ${checked} marked quote(s) match`);
