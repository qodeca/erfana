# Requirements

## Functional Requirements

### Mermaid Graph Visualization

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-001 | Entity neighborhood query | Query the knowledge graph for all entities within N hops of a given entity, returning nodes and edges for visualization. See FR-003 for configurable hop range (1-5, default 2). | Must |
| 008-FR-002 | Mermaid diagram generation | Generate valid Mermaid diagram syntax (flowchart) from entity neighborhood query results | Must |
| 008-FR-003 | Configurable hop depth | Allow user to configure neighborhood depth (1-5 hops, default: 2) via UI control | Should |
| 008-FR-004 | Insert diagram at cursor | Insert generated Mermaid diagram into editor at current cursor position within a code fence | Must |
| 008-FR-005 | Refresh existing diagram | Detect and refresh existing Mermaid diagrams based on current graph state when entity relationships change | Could |

### Reindex/Reembed UX

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-006 | Background reindex job | Execute full project reindex as background job without blocking UI thread | Must |
| 008-FR-007 | Progress tracking | Track and report reindex progress: current file number, total files, percentage complete, ETA | Must |
| 008-FR-008 | Progress UI component | Display reindex progress in dedicated UI component with progress bar, file count, and ETA | Must |
| 008-FR-009 | Cancel reindex | Allow user to cancel in-progress reindex operation via Cancel button | Must |
| 008-FR-010 | Safe abort | Preserve partial progress on cancel or error; allow resume from last checkpoint | Should |
| 008-FR-011 | Reembed trigger | Trigger re-embedding of all sections using current embedding model | Must |

### Model Migration

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-012 | Switch embedding model | Allow user to switch embedding model via Settings UI (select from available models) | Must |
| 008-FR-013 | Store embedder ID | Store active embedding model identifier to track which model generated embeddings | Must |
| 008-FR-014 | Background re-embedding | Execute re-embedding of all sections in background after model switch | Must |
| 008-FR-015 | Dual-write strategy | During migration, write embeddings for both old and new models to enable rollback | Must |
| 008-FR-016 | Filter by embedder | Search shall only return results from the currently active embedding model | Must |
| 008-FR-017 | Rollback migration | Allow rollback to previous embedding model within configurable window if migration fails | Must |
| 008-FR-018 | Migration progress UI | Display migration progress with completion percentage and estimated time remaining | Must |

### Binary Quantization

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-019 | Enable/disable quantization | Allow user to enable or disable binary quantization via Settings toggle | Should |
| 008-FR-020 | Vector compression | Compress 384-dimensional float32 vectors to binary representation (32x compression) | Should |
| 008-FR-021 | Quantization migration | Re-embed all sections with quantization when enabled on existing corpus | Should |

### Monitoring & Health Checks

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-022 | Database health check | Check database integrity (PRAGMA integrity_check), WAL size, and page count | Must |
| 008-FR-023 | Worker health check | Report active worker count, queue depth, and crash count | Must |
| 008-FR-024 | Disk space check | Monitor index size on disk, available space, and warn when below threshold | Must |
| 008-FR-025 | Health API endpoint | Expose health check results via IPC API endpoint for programmatic access | Should |
| 008-FR-026 | Diagnostics UI tab | Display health metrics in Settings panel diagnostics tab with refresh button | Must |

### Worker & System Reliability

| ID | Title | Description | Priority |
|----|-------|-------------|----------|
| 008-FR-027 | Worker crash recovery | Automatically recover from worker crashes. The system shall automatically restart crashed embedding workers and retry failed operations. When a worker crashes: the worker pool manager detects the crash within 1 second, a replacement worker is spawned automatically, failed embedding operations are re-queued for retry, maximum 3 retry attempts before marking operation as failed, failed operations are logged with error details. | Must |
| 008-FR-028 | Auto-quantization recommendation | Recommend binary quantization for large datasets. The system shall automatically recommend enabling binary quantization when the document corpus exceeds 100,000 documents. A non-intrusive notification shall inform the user of potential memory savings. | Should |
| 008-FR-029 | Pre-migration database backup | Backup database before schema migrations. The system shall create an automatic database backup before performing schema migrations or embedding model switches. Backup shall be stored in the project's `.erfana/backups/` directory with timestamp naming. | Must |
| 008-FR-030 | Vector search health check | Verify sqlite-vec extension health. The health check system shall verify that the sqlite-vec extension is properly loaded and operational by executing a test vector query. | Should |

## Non-Functional Requirements

### Performance

| ID | Title | Description | Target |
|----|-------|-------------|--------|
| 008-NFR-001 | Quantization memory savings | Binary quantization must reduce vector storage memory usage | >30x reduction |
| 008-NFR-002 | Progress update frequency | Reindex progress must update at regular intervals | Every 1 second |
| 008-NFR-003 | Neighborhood query latency | Entity neighborhood query (2 hops) must complete quickly | <200ms |

### Reliability

| ID | Title | Description | Target |
|----|-------|-------------|--------|
| 008-NFR-004 | Migration safety | Model migration must not lose data; dual-write ensures recovery | Zero data loss |
| 008-NFR-005 | Rollback latency | Rollback to previous embedding model must complete quickly | <30 seconds |
| 008-NFR-006 | Cancellation responsiveness | Reindex cancel request must stop processing promptly | <2 seconds |

### Observability

| ID | Title | Description | Target |
|----|-------|-------------|--------|
| 008-NFR-007 | Health metrics format | Health check results must be exportable in standard format | JSON format |
| 008-NFR-008 | Metric completeness | Health API must report all monitored subsystems in single call | DB, workers, disk |

## Traceability Matrix

| Requirement | Dependencies | Traces To |
|-------------|--------------|-----------|
| 008-FR-001 | Spec #006 (entities table) | 008-AC-001 |
| 008-FR-002 | 008-FR-001 | 008-AC-001 |
| 008-FR-003 | 008-FR-001 | 008-AC-002 |
| 008-FR-004 | 008-FR-002 | 008-AC-001 |
| 008-FR-005 | 008-FR-001 | 008-AC-013 |
| 008-FR-006 | Spec #004 (indexing) | 008-AC-003 |
| 008-FR-007 | 008-FR-006 | 008-AC-004 |
| 008-FR-009 | 008-FR-006 | 008-AC-005 |
| 008-FR-011 | 008-FR-006 | 008-AC-014 |
| 008-FR-012 | Spec #005 (embeddings) | 008-AC-006 |
| 008-FR-015 | 008-FR-012 | 008-AC-007 |
| 008-FR-016 | 008-FR-013 | 008-AC-015 |
| 008-FR-017 | 008-FR-015 | 008-AC-008 |
| 008-FR-018 | 008-FR-014 | 008-AC-016 |
| 008-FR-019 | Spec #005 (vectors) | 008-AC-009 |
| 008-FR-022 | Spec #004 (database) | 008-AC-010 |
| 008-FR-026 | 008-FR-022, 008-FR-023, 008-FR-024 | 008-AC-011 |
| 008-FR-027 | 008-FR-023 | 008-AC-017 |
| 008-FR-028 | 008-FR-019 | Production guidance |
| 008-FR-029 | 008-FR-012 | Data safety |
| 008-FR-030 | 008-FR-022 | 008-AC-018 |
