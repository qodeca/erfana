// Ensures the dispatch brief catalogue covers every current routing row exactly once.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(process.argv[2] ?? resolve(scriptDir, '..', '..'));
const routeOutput = execFileSync(process.execPath, [resolve(scriptDir, 'route.mjs'), '--rows'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
const routing = JSON.parse(routeOutput.slice(routeOutput.indexOf('{')));
const briefs = readFileSync(resolve(repositoryRoot, '.xezar/docs/briefs.md'), 'utf8');
const headingIds = [...briefs.matchAll(/^## .+?\(([^)]+)\)$/gm)]
  .flatMap((match) => [...match[1].matchAll(/`([^`]+)`/g)].map((id) => id[1]));
const counts = new Map();
for (const id of headingIds) counts.set(id, (counts.get(id) ?? 0) + 1);

const expected = routing.rows.map((row) => row.id);
const missing = expected.filter((id) => !counts.has(id));
const duplicated = expected.filter((id) => counts.get(id) > 1);
const unknown = headingIds.filter((id) => !expected.includes(id));

if (missing.length || duplicated.length || unknown.length) {
  if (missing.length) console.error(`briefs-check: missing routing row headings: ${missing.join(', ')}`);
  if (duplicated.length) console.error(`briefs-check: duplicate routing row headings: ${duplicated.join(', ')}`);
  if (unknown.length) console.error(`briefs-check: unknown routing row headings: ${unknown.join(', ')}`);
  process.exit(1);
}

console.log(`briefs-check: ${expected.length} routing rows covered exactly once`);
