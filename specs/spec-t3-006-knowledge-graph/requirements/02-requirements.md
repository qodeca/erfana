# Requirements

## Functional Requirements

### Schema & Data Model

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-001 | Entities table | Create `entities` table with columns: `id` (INTEGER PRIMARY KEY), `name` (TEXT NOT NULL), `type` (TEXT NOT NULL), `canonical_id` (INTEGER REFERENCES entities(id)), `alias_score` (REAL), `created_at` (TEXT NOT NULL). Unique constraint on (name, type) pair for deduplication. Supports entity deduplication through canonical entity references (e.g., 'React' and 'ReactJS' can reference the same canonical entity). | Must | 006-AC-001 |
| 006-FR-002 | Edges table | Create `edges` table with columns: `id` (INTEGER PRIMARY KEY), `src_id` (INTEGER REFERENCES entities), `dst_id` (INTEGER REFERENCES entities), `type` (TEXT NOT NULL), `valid_from` (TEXT), `valid_to` (TEXT), `tx_time` (TEXT NOT NULL). Supports bitemporal tracking. | Must | 006-AC-002 |
| 006-FR-003 | Mentions table | Create `mentions` table with columns: `id` (INTEGER PRIMARY KEY), `section_id` (INTEGER REFERENCES sections), `entity_id` (INTEGER REFERENCES entities), `start_char` (INTEGER NOT NULL), `end_char` (INTEGER NOT NULL), `created_at` (TEXT NOT NULL). Enables position-based highlighting. | Must | 006-AC-003 |
| 006-FR-004 | Entity indexes | Create indexes: `idx_entities_name` on (name), `idx_entities_type` on (type), `idx_mentions_section` on (section_id), `idx_mentions_entity` on (entity_id) for query performance. | Must | 006-AC-004 |

### Entity Extraction

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-005 | Wikilink extraction | Extract entities from wikilink pattern `[[Entity Name]]` using regex. Entity type inferred as "concept" by default. Support pipe syntax `[[actual|display]]` extracting "actual" as entity name. | Must | 006-AC-005 |
| 006-FR-006 | Tag extraction | Extract entities from tag pattern `#tag-name` using regex. Entity type set to "tag". Support alphanumeric characters, hyphens, and underscores. | Must | 006-AC-006 |
| 006-FR-007 | Mention extraction | Extract entities from mention pattern `@username` using regex. Entity type set to "person". Support alphanumeric characters, hyphens, and underscores (pattern: `/[@][a-zA-Z0-9_-]+/`). | Must | 006-AC-007 |
| 006-FR-008 | Technical terms extraction | Extract entities matching a configurable dictionary of technical terms (e.g., SQLite, React, TypeScript, Electron). Entity type set to "technology". Dictionary loaded from configuration file. | Should | 006-AC-008 |
| 006-FR-009 | Extraction pipeline | Process section content through all extractors in sequence, collecting entities with their character positions. Pipeline executes on section index/update. | Must | 006-AC-009 |
| 006-FR-010 | Position tracking | For each extracted entity mention, capture exact `start_char` and `end_char` positions relative to section content for editor highlighting integration. | Must | 006-AC-010 |

### Entity Storage

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-011 | Entity upsert | Ensure entity uniqueness by (name, type) pair. When inserting a duplicate, return the existing entity ID without creating a new record. | Must | 006-AC-011 |
| 006-FR-012 | Mention linking | After entity upsert, create mention record linking entity to section with character positions. Update mentions on section re-index (delete old, insert new). | Must | 006-AC-012 |
| 006-FR-013 | Batch insertion | Support batch entity and mention insertion for performance when indexing multiple sections. Batch insertion must be atomic (all-or-nothing). If any entity in the batch fails validation, the entire batch is rejected. | Should | 006-AC-013 |

### Backlinks API

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-014 | Backlinks query | Provide `getBacklinks(entityName: string, entityType?: string)` API that returns all sections mentioning the entity. Each result includes section path, title, and mention positions. | Must | 006-AC-014 |
| 006-FR-015 | Backlinks sorting | Sort backlinks results by recency (section updated_at descending) by default. Support optional sorting by relevance (mention count per section). | Must | 006-AC-015 |
| 006-FR-016 | Backlinks pagination | Support pagination with `limit` and `offset` parameters for large result sets. Default limit of 50 results. | Should | 006-AC-016 |

### Impact Analysis

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-017 | Forward traversal | Provide `getOutgoingLinks(sectionId: number)` API that returns all entities mentioned in the section with their occurrence counts. | Should | 006-AC-017 |
| 006-FR-018 | Reverse traversal | Provide `getIncomingLinks(entityId: number)` API that returns all sections mentioning the entity (alias for backlinks with entity ID). | Should | 006-AC-018 |
| 006-FR-019 | Graphology integration | Load entity-section graph into graphology library on-demand for centrality metrics (degree, betweenness). Lazy initialization to minimize memory impact. | Could | 006-AC-019 |

### Knowledge Panel UI

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-020 | Knowledge Panel component | Create Knowledge Panel sidebar component with tabbed interface: "Entities" and "Backlinks" tabs. Panel visibility toggleable via toolbar button. | Must | 006-AC-020 |
| 006-FR-021 | Entities tab | Display list of entities extracted from currently active section. Each entity shows name, type badge, and mention count. Click entity to switch to Backlinks tab filtered to that entity. | Must | 006-AC-021 |
| 006-FR-022 | Backlinks tab | Display sections that mention the selected entity. Each backlink shows file path, section title, and preview snippet with highlighted mention. Click backlink to navigate to that section. | Must | 006-AC-022 |
| 006-FR-023 | Entity highlighting | When hovering over an entity in the panel, highlight all occurrences of that entity in the editor using Monaco decorations and character positions from mentions table. | Should | 006-AC-023 |
| 006-FR-024 | Impact analysis button | Provide "Show Impact" button in Knowledge Panel that opens a dialog showing forward links (entities this section defines/uses) and reverse links (sections depending on this section's entities). | Could | 006-AC-024 |

### MCP Integration

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-025 | erfana_graph_entities tool | Implement MCP tool `erfana_graph_entities` with parameters: `query` (optional string filter), `type` (optional entity type filter), `limit` (default 50). Returns entity list with id, name, type, mention_count. | Must | 006-AC-025 |
| 006-FR-026 | erfana_graph_backlinks tool | Implement MCP tool `erfana_graph_backlinks` with parameters: `entity_name` (required), `entity_type` (optional), `limit` (default 20). Returns backlinks with section path, title, snippet. | Must | 006-AC-026 |

### Data Quality

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-FR-027 | Contradiction detection | Detect contradictions where the same source entity has multiple active edges (valid_to IS NULL) of the same type pointing to different destination entities. For example, if "ERFANA" has active "uses" edges to both "sqlite-vss" and "sqlite-vec", this is flagged as a potential contradiction. Query returns all entities with conflicting active relationships including source entity, edge type, and conflicting destinations. | Medium | 006-AC-034 |

## Non-Functional Requirements

### Performance

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-NFR-001 | Extraction latency | Entity extraction for a single section must complete in <50ms for sections up to 10,000 characters. | Must | 006-AC-027 |
| 006-NFR-002 | Backlinks query latency | Backlinks query for any entity must return results in <100ms for databases with up to 100,000 mentions. | Must | 006-AC-028 |
| 006-NFR-003 | Batch indexing throughput | Full workspace re-index (1000 sections) must complete in <30 seconds. | Should | 006-AC-029 |

### Quality

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-NFR-004 | Extraction accuracy | Wikilink, tag, and mention pattern extraction must achieve >95% precision and >98% recall on standard markdown test corpus. | Must | 006-AC-030 |
| 006-NFR-005 | Position accuracy | Character positions (start_char, end_char) must accurately reflect entity boundaries for highlighting. Zero tolerance for off-by-one errors. | Must | 006-AC-031 |

### Scalability

| ID | Title | Description | Priority | Traces To |
|----|-------|-------------|----------|-----------|
| 006-NFR-006 | Entity capacity | System must handle 100,000+ entities without query degradation (backlinks <100ms maintained). | Must | 006-AC-032 |
| 006-NFR-007 | Memory efficiency | Graphology graph loaded lazily and released after 60 seconds of inactivity. Peak memory for graph operations <50MB for 100K entity graph. | Should | 006-AC-033 |
