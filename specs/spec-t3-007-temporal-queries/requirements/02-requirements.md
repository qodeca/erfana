# Requirements

## Functional requirements

### Schema extensions

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-001 | Temporal fields on edges | The system shall extend the edges table to include temporal fields: valid_from (Unix timestamp when the fact became true in the source content), valid_to (Unix timestamp when it stopped being true, nullable if still valid), recorded_at (audit-only Unix timestamp of the database write), and valid_source ('git' or 'fs', provenance of the validity timestamp). Transaction-time travel ("what did the database believe on date X") is out of scope; recorded_at exists for audit logging only. Column types are INTEGER Unix-seconds per Spec #006 FR-002 (valid_source TEXT). | Must | Spec #006 |
| 007-FR-002 | Temporal indexes | The system shall create indexes on edges(valid_from), edges(valid_to), and edges(src_id, valid_from) to optimize temporal queries | Must | 007-FR-001 |

### Edge lifecycle management

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-003 | Create edge with validity | When creating an edge, valid_from shall be derived from the source file's git history – the committer timestamp of the last commit touching the file at index time (obtainable via the existing git services; e.g. `git log -1 --format=%ct -- <file>`), with valid_source='git'. For untracked/uncommitted files, fall back to file mtime with valid_source='fs'. valid_to is left NULL. The indexer's own clock is never used as valid time. | Must | 007-FR-001 |
| 007-FR-004 | Close edge (soft delete) | The system shall close an edge by setting valid_to instead of deleting the record; valid_to is derived with the same git-first provenance rules as valid_from (007-FR-003) | Must | 007-FR-001 |
| 007-FR-005 | Audit trail preservation | The system shall never physically delete edges from the database; invalidation uses valid_to closure | Must | 007-FR-004 |
| 007-FR-006 | Audit timestamp | The system shall record recorded_at as the database write timestamp for all edge mutations, for audit/debug purposes only; it shall not participate in as-of query predicates | Must | 007-FR-001 |

### As-of query API

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-007 | As-of query predicate | The system shall filter as-of queries to return edges that were valid at the specified timestamp (started before or at the timestamp and not yet closed or closed after the timestamp) | Must | 007-FR-001 |
| 007-FR-008 | Historical state reconstruction | The system shall provide an API to query edges that were valid at a specified timestamp. The API shall accept a Unix timestamp and optional filters (entity, edge type), returning all matching edges. | Must | 007-FR-007 |
| 007-FR-009 | Default to current time | The system shall default to current Unix timestamp when asOf parameter is omitted (equivalent to querying current state) | Should | 007-FR-008 |

### Timeline API

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-010 | Timeline event retrieval | The system shall provide an API to retrieve a chronological list of edge additions and closures based on configurable options | Must | 007-FR-001 |
| 007-FR-011 | Filter by entity | The system shall support filtering timeline by entity_id to show all changes involving a specific entity | Must | 007-FR-010 |
| 007-FR-012 | Filter by file | The system shall support filtering timeline by file_id to show all changes originating from a specific file | Must | 007-FR-010 |
| 007-FR-013 | Timeline event structure | The system shall include in each timeline event: timestamp, event_type ('add' or 'close'), edge_id, src_entity, dst_entity, relationship_type, file_path | Must | 007-FR-010 |

### Contradiction detection

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-014 | Contradiction identification | The system shall detect contradicting statements only among relation types declared exclusive (Spec #006 FR-030): same src entity, same exclusive type, different dst entities (e.g., "licensed-under GPL-3.0" vs "licensed-under MIT"). This is a heuristic; flagged pairs go to user review (007-FR-015), never auto-resolution. | Should | 007-FR-001 |
| 007-FR-015 | Contradiction flagging | The system shall flag potential contradictions for user review rather than auto-resolving; user decides if contradiction is intentional evolution | Should | 007-FR-014 |
| 007-FR-016 | Contradiction API | The system shall provide an API to retrieve detected contradictions, optionally filtered by entity ID. Results include the source entity, edge type, and conflicting destination entities. | Should | 007-FR-014 |

### Timeline UI

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-017 | Date slider component | The system shall provide a date slider in the timeline panel ranging from project start date to current date. The slider shall snap to actual event timestamps (event-anchored navigation) rather than continuous calendar positions; manual date entry remains the precise-query path. | Must | 007-FR-010 |
| 007-FR-018 | Event list display | The system shall display a scrollable list of change events in the timeline panel, sorted chronologically with newest first | Must | 007-FR-010 |
| 007-FR-019 | As-of toggle | The system shall provide a toggle button that enables "as-of mode" where all graph queries use the slider's selected date | Should | 007-FR-008 |
| 007-FR-020 | Visual date indicator | The system shall prominently display the selected date in human-readable format (e.g., "December 22, 2025") | Must | 007-FR-017 |
| 007-FR-021 | Timeline export | The system shall provide an export button that generates a markdown file with timeline events for the selected entity or file. Export generates markdown file in project root with naming pattern `timeline-{entity-name}-{YYYY-MM-DD}.md`. | Should | 007-FR-010 |

### MCP integration

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-022 | Timeline MCP tool | The system shall expose `erfana_graph_timeline` tool via MCP server for Claude Code integration | Must | 007-FR-010 |
| 007-FR-023 | MCP tool parameters | The system shall accept the following tool parameters: entityId (optional), fileId (optional), asOf (optional Unix timestamp), limit (optional, default 50) | Must | 007-FR-022 |
| 007-FR-024 | MCP tool response | The system shall return an array of timeline events with valid_from, valid_to, src_entity, dst_entity, relationship_type, file_path | Must | 007-FR-022 |

### Provenance and consistency

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-025 | Git as source of truth | Git history is the authoritative timeline for document evolution; the temporal store is a queryable projection of it. On full reindex, valid_from/valid_to shall be re-derivable from git history, and re-derivation shall be deterministic (supports 007-NFR-003). | Must | 007-FR-003 |
| 007-FR-026 | Idempotent re-extraction | Re-indexing a section shall be a no-op for derived edges that are unchanged (same src, dst, type, source file): no close-and-recreate, no new timeline event, no new rows. Only genuine changes produce edge mutations. Complements 007-FR-005 (never-delete). | Must | 007-FR-005 |

## Non-functional requirements

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-NFR-001 | Temporal query performance | The system shall complete as-of queries and timeline queries in <200ms for graphs with up to 10,000 edges | Must | 007-FR-002 |
| 007-NFR-002 | Audit trail retention | The system shall retain closed edges indefinitely. Note: Configurable retention policy is deferred to future versions. | Should | 007-FR-005 |
| 007-NFR-003 | Query determinism | The system shall ensure as-of queries are deterministic and reproducible given the same asOf timestamp | Must | 007-FR-007 |
| 007-NFR-004 | Slider responsiveness | The system shall ensure date slider updates feel instantaneous (<100ms) for smooth time-travel experience | Should | 007-FR-017 |
