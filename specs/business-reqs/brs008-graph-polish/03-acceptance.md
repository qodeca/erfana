# Acceptance Criteria

## Test Cases

### Mermaid Visualization

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 008-AC-001 | Generate entity neighborhood diagram | 1. Select an entity in Knowledge Panel<br>2. Click "Generate Diagram" button<br>3. Observe editor insertion | Valid Mermaid flowchart inserted at cursor position showing entity and connected entities within 2 hops | 008-FR-001, 008-FR-002, 008-FR-004 |
| 008-AC-002 | Configure hop depth | 1. Open diagram generation dialog<br>2. Change hop depth from 2 to 3<br>3. Generate diagram | Diagram includes entities up to 3 hops away from source entity | 008-FR-003 |
| 008-AC-013 | Diagram refresh | 1. Generate Mermaid diagram for entity "SQLite"<br>2. Add new relationship to "SQLite" entity<br>3. Click refresh button on existing diagram | Diagram updates to show new relationship | 008-FR-005 |

### Reindex/Reembed

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 008-AC-003 | Background reindex | 1. Open Settings > Maintenance<br>2. Click "Reindex Project"<br>3. Continue editing during reindex | UI remains responsive during reindex; editing works normally | 008-FR-006 |
| 008-AC-004 | Progress tracking | 1. Start reindex on project with 100+ files<br>2. Observe progress UI | Progress shows "X/Y files", percentage updates every 1 second, ETA displayed | 008-FR-007, 008-FR-008, 008-NFR-002 |
| 008-AC-005 | Cancel reindex | 1. Start reindex<br>2. Click Cancel button<br>3. Wait for cancellation | Reindex stops within 2 seconds; partial progress preserved | 008-FR-009, 008-FR-010, 008-NFR-006 |
| 008-AC-014 | Reembed trigger | 1. Open Settings > Maintenance<br>2. Click "Re-embed All Sections" button<br>3. Confirm re-embedding<br>4. Wait for completion | Progress indicator shows re-embedding progress; all sections have fresh embeddings | 008-FR-011 |

### Model Migration

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 008-AC-006 | Switch embedding model | 1. Open Settings > Graph Engine<br>2. Select different embedding model<br>3. Confirm switch | Migration starts; embedder_id updated in meta table | 008-FR-012, 008-FR-013 |
| 008-AC-007 | Dual-write during migration | 1. Start model migration<br>2. Query embeddings table during migration | Both old and new embeddings exist for same sections during migration | 008-FR-015 |
| 008-AC-008 | Rollback migration | 1. Complete partial migration<br>2. Click "Rollback" button<br>3. Measure rollback time | Previous embedder_id restored; search uses old embeddings; completes in <30s | 008-FR-017, 008-NFR-004, 008-NFR-005 |
| 008-AC-015 | Embedder filter | 1. Index project with Model A<br>2. Switch to Model B and re-embed subset<br>3. Search for content<br>4. Verify results source | Only results from active model (Model B) returned; results from Model A embeddings not included in search results | 008-FR-016 |
| 008-AC-016 | Migration progress UI | 1. Start embedding model migration<br>2. Observe progress UI<br>3. Observe ETA<br>4. Wait for migration completion | Shows percentage complete (e.g., "45% - 450/1000 sections"), estimated time remaining, and 100% success message on completion | 008-FR-018 |

### Binary Quantization

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 008-AC-009 | Enable quantization | 1. Open Settings > Graph Engine<br>2. Enable "Binary Quantization"<br>3. Trigger re-embed<br>4. Compare memory usage | Vector storage memory usage reduced by >30x; search still returns relevant results | 008-FR-019, 008-FR-020, 008-FR-021, 008-NFR-001 |

### Health Monitoring

| ID | Description | Steps | Expected Result | Traces To |
|----|-------------|-------|-----------------|-----------|
| 008-AC-010 | Database health check | 1. Open Settings > Diagnostics<br>2. Click "Check Health"<br>3. Review database section | Shows integrity status (OK/FAIL), WAL size in MB, page count | 008-FR-022 |
| 008-AC-011 | Complete health dashboard | 1. Open Settings > Diagnostics<br>2. View all health metrics | Dashboard shows: DB health (integrity, WAL, pages), Workers (active, queue, crashes), Disk (index size, free space) | 008-FR-022, 008-FR-023, 008-FR-024, 008-FR-026 |
| 008-AC-012 | Health API | 1. Call health API via IPC<br>2. Parse response | Returns JSON with db, workers, disk sections; all metrics populated | 008-FR-025, 008-NFR-007, 008-NFR-008 |
| 008-AC-017 | Worker crash recovery | 1. Simulate worker crash during embedding operation<br>2. Observe worker pool manager response<br>3. Verify operation retry | Crashed worker replaced within 2 seconds; in-flight operations retried automatically; system remains operational | 008-FR-027 |
| 008-AC-018 | Vector search health | 1. Open Settings > Diagnostics<br>2. Click "Check Health"<br>3. Review vector search section | Shows vec_version() result and test query success/failure status | 008-FR-030 |

## Definition of Done

- [ ] All acceptance criteria pass
- [ ] Unit tests cover FR implementations (>80% coverage)
- [ ] Integration tests verify end-to-end flows
- [ ] Performance benchmarks meet NFR targets
- [ ] Settings UI components follow design system
- [ ] Error states handled gracefully with user feedback
- [ ] Documentation updated (user guide, API reference)
- [ ] Code reviewed and approved

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Reindex during active migration | Block reindex; show "Migration in progress" message |
| Cancel migration mid-way | Rollback to previous state; preserve data integrity |
| Disk space exhausted during operation | Stop gracefully; show warning; preserve partial progress |
| Entity has no connections | Generate single-node diagram with message |
| Health check on corrupted database | Report corruption; suggest recovery steps |
| Quantization on small dataset | Allow but warn that benefits are minimal for <10K documents |
| Worker crash during embedding | Automatic recovery with retry (max 3 attempts) |
| Corpus exceeds 100K documents | Non-intrusive notification recommending binary quantization |
| Migration without backup | Automatic backup created before migration starts |
