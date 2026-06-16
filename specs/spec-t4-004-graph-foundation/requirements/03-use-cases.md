# Use Cases

## 004-UC-001: Auto-index project on open

**Actors:** User, System
**Priority:** Critical
**Traces to:** 004-FR-010, 004-FR-011, 004-FR-013, 004-FR-014

### Preconditions
- User has opened a project directory in Erfana
- Project contains markdown files

### Main Flow
1. System detects `project:changed` event with new project path
2. System checks for existing database at `.erfana/graph.db`
3. If database exists, system opens it and runs integrity check
4. If no database, system creates new database with FTS5 schema
5. System recursively discovers all `.md` files, respecting `.gitignore`
6. System processes files in batches of 50, emitting progress events
7. For each file, system extracts sections by heading structure
8. System indexes each section with preprocessed text and content hash
9. System emits completion event when all files indexed
10. UI updates status indicator to green "up to date"

### Alternative Flows
- **A1 (Corrupted database):** At step 3, integrity check fails. System prompts user with "Index corrupted. Rebuild?" dialog. On confirm, system deletes database and proceeds from step 4.
- **A2 (No markdown files):** At step 5, no files discovered. System creates empty database and shows "No content to index" message.
- **A3 (Large project):** At step 6, more than 1000 files. System shows estimated time and allows background indexing.

### Postconditions
- All markdown sections are indexed and searchable
- Status indicator shows green dot
- Related sidebar is functional

---

## 004-UC-002: Re-index changed file on save

**Actors:** User, System
**Priority:** Critical
**Traces to:** 004-FR-012, 004-FR-014, 004-FR-015, 004-FR-045

### Preconditions
- Project is open with existing index
- User is editing a markdown file

### Main Flow
1. User saves file (Cmd+S or auto-save)
2. FileWatcherService emits `file:saved` event
3. GraphEngineService receives event and adds file to update queue
4. System debounces with 300ms window, coalescing rapid saves
5. System reads file content and extracts sections
6. For each section, system computes content hash
7. System compares hashes with stored values
8. System re-indexes only changed sections (INSERT or UPDATE)
9. System removes sections that no longer exist in file
10. System emits index update completion event
11. Related sidebar refreshes if affected file is related

### Alternative Flows
- **A1 (File deleted during save):** At step 5, file not found. System removes file from index.
- **A2 (No changes detected):** At step 7, all hashes match. System skips re-indexing.
- **A3 (Concurrent saves):** Multiple saves queued. System processes each once per debounce window.

### Postconditions
- Index reflects current file content
- Changed sections searchable with updated content
- Removed sections no longer appear in search

---

## 004-UC-003: View related content in sidebar

**Actors:** User, System
**Priority:** High
**Traces to:** 004-FR-024, 004-FR-025, 004-FR-026

### Preconditions
- Project is indexed
- User has a markdown file open in editor
- Related sidebar panel is visible

### Main Flow
1. User scrolls to a section or selects text in editor
2. System detects content change (scroll or selection event)
3. System extracts context text (selected text or visible heading)
4. System executes relevance search with ranking using context as query
5. System excludes current file/section from results
6. System ranks results by relevance score
7. System displays top-10 results in sidebar
8. Each result shows file name, section heading, and relevance score

### Alternative Flows
- **A1 (No related content):** At step 6, no results found. System shows "No related content found" message.
- **A2 (User clicks result):** User clicks a related section. System opens that file at the specific heading position.
- **A3 (User copies citation):** User clicks copy icon. System copies markdown link to clipboard.

### Postconditions
- Sidebar shows relevant related content
- User can navigate to related files

---

## 004-UC-004: Search project content globally

**Actors:** User, System
**Priority:** Critical
**Traces to:** 004-FR-017, 004-FR-022, 004-FR-029, 004-FR-030

### Preconditions
- Project is indexed
- User is working in Erfana

### Main Flow
1. User presses Cmd+Shift+F to open Global Search
2. System displays search panel with focused input field
3. User types search query
4. System debounces input with 150ms delay
5. System executes relevance search with ranking using query
6. System applies any active filters (folder, file type, date)
7. System returns top-10 results ranked by relevance
8. System displays results with file path, heading, and context snippet
9. System highlights matched terms in snippets
10. User clicks result to navigate to that location

### Alternative Flows
- **A1 (No results):** At step 7, no matches found. System shows "No results for 'query'" with suggestions.
- **A2 (Load more):** User clicks "Load more". System fetches next 10 results and appends to list.
- **A3 (Apply filter):** User selects folder filter. System re-executes search with filter applied.
- **A4 (Expand result):** User expands result. System shows "Why this result?" breakdown with matched terms.

### Postconditions
- User finds relevant content across project
- User can navigate to specific locations

---

## 004-UC-005: Trigger manual reindex

**Actors:** User, System
**Priority:** Medium
**Traces to:** 004-FR-033, 004-FR-034

### Preconditions
- Project is open
- User suspects index may be stale or corrupted

### Main Flow
1. User opens Settings panel
2. User navigates to Graph Engine section
3. User clicks "Rebuild Index" button
4. System prompts for confirmation: "This will delete and rebuild the entire index. Continue?"
5. User confirms
6. System closes current database connection
7. System deletes existing `graph.db` file
8. System creates fresh database with FTS5 schema
9. System re-indexes all markdown files (same as UC-001)
10. System updates corpus statistics in settings panel
11. System shows completion message with stats

### Alternative Flows
- **A1 (Cancel):** User cancels at step 5. No changes made.
- **A2 (Error during reindex):** At step 9, error occurs. System shows error message and partial stats.

### Postconditions
- Index rebuilt from scratch
- Corpus statistics updated
- All content searchable

---

## 004-UC-006: Check indexing status

**Actors:** User, System
**Priority:** Low
**Traces to:** 004-FR-036, 004-FR-037, 004-FR-038

### Preconditions
- Project is open
- Indexing operation is in progress or recently completed

### Main Flow
1. User observes status indicator in status bar
2. Status dot shows current state (green/yellow/red)
3. During indexing, progress text shows "Indexing: 45/200 files"
4. User clicks status indicator for details
5. System shows popover with:
   - Current queue depth
   - Last indexing operation time
   - Any recent errors
   - Estimated time remaining (if indexing)
6. User closes popover

### Alternative Flows
- **A1 (Error state):** Dot is red. Popover shows error message and "Retry" button.
- **A2 (Idle state):** Dot is green. Popover shows "Index up to date" with last update time.

### Postconditions
- User understands current indexing state
- User can diagnose indexing issues

---

## 004-UC-007: Claude Code queries graph via MCP

**Actors:** Claude Code, System
**Priority:** Critical
**Traces to:** 004-FR-039, 004-FR-040, 004-FR-041, 004-FR-042

### Preconditions
- Project is open with indexed content
- MCP server is running (auto-started)
- Claude Code is connected to Erfana MCP server

### Main Flow
1. Claude Code sends tool invocation for `erfana_graph_search`
2. Request includes: query (required), k (optional, default 10), filters (optional)
3. System validates request parameters against schema
4. System checks rate limit (100 queries/minute)
5. System executes BM25 search with provided parameters
6. System formats results as JSON array with:
   - file_path (relative to project root)
   - section_heading
   - content_snippet (first 200 chars)
   - relevance_score
7. System returns results via MCP response
8. Claude Code receives and processes results

### Alternative Flows
- **A1 (Rate limited):** At step 4, rate limit exceeded. System returns error response with retry-after hint.
- **A2 (Invalid query):** At step 3, validation fails. System returns error with parameter details.
- **A3 (No results):** At step 5, no matches. System returns empty array.
- **A4 (Server busy):** System queues request and processes when available.

### Postconditions
- Claude Code receives search results
- Rate limit counter incremented

---

## 004-UC-008: Handle external file changes

**Actors:** External Application, System
**Priority:** High
**Traces to:** 004-FR-046, 004-FR-047

### Preconditions
- Project is open with existing index
- User or external process modifies files outside Erfana

### Main Flow
1. External application (VS Code, git, script) modifies markdown file
2. FileWatcherService detects file system change
3. FileWatcherService emits appropriate event (`file:created`, `file:saved`, `file:deleted`)
4. GraphEngineService receives event
5. System adds file path to update queue
6. System debounces with 300ms window
7. System processes update according to event type:
   - Created: Index new file
   - Saved: Re-index changed sections
   - Deleted: Remove from index
8. System emits completion event
9. UI updates if affected content is visible

### Alternative Flows
- **A1 (Bulk changes):** Many files changed at once (git checkout). System queues all and processes in batches.
- **A2 (Non-markdown file):** Changed file is not `.md`. System ignores event.
- **A3 (Ignored path):** File is in `.gitignore` or excluded folder. System ignores event.

### Postconditions
- Index reflects external changes
- Search results include/exclude affected content
