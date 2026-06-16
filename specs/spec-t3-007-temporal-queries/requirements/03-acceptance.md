# Acceptance criteria

## Test cases

### Schema extensions

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-001 | Verify temporal fields exist | 1. Open SQLite database 2. Inspect edges table schema | Columns valid_from (INTEGER NOT NULL), valid_to (INTEGER), tx_time (INTEGER NOT NULL) exist | 007-FR-001 |
| 007-AC-002 | Verify temporal indexes | 1. Query sqlite_master for indexes 2. Check index definitions | Indexes on edges(valid_from), edges(valid_to), edges(src_entity_id, valid_from) exist | 007-FR-002 |

### Edge lifecycle

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-003 | Create edge sets valid_from | 1. Create new edge via API 2. Query edge record | valid_from equals creation timestamp, valid_to is NULL | 007-FR-003 |
| 007-AC-004 | Close edge sets valid_to | 1. Create edge 2. Wait 1 second 3. Close edge via API 4. Query edge record | valid_to equals closure timestamp, record still exists | 007-FR-004 |
| 007-AC-005 | Edges are never deleted | 1. Create 5 edges 2. Close 3 edges 3. Count total edge records | 5 records exist (none deleted) | 007-FR-005 |

### As-of queries

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-006 | As-of query returns historical state | 1. Create edge at T1 2. Close edge at T2 3. Query as-of T1+0.5 4. Query as-of T2+0.5 | Query at T1+0.5 returns edge; query at T2+0.5 does not | 007-FR-007, 007-FR-008 |
| 007-AC-007 | As-of query is deterministic | 1. Create 10 edges with various valid_from/valid_to 2. Run as-of query with timestamp T 3. Run same query 10 times | All 10 runs return identical results | 007-NFR-003 |
| 007-AC-008 | Default query returns current state | 1. Create edge (active) 2. Query without asOf parameter | Active edge is returned | 007-FR-009 |

### Timeline API

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-009 | Timeline returns events | 1. Create 3 edges 2. Close 1 edge 3. Call getTimeline() | Returns 4 events (3 add, 1 close) in chronological order | 007-FR-010, 007-FR-013 |
| 007-AC-010 | Filter timeline by entity | 1. Create edges for entities A, B, C 2. Call getTimeline({entityId: A}) | Returns only events involving entity A | 007-FR-011 |
| 007-AC-011 | Filter timeline by file | 1. Create edges from files X, Y, Z 2. Call getTimeline({fileId: X}) | Returns only events from file X | 007-FR-012 |

### Contradiction detection

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-012 | Detect contradicting edges | 1. Create edge: Project -> uses -> sqlite-vss at T1 2. Close edge at T2 3. Create edge: Project -> uses -> sqlite-vec at T2 4. Call getContradictions() | Returns contradiction pair for "Project uses" with different targets | 007-FR-014, 007-FR-016 |
| 007-AC-013 | No false positive contradictions | 1. Create edge: Project -> uses -> React 2. Create edge: Project -> uses -> TypeScript 3. Call getContradictions() | No contradictions (different relationship semantics) | 007-FR-014 |

### Timeline UI

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-014 | Date slider renders | 1. Open Timeline panel | Date slider with project range visible | 007-FR-017 |
| 007-AC-015 | Event list displays changes | 1. Create edges 2. Open Timeline panel | Scrollable event list shows edge additions | 007-FR-018 |
| 007-AC-016 | As-of toggle affects queries | 1. Enable as-of toggle 2. Set slider to past date 3. Query graph | Related panel shows historical state | 007-FR-019 |
| 007-AC-017 | Export generates markdown | 1. Select entity in timeline 2. Click export 3. Open generated file | Markdown file contains timeline events | 007-FR-021 |

### MCP integration

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-018 | MCP tool returns timeline | 1. Call erfana_graph_timeline via MCP 2. Check response | Array of timeline events with expected fields | 007-FR-022, 007-FR-024 |
| 007-AC-019 | MCP tool filters by entity | 1. Call erfana_graph_timeline with entityId parameter | Only events for specified entity returned | 007-FR-023 |

### Performance

| ID | Description | Steps | Expected result | Traces to |
|----|-------------|-------|-----------------|-----------|
| 007-AC-020 | Temporal query performance | 1. Seed 10,000 edges 2. Run as-of query 3. Measure duration | Query completes in <200ms | 007-NFR-001 |
| 007-AC-021 | Slider responsiveness | 1. Open Timeline panel 2. Drag date slider rapidly 3. Observe UI updates | No perceptible lag (<100ms) | 007-NFR-004 |

## Definition of done

- [ ] All acceptance criteria pass
- [ ] Temporal fields added to edges schema with indexes
- [ ] Edge lifecycle methods implemented (create, close, no delete)
- [ ] As-of query API functional and deterministic
- [ ] Timeline API returns chronological events with filtering
- [ ] Contradiction detection identifies conflicting edges
- [ ] Timeline UI with slider, event list, as-of toggle, and export
- [ ] MCP erfana_graph_timeline tool operational
- [ ] Performance benchmarks met (<200ms queries, <100ms slider)
- [ ] Unit tests cover all new functionality
- [ ] Integration tests verify end-to-end flows
