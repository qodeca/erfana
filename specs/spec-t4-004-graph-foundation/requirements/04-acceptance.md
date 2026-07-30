# Acceptance Criteria

## Database Layer

### 004-AC-001: Database initialization

**Traces to:** 004-FR-001, 004-FR-002
**Type:** Happy path

**Given:** A project is opened for the first time
**When:** The graph engine initializes
**Then:**
- A file `.erfana/graph.db` is created
- The database has FTS5 tables (sections_fts)
- `PRAGMA journal_mode` returns 'wal'

---

### 004-AC-002: Schema migration

**Traces to:** 004-FR-003
**Type:** Happy path

**Given:** A project with an older schema version database
**When:** The graph engine opens the database
**Then:**
- Migration scripts are applied in order
- Schema version is updated to current
- Existing data is preserved

> **Erratum (#21):** During beta there are **no data-preserving migrations**, so this criterion inverts: a schema-version mismatch — **higher or lower** — discards all indexed data and triggers a full reindex, **in place** (`DROP` + recreate in one transaction on the same file, never `unlink()` and never `rename()`, because a live read-only handle keeps serving a deleted inode and no PRAGMA detects it). The database is a derived cache (05-notes "Contract stability"), so "Existing data is preserved" does **not** apply. Version lives in `graph_meta.schema_version` (`value_int`, not `value` — TEXT affinity would return `'1'` and fail the `===` gate on every open). See `specs/designs/sd-021-db-contracts.md` C3 and `specs/designs/sd-021-db-schema.md` §6.6.

---

### 004-AC-003: Corruption detection and recovery

**Traces to:** 004-FR-004
**Type:** Error scenario

**Given:** A corrupted database file exists
**When:** The graph engine attempts to open it
**Then:**
- Integrity check fails
- User sees "Index corrupted" dialog
- "Rebuild" option deletes and recreates database

> **Erratum (#21):** The dialog clause is **dropped**. Corruption recovery is automatic and silent for the first recovery — the index is a rebuildable derived cache, so there is no modal, no confirmation and no "Rebuild?" prompt; the sequence surfaces only through the status indicator (yellow → green). **A recurring rebuild is not silent:** `GRAPH.MAX_AUTO_REBUILDS_PER_SESSION` = 2 with a 10-minute cooldown, persisted in `graph_meta`; on exhaustion Erfana stops rebuilding, enters `disabled` with `GRAPH_DB_REBUILD_FAILED`, and surfaces it. See `specs/designs/sd-021-cross-cutting.md` §9.10.

> **Erratum (#21):** Rebuild is **in place** — `DROP` + recreate in a single transaction on the same `graph.db` — never by deleting or renaming it. A live read-only connection follows an in-place rebuild transparently, but after `unlink()` + recreate it silently serves the deleted inode forever (measured; `data_version` / `schema_version` / `user_version` all fail to detect it), and on Windows unlinking an open file typically fails outright. Read "deletes and recreates database" as "drops and recreates all tables in place". See `specs/designs/sd-021-db-contracts.md` C3 and `specs/designs/sd-021-db-schema.md` §6.6.

---

### 004-AC-004: SQL injection prevention

**Traces to:** 004-FR-005
**Type:** Security

**Given:** A markdown file containing SQL injection payload in content
**When:** The file is indexed
**Then:**
- Content is stored as literal text
- No SQL commands are executed
- Database remains uncorrupted

---

## Preprocessing Pipeline

### 004-AC-005: Markdown stripping

**Traces to:** 004-FR-006
**Type:** Happy path

**Given:** A file containing `**bold** and _italic_ text with [links](url)`
**When:** The file is preprocessed for indexing
**Then:**
- Indexed text is "bold and italic text with links"
- Formatting syntax is removed
- Link URLs are excluded

---

### 004-AC-006: Whitespace normalization

**Traces to:** 004-FR-007
**Type:** Happy path

**Given:** A file with inconsistent whitespace (tabs, multiple newlines)
**When:** The file is preprocessed
**Then:**
- Indexed text has single spaces between words
- No leading/trailing whitespace
- Multiple newlines collapsed

---

### 004-AC-007: Content hashing for change detection

**Traces to:** 004-FR-008
**Type:** Happy path

**Given:** A section with known content
**When:** The content is unchanged and file is saved
**Then:** The computed hash matches the stored hash
**And When:** One character is changed
**Then:** The computed hash differs from stored hash

---

## Indexing Pipeline

### 004-AC-008: File discovery respects gitignore

**Traces to:** 004-FR-010
**Type:** Happy path

**Given:** A project with `.gitignore` containing "*.draft.md"
**When:** The project is indexed
**Then:**
- Files matching `*.draft.md` are not indexed
- `.erfana/` directory is excluded
- `node_modules/` (if in .gitignore) is excluded

---

### 004-AC-009: Section extraction by headings

**Traces to:** 004-FR-011
**Type:** Happy path

**Given:** A file with structure:
```markdown
# Heading 1
Content for h1
## Heading 2
Content for h2
### Heading 3
Content for h3
```
**When:** The file is indexed
**Then:**
- Three sections are created
- Each section has correct heading text
- Section hierarchy is recorded (h1 > h2 > h3)

---

### 004-AC-010: Incremental update efficiency

**Traces to:** 004-FR-012
**Type:** Performance

**Given:** A file with 5 sections, one section changed
**When:** The file is re-indexed after save
**Then:**
- Only the changed section is updated (1 UPDATE)
- Unchanged sections are not touched (4 skipped)
- Operation completes in < 100ms (stricter than 004-NFR-003's < 500ms incremental update latency bound)

> **Erratum (#21):** The write path re-indexes at **file** granularity: an unchanged file is short-circuited on `files.file_hash`, and a changed file has its sections deleted and re-inserted with fresh ids rather than upserted per ordinal. Section-level upsert was rejected because it strands trailing `sections` and `sections_fts` rows when an edited file yields fewer sections, never decrements `contents.ref_count`, and drifts every counter — and because FTS5 rows must then be `UPDATE`d at a retained rowid, which nothing in the spec described. Read "only the changed section is updated (1 UPDATE)" as "only changed **files** are re-indexed; an unchanged file performs zero writes". The < 100 ms bound is unaffected. See `specs/designs/sd-021-db-schema.md` §6.7.

---

### 004-AC-011: Progress events during batch indexing

**Traces to:** 004-FR-013
**Type:** Happy path

**Given:** A project with 200 markdown files
**When:** Initial indexing begins
**Then:**
- Progress events are emitted at least every 50 files
- Each event includes current count and total count
- UI progress indicator updates in real-time

---

### 004-AC-012: Event-driven indexing trigger

**Traces to:** 004-FR-014, 004-FR-045
**Type:** Integration

**Given:** A project with indexed content
**When:** User saves a file in the editor
**Then:**
- `file:saved` event is received by GraphEngineService
- Index update is queued
- Index is updated within 500ms of save

> **Erratum (#21, propagating #20):** The literal `file:saved` / `file:created` / `file:deleted` API does not exist — a grep across `src/` returns zero hits — and `FileWatcherService` is a **single-file** watcher for the open editor file, not a project-wide bus. Read "`file:saved` event is received by GraphEngineService" as: "`DirectoryWatcherService` emits a coalesced `add`/`change`/`unlink` batch, consumed **main-side** in `processEvents` via the constructor-injected `onCoalescedBatch(dirPath, events, version)` callback at `DirectoryWatcherService.ts:545-546`, where `coalescedEvents` (bound `:518`) is still intact, immediately before the count-only send at `:547`." The renderer `directory-watch:changed` payload carries counts only. See `analysis/20-save-watch-index-pipeline.md`.

---

### 004-AC-013: Debounce rapid saves

**Traces to:** 004-FR-015
**Type:** Performance

**Given:** A file being edited
**When:** User saves 5 times within 200ms (rapid Ctrl+S)
**Then:**
- Only one index update operation is performed
- Debounce window is 300ms
- Final content is indexed

---

## Search API

### 004-AC-014: BM25 ranking quality

**Traces to:** 004-FR-017, 004-FR-018
**Type:** Happy path

**Given:** Documents A (query term in heading) and B (query term only in body)
**When:** Search is performed for that term
**Then:**
- Document A ranks higher than Document B
- Heading weight (3x) is applied correctly
- Relevance scores are returned with results

---

### 004-AC-015: Folder filter

**Traces to:** 004-FR-019
**Type:** Happy path

**Given:** Files in `docs/` and `specs/` directories
**When:** Search with folder filter "docs/"
**Then:**
- Only results from `docs/` directory are returned
- Results from `specs/` are excluded

---

### 004-AC-016: Top-K pagination

**Traces to:** 004-FR-022
**Type:** Happy path

**Given:** 50 matching documents for a query
**When:** Initial search is performed (k=10)
**Then:**
- Exactly 10 results are returned
- Results are ranked by relevance
**And When:** "Load more" is triggered
**Then:**
- Next 10 results are returned
- Previous results are not duplicated

---

### 004-AC-017: Search latency performance

**Traces to:** 004-NFR-001
**Type:** Performance

**Given:** A corpus of 10,000 indexed sections (per 004-NFR-001 search latency requirement)
**When:** 100 search queries are executed
**Then:**
- 95th percentile latency is under 50ms
- All queries complete successfully
- Results are correctly ranked

---

## UI - Related Sidebar

### 004-AC-018: Related content auto-update

**Traces to:** 004-FR-024, 004-FR-025
**Type:** Happy path

**Given:** Related sidebar is visible and file is open
**When:** User scrolls to a different heading
**Then:**
- Sidebar updates within 500ms
- New related sections are displayed
- Current section is excluded from results

---

### 004-AC-019: Navigate to related section

**Traces to:** 004-FR-026
**Type:** Happy path

**Given:** Related sidebar shows related sections
**When:** User clicks a related section item
**Then:**
- The related file opens in editor
- Editor scrolls to the specific heading
- Cursor is positioned at heading

---

### 004-AC-020: Copy citation

**Traces to:** 004-FR-027
**Type:** Happy path

**Given:** Related sidebar shows related sections
**When:** User clicks copy citation button on an item
**Then:**
- Markdown link is copied to clipboard
- Format is `[Section Title](./relative/path.md#heading-slug)`
- Heading slug is URL-safe

---

## UI - Global Search

### 004-AC-021: Open global search

**Traces to:** 004-FR-029
**Type:** Happy path

**Given:** User is working in Erfana
**When:** User presses Cmd+Shift+F
**Then:**
- Global search panel opens
- Search input is focused
- Recent searches are shown (if any)

---

### 004-AC-022: Display search results

**Traces to:** 004-FR-030
**Type:** Happy path

**Given:** Global search is open
**When:** User types query and waits for results
**Then:**
- Results are displayed with file path
- Section heading is shown
- Context snippet with highlighted matches is shown
- Match count is displayed

---

### 004-AC-023: Why this result expansion

**Traces to:** 004-FR-023, 004-FR-032
**Type:** Happy path

**Given:** Search results are displayed
**When:** User expands a result
**Then:**
- Matched terms are listed
- Context for each match is shown
- Term positions are highlighted

---

## UI - Settings Panel

### 004-AC-024: Manual reindex

**Traces to:** 004-FR-033
**Type:** Happy path

**Given:** Project is open with existing index
**When:** User clicks "Rebuild Index" and confirms
**Then:**
- Existing index is deleted
- Full re-indexing begins
- Progress is shown
- Completion message displays stats

> **Erratum (#21):** Rebuild is **in place** — `DROP` + recreate in a single transaction on the same `graph.db` — never by deleting or renaming it. A live read-only connection follows an in-place rebuild transparently, but after `unlink()` + recreate it silently serves the deleted inode forever (measured; `data_version` / `schema_version` / `user_version` all fail to detect it), and on Windows unlinking an open file typically fails outright. Read "Existing index is deleted" as "all tables are dropped and recreated in place". The confirmation copy becomes "This will clear and rebuild the entire index. Continue?". See `specs/designs/sd-021-db-contracts.md` C3 and `specs/designs/sd-021-db-schema.md` §6.6.

---

### 004-AC-025: Corpus statistics display

**Traces to:** 004-FR-034
**Type:** Happy path

**Given:** Project is indexed
**When:** User opens Settings > Graph Engine
**Then:**
- Total files indexed is shown
- Total sections count is shown
- Total word count is shown
- Last indexing time is shown

---

## UI - Status Indicator

### 004-AC-026: Status dot states

**Traces to:** 004-FR-037
**Type:** Happy path

**Given:** Graph engine is operational
**Then:**
- Green dot when index is up to date
- Yellow dot during indexing operations
- Red dot when error has occurred

---

### 004-AC-027: Progress display during indexing

**Traces to:** 004-FR-036
**Type:** Happy path

**Given:** Initial indexing of 200 files is in progress
**When:** User observes status bar
**Then:**
- Text shows "Indexing: 50/200 files"
- Counter updates as files are processed
- Shows "Up to date" when complete

---

## MCP Integration

### 004-AC-028: MCP tool registration

**Traces to:** 004-FR-039, 004-FR-040
**Type:** Happy path

**Given:** Erfana is running with a project open
**When:** MCP client requests tools list
**Then:**
- `erfana_graph_search` tool is listed
- Tool schema includes query (required), k (optional), filters (optional)
- Tool description is provided

---

### 004-AC-029: MCP search execution

**Traces to:** 004-FR-041
**Type:** Happy path

**Given:** MCP server is running
**When:** Client invokes `erfana_graph_search` with query "authentication"
**Then:**
- Search is executed
- Results are returned as JSON array
- Each result has file_path, section_heading, content_snippet, relevance_score

---

### 004-AC-030: MCP rate limiting

**Traces to:** 004-FR-042
**Type:** Behavioral scenario

**Given:** MCP client has made 100 queries in the last minute (default limit)
**When:** Client makes query 101
**Then:**
- The query is queued and delayed (backpressure), not rejected
- No error response is returned; the query eventually completes
- The limit is configurable in settings

> **Erratum (#21):** "Queued and delayed, not rejected" assumes a transport with flow control. `MessagePortMain` has none — `postMessage` never blocks and queues unconditionally — so unbounded delay-queueing is not backpressure; it is an unbounded main-process queue a looping client can grow without limit, each entry landing on the synchronous main-thread reader from outside the trust boundary. Read this as: "apply advisory rate limiting with a bounded queue (`MCP.MAX_INFLIGHT` = 4, `MCP.MAX_QUEUE_DEPTH` = 32); requests beyond the bound receive a typed `graph:throttled` response carrying `retryAfterMs`, which the client is expected to honour." "No error response is returned" becomes "no *failure* response is returned; a throttle signal with a retry hint is". See `specs/designs/sd-021-cross-cutting.md` §9.5.

---

### 004-AC-031: MCP auto-lifecycle

**Traces to:** 004-FR-043, 004-FR-044
**Type:** Happy path

**Given:** User opens a project
**Then:** MCP server starts automatically
**And When:** User quits Erfana
**Then:**
- Pending MCP requests complete
- Server shuts down gracefully

---

## Integration

### 004-AC-032: Handle file:created event

**Traces to:** 004-FR-046
**Type:** Integration

**Given:** Project is indexed
**When:** New markdown file is created
**Then:**
- `file:created` event is received
- New file is indexed within 500ms
- File appears in search results

> **Erratum (#21, propagating #20):** The literal `file:saved` / `file:created` / `file:deleted` API does not exist — a grep across `src/` returns zero hits — and `FileWatcherService` is a **single-file** watcher for the open editor file, not a project-wide bus. Read "`file:created` event is received" as: "`DirectoryWatcherService` emits a coalesced `add`/`change`/`unlink` batch, consumed **main-side** in `processEvents` via the constructor-injected `onCoalescedBatch(dirPath, events, version)` callback at `DirectoryWatcherService.ts:545-546`, where `coalescedEvents` (bound `:518`) is still intact, immediately before the count-only send at `:547`." The renderer `directory-watch:changed` payload carries counts only. See `analysis/20-save-watch-index-pipeline.md`.

---

### 004-AC-033: Handle file:deleted event

**Traces to:** 004-FR-047
**Type:** Integration

**Given:** Project is indexed with file A
**When:** File A is deleted
**Then:**
- `file:deleted` event is received
- File is removed from index
- File no longer appears in search results

> **Erratum (#21, propagating #20):** The literal `file:saved` / `file:created` / `file:deleted` API does not exist — a grep across `src/` returns zero hits — and `FileWatcherService` is a **single-file** watcher for the open editor file, not a project-wide bus. Read "`file:deleted` event is received" as: "`DirectoryWatcherService` emits a coalesced `add`/`change`/`unlink` batch, consumed **main-side** in `processEvents` via the constructor-injected `onCoalescedBatch(dirPath, events, version)` callback at `DirectoryWatcherService.ts:545-546`, where `coalescedEvents` (bound `:518`) is still intact, immediately before the count-only send at `:547`." The renderer `directory-watch:changed` payload carries counts only. See `analysis/20-save-watch-index-pipeline.md`.

---

### 004-AC-034: Handle project:changed event

**Traces to:** 004-FR-048
**Type:** Integration

**Given:** Project A is open and indexed
**When:** User opens Project B
**Then:**
- `project:changed` event is received
- Database for Project A is closed
- Database for Project B is opened/created
- Project B content is searchable

> **Erratum (#21, propagating #20):** `project:changed` is renderer-directed IPC (`webContents.send` from `switchProject`), not a service EventEmitter — nothing can `.on()` it. Read "`project:changed` event is received" as: "`ProjectService.updateServices` (`:125-129`) calls `IGraphProjectLifecycle.onProjectPathChanged`, which synchronously bumps the switch version, aborts pending timers, drops queued batches and detaches the reader, then enqueues **close-then-open** asynchronously off the switch path; teardown mirrors in `rollbackServices` (`:147-159`)." See `specs/designs/sd-021-db-contracts.md` §5.2.

---

## Non-Functional

### 004-AC-035: Indexing throughput

**Traces to:** 004-NFR-002
**Type:** Performance

**Given:** A fresh project with 1,000 markdown files
**When:** Initial indexing is triggered
**Then:**
- Indexing completes in under 10 seconds
- Throughput is > 100 files/second

---

### 004-AC-036: Incremental update latency

**Traces to:** 004-NFR-003
**Type:** Performance

**Given:** Project is indexed
**When:** Single file is saved
**Then:**
- Index update completes within 500ms
- Update is reflected in search immediately

---

### 004-AC-037: Database isolation

**Traces to:** 004-NFR-005
**Type:** Security

**Given:** Two projects A and B are opened in sequence
**When:** User searches in Project B
**Then:**
- Only Project B content is returned
- Project A content is not accessible
- Separate database files exist for each

---

### 004-AC-038: Graceful error handling

**Traces to:** 004-NFR-006
**Type:** Error scenario

**Given:** A malformed markdown file exists
**When:** Indexing processes that file
**Then:**
- Error is logged with file path
- Indexing continues with other files
- User is notified of skipped file
- Application does not crash

---

### 004-AC-039: Structured logging

**Traces to:** 004-NFR-009
**Type:** Observability

**Given:** Indexing and search operations occur
**When:** Logs are examined
**Then:**
- Log entries are in JSON format
- Each entry has timestamp, level, message
- Operations include duration metrics
- Errors include stack traces

> **Erratum (#21):** "Log entries are in JSON format" is **not** satisfied by the current logger: the file transport is a plaintext template (`LoggingService.ts:245`), `formatMessage` emits `` `${message} ${JSON.stringify(context)}` `` (`:498`), and `formatErrorMessage` joins parts with `' | '` (`:522`) — no log line is a JSON object. Two ways forward, and the choice belongs to the **JSON log transport** parcel (`(new issue — not yet created)`), not to #31, which is chartered to verify and today has nothing to verify: **(a)** add a JSON file transport (electron-log accepts a `format` function returning a serialised object, so `instanceId`, level, timestamp, message and context become fields); or **(b)** narrow 004-NFR-009/this criterion to "**a human-readable message followed by a single-line JSON context object**", whose parse recipe is: take everything from the first `{` to the end of line and `JSON.parse` it; entries with no context have none. Duration metrics are satisfied by `specs/designs/sd-021-worker-contracts.md` §8.8's phase fields; stack traces are **already automatic** (`LoggingService.ts:511-513`). **Until (a) or (b) lands, this criterion is open** and must not be ticked.

---

### 004-AC-040: IPC correlation tracing

**Traces to:** 004-NFR-011
**Type:** Observability

**Given:** A search request is made via IPC
**When:** Request is traced end-to-end
**Then:**
- Single correlation ID links all log entries
- Main process logs include correlation ID
- Renderer process logs include same correlation ID
