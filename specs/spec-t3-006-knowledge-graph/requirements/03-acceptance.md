# Acceptance Criteria

## Schema & Data Model

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-001 | 006-FR-001 | Entities table exists with correct schema | 1. Open SQLite database<br>2. Query `.schema entities` | Table exists with columns: id, name, type, canonical_id, alias_score, created_at; unique constraint on (name, type) |
| 006-AC-002 | 006-FR-002 | Edges table exists with correct schema | 1. Open SQLite database<br>2. Query `.schema edges` | Table exists with columns: id, src_id, dst_id, type, valid_from, valid_to, tx_time; foreign keys to entities |
| 006-AC-003 | 006-FR-003 | Mentions table exists with correct schema | 1. Open SQLite database<br>2. Query `.schema mentions` | Table exists with columns: id, section_id, entity_id, start_char, end_char, created_at; foreign keys valid |
| 006-AC-004 | 006-FR-004 | Performance indexes created | 1. Query `.indexes`<br>2. Check index presence | Indexes idx_entities_name, idx_entities_type, idx_mentions_section, idx_mentions_entity all exist |

## Entity Extraction

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-005 | 006-FR-005 | Wikilinks extracted correctly | 1. Index section with `[[React]] and [[Vue.js]]`<br>2. Query entities | Two entities: "React" (concept), "Vue.js" (concept) with correct positions |
| 006-AC-006 | 006-FR-006 | Tags extracted correctly | 1. Index section with `#feature-request #bug`<br>2. Query entities | Two entities: "feature-request" (tag), "bug" (tag) with correct positions |
| 006-AC-007 | 006-FR-007 | Mentions extracted correctly | 1. Index section with `@alice and @bob-smith`<br>2. Query entities | Two entities: "alice" (person), "bob-smith" (person) with correct positions |
| 006-AC-008 | 006-FR-008 | Technical terms extracted | 1. Configure dictionary with ["SQLite", "TypeScript"]<br>2. Index section with "Using SQLite for storage"<br>3. Query entities | "SQLite" (technology) entity created |
| 006-AC-009 | 006-FR-009 | Pipeline processes all patterns | 1. Index section with `[[API]] #docs @dev uses TypeScript`<br>2. Query entities and mentions | Four entities created; four mentions linked to section |
| 006-AC-010 | 006-FR-010 | Character positions accurate | 1. Index `Hello [[World]]!` (15 chars total)<br>2. Query mentions for World entity | Mention has start_char=6, end_char=15 (including brackets: positions span from first `[` to after last `]`). For wikilinks, positions include the bracket syntax so `[[World]]` at index 6 means start_char=6 and end_char=15. |

## Entity Storage

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-011 | 006-FR-011 | Entity upsert deduplicates | 1. Insert entity "React" type "concept"<br>2. Insert same entity again<br>3. Query entities | Single entity exists; second insert returned existing ID |
| 006-AC-012 | 006-FR-012 | Mentions updated on re-index | 1. Index section with `[[A]]`<br>2. Modify section to `[[B]]`<br>3. Re-index<br>4. Query mentions | Old mention for A removed; new mention for B exists |
| 006-AC-013 | 006-FR-013 | Batch insertion atomic | 1. Start batch insert of 100 entities<br>2. Simulate failure mid-batch<br>3. Check database state | Either all 100 inserted or none (transaction rollback) |

## Backlinks API

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-014 | 006-FR-014 | Backlinks returns all mentions | 1. Create 3 sections mentioning "React"<br>2. Call getBacklinks("React") | Returns 3 results with section paths, titles, positions |
| 006-AC-015 | 006-FR-015 | Backlinks sorted by recency | 1. Create sections mentioning "API" at different times<br>2. Call getBacklinks("API") | Results ordered by section updated_at descending |
| 006-AC-016 | 006-FR-016 | Backlinks pagination works | 1. Create 100 sections mentioning "docs"<br>2. Call getBacklinks("docs", limit=20, offset=0)<br>3. Call with offset=20 | First call returns 20; second call returns next 20; no duplicates |

## Impact Analysis

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-017 | 006-FR-017 | Forward traversal lists entities | 1. Create section with 5 entity mentions<br>2. Call getOutgoingLinks(sectionId) | Returns 5 entities with occurrence counts |
| 006-AC-018 | 006-FR-018 | Reverse traversal lists sections | 1. Create entity mentioned in 3 sections<br>2. Call getIncomingLinks(entityId) | Returns 3 sections |
| 006-AC-019 | 006-FR-019 | Graphology loads on-demand | 1. Request centrality metrics<br>2. Check memory usage<br>3. Wait 60+ seconds<br>4. Check memory | Graph loaded; memory increases; graph released after timeout |

## Knowledge Panel UI

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-020 | 006-FR-020 | Panel toggles visibility | 1. Click Knowledge Panel toolbar button<br>2. Verify panel opens<br>3. Click again | Panel shows with tabs; clicking again hides panel |
| 006-AC-021 | 006-FR-021 | Entities tab shows section entities | 1. Open file with `[[React]] #feature @alice`<br>2. Open Knowledge Panel Entities tab | Shows 3 entities with type badges; click switches to Backlinks |
| 006-AC-022 | 006-FR-022 | Backlinks tab shows related sections | 1. Click entity in Entities tab<br>2. View Backlinks tab | Lists sections mentioning entity; shows path, title, snippet |
| 006-AC-023 | 006-FR-023 | Hover highlights in editor | 1. Hover over entity in panel<br>2. Observe editor | All occurrences of entity highlighted in editor |
| 006-AC-024 | 006-FR-024 | Impact dialog shows dependencies | 1. Click "Show Impact" button<br>2. View dialog | Dialog shows forward links (what this section uses) and reverse links (what uses this section) |

## MCP Integration

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-025 | 006-FR-025 | erfana_graph_entities tool works | 1. Call tool with query="React"<br>2. Call with type="tag"<br>3. Call with limit=5 | Returns filtered entity list with id, name, type, mention_count |
| 006-AC-026 | 006-FR-026 | erfana_graph_backlinks tool works | 1. Call tool with entity_name="React"<br>2. Verify response format | Returns backlinks array with section_path, title, snippet for each |

## Performance

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-027 | 006-NFR-001 | Extraction under 50ms | 1. Create 10KB section with mixed entities<br>2. Measure extraction time | Extraction completes in <50ms |
| 006-AC-028 | 006-NFR-002 | Backlinks under 100ms | 1. Populate database with 100K mentions<br>2. Query backlinks for popular entity | Query returns in <100ms |
| 006-AC-029 | 006-NFR-003 | Batch re-index under 30s | 1. Create workspace with 1000 sections<br>2. Trigger full re-index<br>3. Measure time | Re-index completes in <30 seconds |

## Quality

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-030 | 006-NFR-004 | >95% extraction precision | 1. Run extraction on test corpus with known entities<br>2. Calculate precision/recall | Precision >95%, Recall >98% |
| 006-AC-031 | 006-NFR-005 | Position accuracy verified | 1. Extract entities from test content<br>2. Use positions to substring original content | Substrings exactly match entity names (no off-by-one) |

## Scalability

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-032 | 006-NFR-006 | 100K entities handled | 1. Insert 100K entities with 500K mentions<br>2. Run backlinks query | Query returns in <100ms; no OOM errors |
| 006-AC-033 | 006-NFR-007 | Memory stays bounded | 1. Load graphology with 100K nodes<br>2. Measure peak memory<br>3. Verify release after timeout | Peak <50MB; memory released after 60s inactivity |

## Data Quality

| ID | Requirement | Acceptance Criteria | Steps | Expected Result |
|----|-------------|---------------------|-------|-----------------|
| 006-AC-034 | 006-FR-027 | Contradiction detection | 1. Create entity "ERFANA"<br>2. Create active edge: ERFANA --uses--> sqlite-vss (valid_to=NULL)<br>3. Create active edge: ERFANA --uses--> sqlite-vec (valid_to=NULL)<br>4. Query for contradictions | Returns ERFANA with "uses" type showing both destinations as conflicting relationships |

## Definition of Done

- [ ] All schema tables created with correct constraints and indexes
- [ ] Entity extraction passes >95% precision on test corpus
- [ ] Character positions accurately enable editor highlighting
- [ ] Backlinks API returns results in <100ms for 100K mentions
- [ ] Knowledge Panel UI renders entities and backlinks
- [ ] MCP tools registered and callable from Claude Code
- [ ] Unit tests cover all extractors and storage functions
- [ ] Integration tests verify end-to-end entity-to-backlink flow
- [ ] Documentation updated with API reference
