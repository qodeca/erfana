# Requirements

## Functional Requirements

### Database Layer

#### 004-FR-001: Initialize SQLite database with FTS5 extension

**Priority:** Critical
**Traces to:** Core infrastructure

The system shall initialize a SQLite database in the project's `.erfana/` directory with the FTS5 extension loaded. The database file shall be named `graph.db`.

**Acceptance:** Database file is created on first project open with FTS5 tables available.

---

#### 004-FR-002: Enable WAL mode for concurrent access

**Priority:** Critical
**Traces to:** Performance

The system shall configure SQLite in WAL (Write-Ahead Logging) mode to enable concurrent reads during writes, preventing UI blocking during index updates.

**Acceptance:** Multiple read queries execute without blocking during active write operations.

---

#### 004-FR-003: Implement schema versioning and migrations

**Priority:** High
**Traces to:** Maintainability

The system shall track schema version in a metadata table and apply migrations automatically when opening databases created by older versions.

**Acceptance:** Upgrading from schema v1 to v2 applies migrations without data loss.

---

#### 004-FR-004: Execute database integrity checks on startup

**Priority:** High
**Traces to:** Reliability

The system shall run `PRAGMA integrity_check` on startup and report any corruption to the user with recovery options.

**Acceptance:** Corrupted database triggers warning dialog with "Rebuild Index" option.

---

#### 004-FR-005: Use prepared statements exclusively

**Priority:** Critical
**Traces to:** Security

The system shall use prepared statements for all SQL operations to prevent SQL injection vulnerabilities. No string concatenation for query building.

**Acceptance:** Code review confirms zero string-interpolated SQL statements. Static analysis detects zero SQL string interpolation patterns.

---

### Preprocessing Pipeline

#### 004-FR-006: Strip markdown syntax from text

**Priority:** High
**Traces to:** Search quality

The system shall strip markdown formatting (bold, italic, links, code blocks, etc.) from text while preserving the underlying content for indexing.

**Acceptance:** Text "**bold** and _italic_" indexes as "bold and italic".

---

#### 004-FR-007: Normalize whitespace in extracted text

**Priority:** Medium
**Traces to:** Search quality

The system shall collapse multiple whitespace characters (spaces, tabs, newlines) into single spaces for consistent indexing.

**Acceptance:** Text with multiple line breaks indexes as single-spaced text.

---

#### 004-FR-008: Compute SHA-256 content hash

**Priority:** High
**Traces to:** Change detection

The system shall compute SHA-256 hash of preprocessed content to detect changes and avoid re-indexing unchanged sections.

**Acceptance:** Unchanged file produces identical hash; any content change produces different hash.

---

#### 004-FR-009: Store identical content once with multiple references

**Priority:** Medium
**Traces to:** Storage efficiency

The system shall detect sections with identical content hashes within the same project, store identical content once, and reference it from multiple sections.

**Acceptance:** Duplicate section content stored once; both sections reference same content row.

---

### Indexing Pipeline

#### 004-FR-010: Discover markdown files recursively

**Priority:** Critical
**Traces to:** Core functionality

The system shall recursively discover all `.md` files in the project directory, respecting `.gitignore` patterns and excluding the `.erfana/` directory.

**Acceptance:** All markdown files in project are indexed; .gitignore exclusions honored.

---

#### 004-FR-011: Extract sections by heading structure

**Priority:** Critical
**Traces to:** Granular search

The system shall split markdown files into sections based on heading hierarchy (h1-h6), creating separate index entries for each section with heading text and body content.

**Acceptance:** File with 3 headings creates 3 indexed sections with correct hierarchy.

---

#### 004-FR-012: Perform incremental index updates

**Priority:** High
**Traces to:** Performance

The system shall compare content hashes to identify changed sections and update only those sections, avoiding full re-indexing on each file save.

**Acceptance:** Saving file with one changed section re-indexes only that section, not entire file.

---

#### 004-FR-013: Process files in batches with progress events

**Priority:** High
**Traces to:** User feedback

The system shall process files in configurable batches (default: 50 files) and emit progress events with current/total counts for UI updates.

**Acceptance:** Initial indexing of 200 files shows progress updates at regular intervals.

---

#### 004-FR-014: Subscribe to FileWatcherService events

**Priority:** Critical
**Traces to:** Real-time updates

The system shall subscribe to `file:saved`, `file:created`, `file:deleted`, and `project:changed` events from FileWatcherService to trigger index updates.

**Acceptance:** Saving file triggers index update without manual intervention.

---

#### 004-FR-015: Debounce rapid file changes

**Priority:** Medium
**Traces to:** Performance

The system shall debounce rapid file changes with a 300ms window to coalesce multiple saves into a single index update.

**Acceptance:** Rapid Ctrl+S spam (5 saves in 200ms) triggers only one index update.

---

#### 004-FR-016: Coalesce queued index operations

**Priority:** Medium
**Traces to:** Performance

The system shall maintain an update queue and coalesce duplicate file paths, processing each file only once regardless of event count.

**Acceptance:** 10 events for same file path result in single index operation.

---

### Search API

#### 004-FR-017: Implement BM25 keyword search

**Priority:** Critical
**Traces to:** Core functionality

The system shall implement BM25 ranking algorithm via FTS5 for keyword search, returning relevance-scored results.

**Acceptance:** Search query returns results ordered by BM25 relevance score.

---

#### 004-FR-018: Apply column weights to ranking

**Priority:** High
**Traces to:** Search quality

The system shall weight heading matches higher than body text matches (heading: 3x, text: 1x) in BM25 scoring.

**Acceptance:** Document matching query in heading ranks higher than document matching only in body.

---

#### 004-FR-019: Support folder filter in search

**Priority:** Medium
**Traces to:** User workflow

The system shall support filtering search results by folder path prefix to scope searches to specific directories.

**Acceptance:** Search with folder filter "docs/" returns only results from docs directory.

---

#### 004-FR-020: Support file type filter in search

**Priority:** Low
**Traces to:** Future extensibility

The system shall support filtering search results by file extension for future support of additional file types.

**Acceptance:** Search with file type ".md" returns only markdown file results.

---

#### 004-FR-021: Support date range filter in search

**Priority:** Low
**Traces to:** User workflow

The system shall support filtering search results by file modification date range.

**Acceptance:** Search with date filter returns only files modified within specified range.

---

#### 004-FR-022: Return top-K results with pagination

**Priority:** High
**Traces to:** UI performance

The system shall return configurable top-K results (default: 10) with pagination support for loading additional results.

**Acceptance:** Initial search returns 10 results; "Load more" fetches next 10.

---

#### 004-FR-023: Return matched terms with context for search results

**Priority:** Medium
**Traces to:** User understanding

The system shall return matched terms and their locations for each result, enabling UI to display why each result matched.

**Acceptance:** Result includes list of matched query terms with context snippets.

---

### UI - Related Sidebar

#### 004-FR-024: Display top-10 related sections

**Priority:** High
**Traces to:** Content discovery

The system shall display a sidebar panel showing the top-10 sections most related to the currently selected text or visible content.

**Acceptance:** Selecting text in editor updates sidebar with related sections within 500ms.

---

#### 004-FR-025: Auto-update on file or selection change

**Priority:** High
**Traces to:** User workflow

The system shall automatically update related content when the user changes files, scrolls to different sections, or selects different text.

**Acceptance:** Scrolling to new heading updates related content within 500ms.

---

#### 004-FR-026: Click to open related file

**Priority:** Critical
**Traces to:** Navigation

The system shall open the related file at the specific section when user clicks a related section item in the sidebar.

**Acceptance:** Clicking related section opens file and scrolls to that heading.

---

#### 004-FR-027: Copy citation to clipboard

**Priority:** Medium
**Traces to:** User workflow

The system shall provide a "Copy citation" action that copies a markdown link to the related section in a standardized format.

**Acceptance:** Copy citation creates link like `[Section Title](./path/file.md#section-title)`.

---

#### 004-FR-028: Insert link at cursor

**Priority:** Medium
**Traces to:** User workflow

The system shall provide an "Insert link" action that inserts a markdown link to the related section at the current cursor position in the editor.

**Acceptance:** Insert link adds markdown link at cursor without overwriting selected text.

---

### UI - Global Search

#### 004-FR-029: Provide search query input

**Priority:** Critical
**Traces to:** Core UI

The system shall provide a search input field (triggered by Cmd/Ctrl+Shift+F) for entering project-wide search queries.

**Acceptance:** Cmd+Shift+F opens global search panel with focused input field.

---

#### 004-FR-030: Display search results with context

**Priority:** Critical
**Traces to:** Core UI

The system shall display search results showing file name, section heading, and text snippet with highlighted matched terms.

**Acceptance:** Search results show file path, heading, and context with query terms highlighted.

---

#### 004-FR-031: Display filter controls

**Priority:** Medium
**Traces to:** Advanced search

The system shall display filter controls for folder, file type, and date range to refine search results.

**Acceptance:** Filter dropdown shows folder tree for selection; date picker for range.

---

#### 004-FR-032: Show "Why this result?" on expand

**Priority:** Medium
**Traces to:** User understanding

The system shall show expanded breakdown of why each result matched when user expands a result item.

**Acceptance:** Expanding result shows list of matched terms with context snippets.

---

### UI - Settings Panel

#### 004-FR-033: Provide manual reindex button

**Priority:** High
**Traces to:** Recovery

The system shall provide a "Rebuild Index" button in settings that triggers a full re-index of all project files.

**Acceptance:** Clicking rebuild clears existing index and re-indexes all files with progress.

---

#### 004-FR-034: Display corpus statistics

**Priority:** Medium
**Traces to:** Visibility

The system shall display corpus statistics including total files indexed, total sections, total words, and last indexing time.

**Acceptance:** Settings panel shows "1,234 files, 5,678 sections, 123,456 words, indexed 5 min ago".

---

#### 004-FR-035: Configure excluded folders

**Priority:** Medium
**Traces to:** Configuration

The system shall allow users to configure additional folders to exclude from indexing beyond .gitignore patterns.

**Acceptance:** Adding "drafts/" to excluded folders removes those files from index on next reindex.

---

### UI - Status Indicator

#### 004-FR-036: Display indexing progress

**Priority:** High
**Traces to:** User feedback

The system shall display current indexing progress as "Indexing: X/Y files" in the status bar during index operations.

**Acceptance:** During initial indexing, status bar shows progress counter updating in real-time.

---

#### 004-FR-037: Display status dot with states

**Priority:** Medium
**Traces to:** Visual feedback

The system shall display a status dot indicating indexing state: green (up to date), yellow (indexing in progress), red (error state).

**Acceptance:** Dot is green when idle, yellow during indexing, red on database error.

---

#### 004-FR-038: Show queue and error details on click

**Priority:** Low
**Traces to:** Advanced feedback

The system shall show detailed indexing information when user clicks the status indicator, including queue depth, last error timestamp, and files currently in queue.

**Acceptance:** Clicking status dot shows popover with queue status and recent errors.

---

### MCP Server

#### 004-FR-039: Implement MCPServerService on stdio transport

**Priority:** Critical
**Traces to:** Claude integration

The system shall implement an MCP server using stdio transport that exposes graph engine capabilities to Claude Code.

**Acceptance:** MCP server responds to initialize/shutdown protocol messages.

---

#### 004-FR-040: Register erfana_graph_search tool

**Priority:** Critical
**Traces to:** Claude integration

The system shall register an `erfana_graph_search` tool with parameters: query (string), k (number, optional), filters (object, optional).

**Acceptance:** Tool appears in MCP tools list with correct schema.

---

#### 004-FR-041: Handle search requests via MCP

**Priority:** Critical
**Traces to:** Claude integration

The system shall execute search queries received via MCP and return formatted results with file paths, section headings, and content snippets.

**Acceptance:** MCP query returns JSON array of search results matching API format.

---

#### 004-FR-042: Implement rate limiting

**Priority:** Medium
**Traces to:** Stability

The system shall implement rate limiting of 100 queries per minute per MCP client to prevent runaway queries.

**Acceptance:** 101st query within one minute returns rate limit error response.

---

#### 004-FR-043: Auto-start server on app launch

**Priority:** High
**Traces to:** Usability

The system shall automatically start the MCP server when Erfana launches and a project is opened.

**Acceptance:** Opening project makes MCP server available without manual start.

---

#### 004-FR-044: Auto-stop server on app quit

**Priority:** High
**Traces to:** Cleanup

The system shall gracefully stop the MCP server when Erfana quits, completing pending requests before shutdown.

**Acceptance:** Quitting app with pending MCP request completes request then shuts down server.

---

### Integration

#### 004-FR-045: Subscribe to file:saved events

**Priority:** Critical
**Traces to:** Real-time sync

The system shall subscribe to `file:saved` events from FileWatcherService to trigger re-indexing of modified files.

**Acceptance:** Saving file in editor triggers index update for that file.

---

#### 004-FR-046: Subscribe to file:created events

**Priority:** High
**Traces to:** Real-time sync

The system shall subscribe to `file:created` events to add new files to the index.

**Acceptance:** Creating new markdown file adds it to index within 500ms.

---

#### 004-FR-047: Subscribe to file:deleted events

**Priority:** High
**Traces to:** Real-time sync

The system shall subscribe to `file:deleted` events to remove deleted files from the index.

**Acceptance:** Deleting markdown file removes it from index within 500ms.

---

#### 004-FR-048: Handle project:changed events

**Priority:** Critical
**Traces to:** Project switching

The system shall handle `project:changed` events by closing the current database and opening/creating the database for the new project.

**Acceptance:** Switching projects loads correct index for new project.

---

#### 004-FR-049: Open file prioritization

**Title:** Prioritize open files during indexing

**Priority:** High
**Traces to:** User productivity, immediate search availability

The system shall prioritize indexing of currently open editor files during initial project indexing, ensuring users can search content they are actively working on before full project indexing completes.

**Acceptance Criteria:**
- Open files are indexed within 2 seconds of project open
- Full project indexing continues in background after open files complete

---

#### 004-FR-050: Malformed file handling

**Title:** Gracefully handle malformed markdown files

**Priority:** Medium
**Traces to:** Reliability, user experience

The system shall gracefully handle malformed markdown files by logging the parse error with file path and continuing with remaining files. Malformed files shall not block or crash the indexing process.

**Acceptance Criteria:**
- Parse errors are logged with file path and error message
- Indexing continues with remaining files
- Status indicator shows count of skipped files if any

---

---

## Non-Functional Requirements

### 004-NFR-001: Search latency under 50ms

**Category:** Performance
**Metric:** p95 < 50ms for typical queries

The system shall return search results within 50ms for 95% of queries on a corpus of up to 10,000 indexed sections.

**Measurement:** Instrumented query timing in production logs.

---

### 004-NFR-002: Indexing throughput over 100 files/second

**Category:** Performance
**Metric:** > 100 files/second initial indexing

The system shall index at least 100 files per second during initial project indexing on standard hardware (M1 Mac or equivalent).

**Measurement:** Total files / indexing duration for fresh project.

---

### 004-NFR-003: Incremental update under 500ms

**Category:** Performance
**Metric:** < 500ms from file save to index update complete

The system shall complete incremental index updates within 500ms of file save event.

**Measurement:** Event timestamp to update completion logged.

---

### 004-NFR-004: Prevent SQL injection

**Category:** Security
**Metric:** Zero SQL injection vulnerabilities

The system shall use prepared statements exclusively, preventing SQL injection attacks even with malicious content in indexed files.

**Verification:** Security code review; no string-concatenated queries.

---

### 004-NFR-005: Project content isolation

**Category:** Security
**Metric:** Zero cross-project data leakage

The system shall isolate each project's database completely, with no possibility of cross-project queries or data access.

**Verification:** Separate database files per project; no shared state.

---

### 004-NFR-006: Graceful error handling

**Category:** Reliability
**Metric:** No crashes from database or indexing errors

The system shall handle all database and indexing errors gracefully, logging errors and notifying users without crashing.

**Verification:** Error injection testing; fuzzing with malformed files.

---

### 004-NFR-007: Database corruption recovery

**Category:** Reliability
**Metric:** Automatic recovery from corruption

The system shall detect database corruption on startup and offer automatic recovery via full re-index.

**Verification:** Corrupt database file triggers rebuild prompt.

---

### 004-NFR-008: Worker thread recovery

**Category:** Reliability
**Metric:** Automatic worker restart on failure

The system shall restart failed worker threads (if using worker-based architecture) with exponential backoff.

**Verification:** Kill worker process; observe automatic restart.

---

### 004-NFR-009: Structured logging for observability

**Category:** Observability
**Metric:** All operations logged with context

The system shall use structured logging (JSON format) for all significant operations including indexing, search, and errors.

**Verification:** Log output parseable; contains operation context.

---

### 004-NFR-010: Progress events for UI updates

**Category:** Observability
**Metric:** Real-time progress visibility

The system shall emit progress events during indexing operations, enabling real-time UI progress indicators.

**Verification:** Progress bar updates during indexing.

---

### 004-NFR-011: IPC event tracing

**Category:** Observability
**Metric:** End-to-end request tracing

The system shall include correlation IDs in IPC events to enable end-to-end tracing of operations across main and renderer processes.

**Verification:** Single operation traceable via correlation ID.

---
