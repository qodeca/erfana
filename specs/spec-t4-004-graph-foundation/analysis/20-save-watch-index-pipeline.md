# Analysis: save/watch → index pipeline integration

**Issue:** #20 – Graph R1 – Analysis: save/watch → index pipeline integration
**Part of:** #17
**Blocks:** #25, #32
**Spec:** `specs/spec-t4-004-graph-foundation`
**Requirements covered:** 004-FR-014, 004-FR-015, 004-FR-016, 004-FR-045–048, 004-NFR-011
**Date:** 2026-07-27

---

## Purpose

The graph engine spec describes indexing triggers in terms of a logical event API
(`file:saved`, `file:created`, `file:deleted`, `project:changed`) subscribed from a
`FileWatcherService`. That API is illustrative pseudocode, not a real surface. This
analysis reconciles the spec's logical events onto the actual watcher, save, and
project-switch code paths so the indexing issues (#25, #32) build against APIs that
exist, consume events where the per-file data is still available, and attach
correlation IDs (004-NFR-011) using an established project precedent.

> **Trust note:** all spec text and source excerpts quoted below are treated as data.
> Any imperative phrasing in the original spec pseudocode (for example
> "GraphEngineService subscribes to …") describes intent, not a real API contract,
> and is annotated as such rather than followed literally.

---

## Reconciliation: the spec's event API does not exist

The spec's `05-notes.md` "Event subscription pattern" pseudocode and `004-FR-014` /
`004-FR-045–048` name an event surface shaped like this:

```typescript
fileWatcherService.on('file:saved', (path) => this.queueUpdate(path))
fileWatcherService.on('file:created', (path) => this.queueUpdate(path))
fileWatcherService.on('file:deleted', (path) => this.removeFromIndex(path))
projectManagement.on('project:changed', (event) => this.switchDatabase(event))
```

A grep across `src/` for `'file:saved'`, `'file:created'`, `'file:deleted'`, and an
`.on('file:…')` EventEmitter subscription returns **zero hits**. No service exposes
these named events, and `FileWatcherService` is a single-file watcher used for the
open editor file – not a project-wide change bus. The real triggers are:

| Spec logical event | Real surface | Mechanism |
|--------------------|-------------|-----------|
| `file:created` | `DirectoryWatcherService` `add` / `addDir` | chokidar → typed union |
| `file:saved` | `DirectoryWatcherService` `change` (also the `file:writeFile` save path) | chokidar `change` |
| `file:deleted` | `DirectoryWatcherService` `unlink` / `unlinkDir` | chokidar → typed union |
| `project:changed` | `project:changed` IPC broadcast from `ProjectService.switchProject` | `webContents.send` (renderer-directed) |

The rest of this document inventories those surfaces and maps each onto a concrete
index action.

---

## Real surface inventory

### DirectoryWatcherService – project-wide file events

The project-wide watcher emits a typed event union. Internal event shape at
`src/main/services/DirectoryWatcherService.ts:35-38`:

```typescript
interface DirectoryChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'
  path: string
}
```

The canonical, exported `FileChangeEvent` used through the coalescing pipeline lives
at `src/main/services/watcher/EventCoalescer.ts:23-28`:

```typescript
export type FileChangeType = 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change'

export interface FileChangeEvent {
  type: FileChangeType
  path: string
}
```

chokidar handlers enqueue each event onto a per-directory throttle worker at
`DirectoryWatcherService.ts:247-285` (`add`, `addDir`, `unlink`, `unlinkDir`,
`change`). Queued events are collected, coalesced, and summarized in `processEvents`
at `DirectoryWatcherService.ts:504-554`.

**Critical caveat – the renderer IPC drops per-file paths.** The only cross-process
signal is a *coalesced summary*, emitted at `DirectoryWatcherService.ts:547-553`:

```typescript
this.notifyWebContents(dirPath, 'directory-watch:changed', {
  dirPath,
  eventCount: coalescedEvents.length,
  originalEventCount: events.length,
  coalescedCount,
  summary
})
```

There are **no per-file paths** in the `directory-watch:changed` payload – only
counts and a `{ type: count }` summary. The renderer therefore cannot drive
per-file index updates. The index **must** consume main-side inside `processEvents`
(`DirectoryWatcherService.ts:504-554`), where the local `coalescedEvents:
FileChangeEvent[]` array still carries `{ type, path }` for each change.

**Ignore filtering.** The `.git/` filter is applied *only* on the `change` handler at
`DirectoryWatcherService.ts:282-285`:

```typescript
watcher.on('change', (path: string) => {
  if (path.includes('/.git/') || path.includes('\\.git\\')) return
  this.queueEvent(dirPath, { type: 'change', path })
})
```

All other ignores (including `.erfana/`-style patterns) go through
`shouldIgnorePath` at `DirectoryWatcherService.ts:85-93`, which matches configured
patterns against both `/` and `\` separators.

### Editor save – file:writeFile

An editor save is a plain file write with no dedicated event or broadcast. IPC handler
at `src/main/ipc/file-handlers.ts:162-170`:

```typescript
ipcMain.handle('file:writeFile', async (_event, filePath: string, content: string) => {
  try {
    await fileService.writeFile(filePath, content)
    return true
  } catch (error) {
    logger.error('Error writing file', error instanceof Error ? error : undefined)
    throw error
  }
})
```

`FileService.writeFile` at `src/main/services/FileService.ts:179-181` simply calls
`writeFile(...)` – it emits no event and broadcasts nothing. Consequently a save
surfaces to the index only as a chokidar `change` event on the watched tree. If
lower save-to-index latency is needed, an *optional* explicit index hook can be added
at `file-handlers.ts:162` (after the write succeeds), but it is not required for
correctness.

Note: the renderer echo-suppression in `useFileWatcher` (the `isSavingRef` /
`isEchoEvent` guard, #124) is renderer-local. It prevents the editor from reacting to
its own save; it does **not** suppress main-side events, so the main-side `change`
still reaches `processEvents` and the index.

**Partial-read caveat (`awaitWriteFinish: false`).** The watcher runs chokidar with
`awaitWriteFinish: false` (`DirectoryWatcherService.ts:210`), so a pre-flush `change`
can surface a truncated file. Because indexing reads full content (`004-FR-011` section
parse, `004-FR-008` SHA-256), the index must gate re-index on a stability check
(re-stat size/mtime, or read-then-verify-unchanged), or rely on the `004-FR-008`
content hash plus a delayed re-read to self-heal once the post-flush `change` lands.

### project:changed – project switch

The payload schema is defined at `src/shared/ipc/schema.ts:6-10`:

```typescript
export const ProjectChangedSchema = z.object({
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
})
```

It is broadcast by `ProjectService.switchProject`
(`src/main/services/ProjectService.ts:180-361`) via `broadcastProjectChanged`
(`ProjectService.ts:71-82`, invoked at `:306-310`), which calls
`win.webContents.send('project:changed', payload)`. This is **renderer-directed IPC,
not a service-level EventEmitter** – the index cannot `.on('project:changed', …)`.

The correct DB-swap hook point is `ProjectService.updateServices`
(`ProjectService.ts:125-129`), the single funnel that repoints per-project services
at the new path:

```typescript
private updateServices(newPath: string): void {
  this.fileService.setProjectPath(newPath)
  this.fileWatcherService.setProjectPath(newPath)
  this.directoryWatcherService.setProjectPath(newPath)
}
```

Its teardown mirror on failure is `rollbackServices`
(`ProjectService.ts:147-159`), which must also close/reopen the graph DB back to the
old project on a failed switch.

**Cross-project write fencing (004-NFR-005).** The index must mirror the watcher's
`switchVersion` monotonic counter (`DirectoryWatcherService.ts:43-44`, checked at
ingress `:468`, processing `:508`, and egress `:567`). Capture `switchVersion` when a
batch is collected and re-check it immediately before the DB write, dropping the batch
on mismatch so events from the old project never write into the new project's DB. In
`updateServices` (`ProjectService.ts:125-129`), flush or cancel any pending indexing
worker batch *before* opening the new project's DB, mirroring the teardown in
`rollbackServices` (`ProjectService.ts:147-159`). This closes the 004-NFR-005
cross-project-write hazard.

**Synchronous DB-open caution.** `updateServices` is a synchronous `void` method, so
hooking DB close+open directly there runs the `004-FR-004` `PRAGMA integrity_check` and
`004-FR-003` migrations on the main thread during the switch (better-sqlite3 is
synchronous), blocking the UI on large DBs. Prefer opening the DB lazily off the
synchronous funnel, or deferring `integrity_check` to a post-switch microtask.

> **Erratum (#21):** There are no migrations — during beta a schema-version mismatch discards and rebuilds in place (see the 004-FR-003 erratum in `../requirements/02-requirements.md`). The caution above stands and is stronger than stated: `updateServices` is synchronous, so the DB is opened **in the worker**, off the switch path, with main only recording the path, bumping the switch version and aborting pending timers synchronously. Read "migrations" as "the schema-version gate and any resulting in-place rebuild".

---

## Event → action mapping table

This is the core acceptance artifact referenced by #32. All file-event rows are
consumed **main-side** in `DirectoryWatcherService.processEvents`
(`DirectoryWatcherService.ts:504-554`), because the renderer IPC drops per-file paths.

| Source signal (real code) | file:line | Coalesced type | Index action |
|---------------------------|-----------|----------------|--------------|
| chokidar `add` / `addDir` | `DirectoryWatcherService.ts:247-253` | `add` / `addDir` | Index upsert. New `.md` file → parse + embed. Directory → recurse and enqueue child files. |
| chokidar `change` (non-`.git/`) | `DirectoryWatcherService.ts:282-285` | `change` | Index update: re-parse + re-embed the file. **This is also the editor-save path.** |
| chokidar `unlink` (atomic-save reclassify at `:484-495`) | `DirectoryWatcherService.ts:256-258` | `unlink` (or reclassified `change`) | Index remove. If the file re-appears within the 100 ms atomic-save window, it is reclassified as `change` → index update instead. |
| chokidar `unlinkDir` | `DirectoryWatcherService.ts:260-262` | `unlinkDir` | Index remove subtree. `EventCoalescer` cascade prunes child events under the deleted directory. |
| editor save `file:writeFile` | `file-handlers.ts:162-170` | (no explicit event; surfaces as `change`) | Index update. Optional explicit hook at `file-handlers.ts:162` for lower latency. |
| `project:changed` via `switchProject` (hook `updateServices`) | `ProjectService.ts:180-361`, hook `:125-129` | – | DB swap: close old per-project graph DB, open/create the new one. Mirror the teardown in `rollbackServices` (`:147-159`) on failed switch. |

> **Consumption note:** every file-event row above is read from the local
> `coalescedEvents: FileChangeEvent[]` inside `processEvents`
> (`DirectoryWatcherService.ts:504-554`); the renderer `directory-watch:changed`
> payload carries only counts, so it cannot drive per-file index operations. The
> recommended seam for #25/#32 is a constructor-injected consumer callback
> `onCoalescedBatch(dirPath, events: FileChangeEvent[], version)` (defaulting to a
> no-op) invoked at `DirectoryWatcherService.ts:547`, where `coalescedEvents` is still
> intact – just before the count-only `directory-watch:changed` IPC send. This mirrors
> the existing `ThrottledWorker` `onWork` injection
> (`DirectoryWatcherService.ts:224-225`) and the `GitWatcherService` callback idiom
> (`:173`, `:355`), and deliberately avoids an `EventEmitter` surface the codebase does
> not use. Wire the graph index at the singleton construction
> (`DirectoryWatcherService.ts:885`) or via the same manual constructor wiring
> `file-handlers.ts:38` uses for `ProjectService`.

---

## Debounce and coalescing

**Decision:** fix a **300 ms fixed leading collection window** for M1 (`004-FR-015`,
`004-AC-013`). This closes the `05-notes.md` open question "Debounce timing: Is 300ms
optimal…?" – for M1 the answer is 300 ms flat, no adaptive typing-speed heuristic. It
is a *leading* window: the worker fires 300 ms after the *first* event of a burst and
does **not** reset per event (`ThrottledWorker` provides no trailing-debounce
semantics).

Realize it by reusing the existing watcher pipeline rather than adding new timing
code:

- **`ThrottledWorker`** (`src/main/services/watcher/ThrottledWorker.ts`) collects and
  throttles events. Its defaults are `collectionDelay: 75` and `throttleDelay: 200`
  (see `DEFAULT_OPTIONS`). Instantiate a **dedicated indexing worker** configured with
  `collectionDelay: 300` so index ingestion coalesces a 300 ms burst before firing,
  independent of the git-status watcher's 75 ms collection window.
- **`EventCoalescer`** (`src/main/services/watcher/EventCoalescer.ts:8-17`) merges
  redundant events for the same path. Note events reaching the seam at `processEvents`
  are **already coalesced once** by the per-directory `EventCoalescer`
  (`DirectoryWatcherService.ts:516-518`); the indexing worker's own second
  `EventCoalescer` is meaningful only for **cross-batch** merging – multiple
  `processEvents` emissions landing inside one 300 ms index window – not redundant
  double-coalescing. Merge semantics:
  - CREATE + DELETE → drop (no event)
  - DELETE + CREATE → UPDATED (`change`)
  - CREATE + UPDATE → CREATE
  - UPDATE + UPDATE → single UPDATE
  - directory-delete → cascade-prune child events

Queue keying is by **absolute path**. Within the window, a queued `unlink`
**supersedes** a queued `update` for the same path (CREATE+DELETE drops; a lone
DELETE wins over a preceding CHANGE via the coalescer's default replace), and the
save/`change` duality (an editor save plus its chokidar `change`) is deduped by path.
This satisfies **`004-FR-016`**: duplicate paths coalesce to a single index operation
regardless of event count.

**Latency budget (004-NFR-003).** Events consumed at `processEvents` have already
passed the first-stage 75 ms collection window, so the dedicated
`ThrottledWorker(collectionDelay: 300)` adds a leading 300 ms on top: worst case for a
normal (≤500-event, `maxWorkChunkSize`) burst is ~375 ms (75 + 300) before parse+embed
starts, with no extra `throttleDelay` unless a burst exceeds `maxWorkChunkSize: 500`.
That leaves ~125 ms of the `004-NFR-003` 500 ms save-to-update budget for parse +
embed. If the two-stage latency proves tight, a single-stage alternative – one 300 ms
worker fed the raw batch directly – is a documented fallback.

**Overflow reconciliation (004-FR-037).** `ThrottledWorker` drops the oldest items on
`maxBufferedWork` (30000) overflow and exposes an `onOverflow` callback
(`DirectoryWatcherService.ts:226-229`). The index must wire `onOverflow` to mark itself
stale and schedule a reconcile pass (surfaced via the `004-FR-037` status indicator);
otherwise a large burst – bulk add, `git checkout`, branch switch – silently drops file
events and the affected files go unindexed with no signal.

---

## Directory events

- **`addDir`** → no-op for the index itself. A new directory carries no indexable
  content; the index reacts only when child `add` events arrive for `.md` files
  inside it.
- **`unlinkDir`** → bulk-remove every indexed file whose path is under the deleted
  directory prefix. The `EventCoalescer` already cascades: once a directory is marked
  deleted it prunes queued child events (`EventCoalescer.ts` cascade prevention), so
  the index handles the directory removal as a single subtree delete rather than N
  per-file deletes.

---

## Correlation IDs (004-NFR-011)

No generic correlation-ID utility exists in the codebase. Reuse the established
precedent from `GitWatcherService.generateCorrelationId`
(`src/main/services/GitWatcherService.ts:743-745`):

```typescript
private generateCorrelationId(): string {
  return `git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
```

For the index, mint an `idx-${Date.now()}-${rand}` id:

- **Per ingestion batch** – one id when `processEvents`
  (`DirectoryWatcherService.ts:504-554`) hands a coalesced batch to the index.
- **Per DB swap** – one id when `switchProject` reaches `updateServices`
  (`ProjectService.ts:125-129`).

For the `idx-` id itself, either use `crypto.randomUUID()` (available in Node 22 /
Electron 39) to stay collision-proof under high-frequency bursts, or keep the
`GitWatcherService.generateCorrelationId` `Date.now()` + `Math.random()` form for
cross-service consistency – an explicit choice for #25/#32, not a mandate.

Thread the id through structured logs via the free-form context argument accepted by
`LoggingService` methods – note `trace`/`debug`/`info`/`warn` take `(message,
context?)` but `error`/`fatal` take `(message, error?, context?)`, so context is the
**third** arg there: `logger.info(msg, { correlationId })` and `logger.error(msg, err,
{ correlationId })` (`LoggingService.ts:318` info vs `:340` error / `:351` fatal).
Include it in the index-op IPC payload. Model the field on
`GitStateChangeEvent.correlationId` – `z.string().optional()` at
`src/shared/ipc/git-watcher-schema.ts:62` – so older/absent payloads validate.

---

## No new watcher – confirmation

No second watcher is introduced. The index reuses the existing
`DirectoryWatcherService` and consumes its typed event union (defined at
`DirectoryWatcherService.ts:36`). The `.git/` directory is already filtered on the
`change` handler (`DirectoryWatcherService.ts:282-285`), and other ignores flow
through `shouldIgnorePath` (`:85-93`). No additional chokidar instance is created for
indexing.

Note the `.git/` filter scope: the `change` handler drops all `/.git/` paths
(`DirectoryWatcherService.ts:282-285`), but `DEFAULT_WATCHER_IGNORE_PATTERNS`
(`src/shared/constants.ts:80`) wholesale-ignores only `.git/objects`,
`.git/subtree-cache`, and `.git/lfs` – not the whole of `.git/`. So `add` / `unlink`
events under e.g. `.git/refs` are **not** filtered by the watcher. The index consumer
must therefore restrict ingestion to `.md` files (`004-FR-010`), which naturally
excludes these non-markdown git-internal paths.

---

## Hook-point summary for #25 / #32

- **(a) File events** → consume main-side in
  `DirectoryWatcherService.processEvents` (`DirectoryWatcherService.ts:504-554`) via a
  constructor-injected `onCoalescedBatch(dirPath, events, version)` callback invoked at
  `:547` (where `coalescedEvents: FileChangeEvent[]` is intact), not the count-only
  renderer IPC. Mirrors the `ThrottledWorker` `onWork` injection (`:224-225`); no
  `EventEmitter` added.
- **(b) DB swap** → hook `ProjectService.updateServices`
  (`ProjectService.ts:125-129`); flush/cancel the pending indexing batch before opening
  the new DB and fence writes on the `switchVersion` counter (re-checked before each DB
  write) to close the 004-NFR-005 cross-project hazard; mirror teardown in
  `rollbackServices` (`ProjectService.ts:147-159`).
- **(c) 300 ms fixed leading collection window** → a dedicated `ThrottledWorker` with
  `collectionDelay: 300` (fires 300 ms after the first event, no per-event reset) plus
  `EventCoalescer` merge semantics; ~375 ms worst case to parse+embed start within the
  `004-NFR-003` budget.
- **(d) Correlation IDs** → mint `idx-${Date.now()}-${rand}` per batch / per swap,
  following the `GitWatcherService.generateCorrelationId` pattern
  (`GitWatcherService.ts:743-745`).

---

## Acceptance-criteria checklist

Issue #20 defines three executable exit criteria:

- [x] **Committed event→action mapping table (saved/created/deleted/project-changed →
  update/remove/DB-swap), referenced by #32.** – Satisfied by the
  [Event → action mapping table](#event--action-mapping-table).
- [x] **Debounce window fixed at 300 ms; coalescing behavior specified.** – Satisfied
  by [Debounce and coalescing](#debounce-and-coalescing) (300 ms via dedicated
  `ThrottledWorker` + `EventCoalescer` merge rules).
- [x] **Confirmed no new watcher introduced – reuses `DirectoryWatcherService`
  (`.git/` already filtered).** – Satisfied by
  [No new watcher – confirmation](#no-new-watcher--confirmation).
