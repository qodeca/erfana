# Source grounding – missing specs and recommendations

> Part of [Source grounding research](README.md)
> Related: [Gap analysis](gap-analysis.md) | [Implementation roadmap](implementation-roadmap.md)

---

## 1. Missing specifications

The following specifications do not exist in the current system but are required for production-quality grounding.

### Missing Spec A: Grounded generation pipeline

A specification for the end-to-end flow: query -> retrieval -> context assembly -> generation -> verification -> citation. Currently each step is loosely defined in isolation; no specification describes how they compose.

**Should define**: Context window budget allocation, retrieval-then-generate vs interleaved retrieval, handling of conflicting sources, fallback when no grounding is found, and the prompt templates used for grounded generation.

**Paper references**:
- **AGREE** (NAACL 2024, [arXiv:2311.09533](https://arxiv.org/abs/2311.09533)) – adaptive grounding and retrieval-augmented generation pipeline with iterative refinement
- **Audit procedure generation** (EMNLP 2025) – structured generation from grounded evidence with verification steps
- **Ground-GRPO** ([arXiv:2506.15522](https://arxiv.org/abs/2506.15522)) – grounding-aware reinforcement learning for generation quality

### Missing Spec B: Semantic contradiction detection

When multiple sources provide conflicting information, the system should detect and surface the contradiction rather than silently choosing one version. No specification exists for contradiction handling.

**Should define**: Contradiction detection method (NLI-based or LLM-based), presentation format (side-by-side comparison with sources), resolution strategy (most recent, most authoritative, or user choice), and how contradictions affect confidence scores.

**Paper reference**: **CaLM** (ACL 2024 Findings, [arXiv:2406.05365](https://arxiv.org/abs/2406.05365)) – calibrated language model confidence for detecting and handling contradictory evidence in multi-source settings.

### Missing Spec C: Transcript structuring pipeline

A dedicated specification for converting raw transcripts and meeting notes into structured, searchable documents. This is a prerequisite for Gap 9.

**Should define**: Transcript format detection (auto-detect speaker patterns, timestamps), speaker diarisation mapping, extraction of decisions/action items/questions, structured output format, and linking to agenda items or related documents.

### Missing Spec D: Embedding model lifecycle

A specification for managing the embedding model: initial selection, upgrade path, re-indexing procedure, compatibility between model versions, and fallback when the model is unavailable.

**Should define**: Model selection criteria (dimension size, language support, licence), re-indexing trigger and procedure (full vs incremental), version compatibility matrix, and performance benchmarks for the target document collection.

### Missing Spec E: Improved individual tool design

> **Revised recommendation**: The original gap identified a need for a "grounding orchestration tool" that would coordinate multi-step retrieval, verification, and citation. However, Claude Code is already an orchestration agent capable of composing multiple tool calls. Building a separate orchestration layer would duplicate functionality and add unnecessary complexity.

**Should define instead**: Improvements to individual MCP tools that make them more composable – `search_notes` with `sources_only`, `include_full_text`, and `matched_terms`; a dedicated `verify_claim` tool; a `get_section` tool for targeted retrieval. Claude Code's existing agent loop handles the orchestration of these tools naturally. Focus on making each tool excellent rather than building meta-tooling.

### Missing Spec F: Grounding quality dashboard

A specification for monitoring and visualising grounding quality over time. No observability layer exists.

**Should define**: Key metrics (grounding rate, confidence distribution, citation accuracy, source coverage), visualisation format (dashboard page in the app), alerting thresholds (e.g. grounding confidence below threshold), and data retention policy for grounding logs.

### Missing Spec G: Source dependency tracking

A specification for tracking provenance and freshness of derived documents relative to their source dependencies.

**Should define**: Frontmatter provenance fields (`derived_from: [path1, path2]`, `derived_at: ISO-date`), staleness detection (compare `derived_at` against source `modified_at`), UI indicators for stale derived documents, and re-generation triggers when sources change. This is a direct extension of Gap 0's source/derived distinction – once documents are tagged, their dependency relationships should be tracked.

### Missing Spec H: Export citation format transformation

A specification for transforming internal citation formats into external-facing formats suitable for sharing, export, and publication.

**Should define**: Transformation rules from internal paths (`vault/architecture/decisions/adr-001.md#performance`) to external titles ("Architecture Decision Record: Performance Optimisation, Section: Performance"). Support for standard citation formats (APA, IEEE, plain text). Handling of citations to private/internal documents when exporting to external audiences. Batch transformation for full document export.

---

## 2. Cross-cutting technical concerns

### 2.1 Rate limiting inconsistency

The MCP specification defines rate limits per tool but does not account for compound operations (e.g. a grounded generation flow that calls `search_notes` three times, `read_note` five times, and `verify_claim` once). The per-tool limits may be hit during a single logical operation.

**Suggested amendment**: Define operation-level rate limits in addition to tool-level limits. Allow burst capacity for compound operations within a session.

### 2.2 Temporal search limitations

No support for time-scoped queries ("What changed last week?", "Show me decisions from Q1 2025"). Document modification dates are available but not exposed as search filters.

**Suggested amendment**: Add `modified_after` and `modified_before` parameters to search tools. Index document dates for range queries.

### 2.3 Deduplication

No handling of duplicate or near-duplicate content. If the same information appears in multiple documents (e.g. a decision recorded in meeting notes, an ADR, and a summary), all copies are returned and cited independently.

**Suggested amendment**: Implement near-duplicate detection using MinHash or SimHash. Group duplicates and return the authoritative version (prefer `type: source` over `type: derived`).

### 2.4 Large file handling

No specification for documents exceeding the context window or embedding model's token limit. A 50,000-word specification would be split into arbitrary chunks without semantic awareness.

**Suggested amendment**: Define a maximum section size. For sections exceeding the limit, split at paragraph boundaries. Document the splitting algorithm and ensure chunk overlap for continuity.

### 2.5 Index consistency

No specification for maintaining index consistency when documents are modified concurrently – e.g. a document is edited while a search query is being processed against the old index.

**Suggested amendment**: Define consistency guarantees (eventual consistency is acceptable for a local app). Specify the re-indexing trigger (file watcher event) and the expected propagation delay.

### 2.6 Embedding storage format

No specification for the binary format of stored embeddings, versioning of the embedding table, or migration path when changing embedding dimensions.

**Suggested amendment**: Define the embedding table schema with a `model_version` column. Support multiple embedding versions during migration. Document the re-indexing procedure.

### 2.7 Offline behaviour

No specification for behaviour when the embedding model or LLM is unavailable. Should the system fall back to keyword-only search? Should it warn the user that grounding quality is degraded?

**Suggested amendment**: Define degraded-mode behaviour. Fall back to FTS5-only search with a UI indicator. Disable confidence scores in degraded mode.

### 2.8 Multi-language support

No specification for handling documents in multiple languages. The current FTS5 tokeniser and embedding model are English-optimised.

**Suggested amendment**: Document language support limitations. Plan for multilingual embedding models. Consider language detection and per-language tokeniser configuration.

### 2.9 Memory management in Electron

No specification for memory budgets in the Electron renderer and main processes. Embedding computation, vector storage, and SQLite FTS indices all compete for memory in a single-user desktop application.

**Suggested amendment**: Define memory budgets per subsystem (e.g. max 200MB for vector index in memory, 100MB for FTS cache). Implement lazy loading of vector indices. Monitor and log memory usage. Define behaviour when memory pressure is detected (evict least-recently-used embeddings, reduce batch size).

### 2.10 Native module cross-platform distribution

ONNX Runtime and `sqlite-vec` are native modules that must be compiled or pre-built for each platform (macOS ARM, macOS x86, Windows x64, Linux x64). No specification exists for the build and distribution pipeline.

**Suggested amendment**: Define the native module matrix (module x platform x architecture). Use pre-built binaries where available. Document the `electron-rebuild` integration. Test on all target platforms in CI. Define fallback behaviour when a native module fails to load.

### 2.11 Cold start time for ONNX models

Loading ONNX embedding models at application startup introduces a 1–3 second delay before the grounding system is operational. No specification addresses this startup cost.

**Suggested amendment**: Lazy-load the ONNX model on first search request rather than at startup. Show a loading indicator during model initialisation. Cache the model in memory after first load. Consider pre-warming the model during idle time after startup.

### 2.12 Index size growth

Vector index size grows linearly with document count. Approximate projections: 10K sections ~ 15MB of vectors, 100K sections ~ 150MB of vectors. Combined with FTS indices, metadata, and the SQLite database, total storage may reach 500MB–1GB for large vaults.

**Suggested amendment**: Document expected index sizes at various vault scales. Define a maximum recommended vault size. Implement index compression (e.g. scalar quantisation for embeddings). Provide a "vault health" indicator showing index size and growth rate. Consider optional index pruning for archived documents.

### 2.13 Concurrent SQLite writes during MCP queries

The MCP server may receive concurrent search queries while the file watcher triggers index updates. SQLite's default locking mode serialises writes, which could block search queries during bulk re-indexing.

**Suggested amendment**: Use WAL (Write-Ahead Logging) mode for the SQLite database to allow concurrent reads during writes. Define batch sizes for re-indexing to avoid long write locks. Consider separate read and write connections.

### 2.14 Embedding consistency between interim and native systems

If an interim cloud-based embedding service is used before the native ONNX pipeline is ready, the two systems will produce incompatible embeddings. Documents embedded with one model cannot be searched with the other.

**Suggested amendment**: Store `model_id` and `model_version` with each embedding. Detect model changes and trigger full re-indexing. Never mix embeddings from different models in the same search query. Document the expected re-indexing time for various vault sizes.

### 2.15 sqlite-vec maturity and alternatives

`sqlite-vec` is currently at v0.1.x (alpha). It may have undiscovered bugs, performance issues, or breaking API changes. The `sqlite-vector` project is a competing alternative with different trade-offs.

**Suggested amendment**: Document the decision to use `sqlite-vec` with rationale. Monitor the project's release cadence and issue tracker. Define acceptance criteria for production use (minimum version, required features, benchmark results). Identify `sqlite-vector` as a fallback option. Plan for potential migration if `sqlite-vec` is abandoned or stalls.

---

## 3. Gap impact matrix

| Gap | Severity | Effort | Dependency | Notes |
|-----|----------|--------|------------|-------|
| **Gap 0** – No source/derived distinction | Critical | Medium | None – foundational | Blocks all grounding confidence; enables circular reasoning |
| **Gap 1** – Section-level retrieval | High | High | Gap 4 (anchoring) | Core retrieval improvement |
| **Gap 2** – No vector search | High | High | Spec D (embedding lifecycle) | Core retrieval improvement |
| **Gap 3** – No `full_text` in results | Medium | Low | None | Quick win |
| **Gap 4** – No heading anchoring | Medium | Medium | Gap 1 | Enables deep citation |
| **Gap 5** – No chunk metadata ranking | Medium | Medium | Gap 0, Gap 2 | Requires source/derived tags and embeddings |
| **Gap 6** – No `matched_terms` | Low | Low | None | Quick win |
| **Gap 7** – No topic filtering | Medium | Medium | Gap 0 | Requires indexed metadata |
| **Gap 8** – No entity extraction | Medium | High | Gap 1 | LLM-based post-import |
| **Gap 9** – No transcript structuring | Medium | High | Spec C | Premature without Spec C |
| **Gap 10** – No claim verification | High | High | Spec A | Core grounding quality |
| **Gap 11** – No confidence scoring | High | Medium | Gap 0, Gap 10 | Depends on verification |
| **Gap 12** – No citation format | Medium | Low | Gap 4 | Quick win |
| **Gap 13** – No audit trail | Medium | Medium | None | Observability |
| **Gap 14** – Whitespace contradiction | Low | Low | None | Specification fix only |
| No source dependency tracking | High | Medium | Gap 0 | Derived docs become stale silently |
| No export citation format | Medium | Medium | Gap 12 | Required for external sharing |
| Memory/platform risks (2.9–2.15) | High | High | None | Must be addressed before production |

---

## 4. Prioritised recommendations

### Priority 1 – Foundational (must be first)

1. **Source/derived document distinction** (Gap 0) – implement frontmatter tagging, folder convention, and `sources_only` MCP parameter
2. **`full_text` in search results** (Gap 3) – add `include_full_text` parameter to `search_notes`
3. **`sources_only` filter** (Gap 0/7) – restrict grounding queries to source documents by default
4. **Unify rate limits** (2.1) – define operation-level rate limits for compound grounding flows
5. **Resolve whitespace contradiction** (Gap 14) – store original, index normalised

### Priority 2 – Core retrieval improvements

1. **Vector search with hybrid ranking** (Gap 2) – ONNX embeddings + `sqlite-vec` + RRF
2. **Embedding model upgrade path** (Spec D) – define lifecycle, versioning, re-indexing
3. **`matched_terms` in results** (Gap 6) – expose which terms contributed to match
4. **Heading slug anchoring** (Gap 4) – stable deep links to sections
5. **Chunk metadata in ranking** (Gap 5) – freshness, source type, depth signals
6. **Topic/tag filtering** (Gap 7) – frontmatter-based search filters

### Priority 3 – Grounding quality

1. **Grounded generation pipeline** (Spec A) – end-to-end query -> retrieval -> generation -> verification -> citation
2. **Transcript structuring** (Spec C) – prerequisite for Gap 9
3. **Claim-level verification** (Gap 10) – NLI-based post-generation checking
4. **Source dependency tracking** (Spec G) – provenance and staleness detection
5. **Export citation format** (Spec H) – internal paths -> external titles for sharing

### Priority 4 – Intelligence and observability

1. **Source registry** (Gap 0, extended) – `sources.json` manifest with hashes and origins
2. **LLM-based entity/claim extraction** (Gap 8) – post-import prompt templates
3. **Grounding quality dashboard** (Spec F) – metrics, visualisation, alerting
4. **Query audit log** (Gap 13) – structured logging of grounding operations
5. **Semantic contradiction detection** (Spec B) – surface conflicting sources

### Priority 5 – Acknowledged limitations (deferred)

1. **Temporal search** (2.2) – time-scoped queries
2. **Near-duplicate detection** (2.3) – deduplication of repeated content
3. **Large file handling** (2.4) – semantic-aware splitting for oversized documents
4. **Multi-language support** (2.8) – multilingual embeddings and tokenisers

---

## 5. Validation

| Field | Value |
|-------|-------|
| **Analysis date** | 2026-03-28 |
| **Reviewers** | Marcin Obel |
| **Source material** | erfana specification, MCP tool definitions, research literature |
| **Key corrections applied** | Added Gap 0 (source/derived distinction); added GINGER, Contextual Retrieval, Late Chunking, AGREE, CaLM, FACTS Grounding, Ground-GRPO references; revised Missing Spec E from orchestration tool to improved individual tools; added Missing Specs G and H; added technical concerns 2.9–2.15; restructured priorities into 5 tiers |
| **Next review** | After P1 items are implemented |
