# Requirements

## Functional requirements

### Schema extensions

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-001 | Temporal fields on edges | The system shall extend the edges table to include temporal fields: valid_from (Unix timestamp when edge became valid), valid_to (Unix timestamp when edge was invalidated, nullable if still valid), tx_time (Unix timestamp when change was recorded in database). Data type specifications are deferred to design documentation. | Must | Spec #006 |
| 007-FR-002 | Temporal indexes | The system shall create indexes on edges(valid_from), edges(valid_to), and edges(src_entity_id, valid_from) to optimize temporal queries | Must | 007-FR-001 |

### Edge lifecycle management

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-003 | Create edge with validity | The system shall set valid_from to current Unix timestamp and leave valid_to as NULL when creating an edge | Must | 007-FR-001 |
| 007-FR-004 | Close edge (soft delete) | The system shall close an edge by setting valid_to to current Unix timestamp instead of deleting the record | Must | 007-FR-001 |
| 007-FR-005 | Audit trail preservation | The system shall never physically delete edges from the database; invalidation uses valid_to closure | Must | 007-FR-004 |
| 007-FR-006 | Transaction time recording | The system shall record tx_time as the database transaction timestamp for all edge mutations for audit purposes | Must | 007-FR-001 |

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
| 007-FR-014 | Contradiction identification | The system shall detect contradicting statements where same src_entity has edges of same type to different dst_entities at different times (e.g., "uses sqlite-vss" vs "uses sqlite-vec") | Should | 007-FR-001 |
| 007-FR-015 | Contradiction flagging | The system shall flag potential contradictions for user review rather than auto-resolving; user decides if contradiction is intentional evolution | Should | 007-FR-014 |
| 007-FR-016 | Contradiction API | The system shall provide an API to retrieve detected contradictions, optionally filtered by entity ID. Results include the source entity, edge type, and conflicting destination entities. | Should | 007-FR-014 |

### Timeline UI

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-FR-017 | Date slider component | The system shall provide a date slider in the timeline panel ranging from project start date to current date. In addition to the slider, users may manually enter a specific date for precise temporal queries. | Must | 007-FR-010 |
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

## Non-functional requirements

| ID | Title | Description | Priority | Traces to |
|----|-------|-------------|----------|-----------|
| 007-NFR-001 | Temporal query performance | The system shall complete as-of queries and timeline queries in <200ms for graphs with up to 10,000 edges | Must | 007-FR-002 |
| 007-NFR-002 | Audit trail retention | The system shall retain closed edges indefinitely. Note: Configurable retention policy is deferred to future versions. | Should | 007-FR-005 |
| 007-NFR-003 | Query determinism | The system shall ensure as-of queries are deterministic and reproducible given the same asOf timestamp | Must | 007-FR-007 |
| 007-NFR-004 | Slider responsiveness | The system shall ensure date slider updates feel instantaneous (<100ms) for smooth time-travel experience | Should | 007-FR-017 |
