# Grounding and fact-checking – specification gap analysis

A systematic audit of what erfana's current specifications (T4-004 through T3-008) cover, what they miss, and what entirely new specifications are needed for truly robust, audit-grade source grounding and hallucination prevention.

**Date**: 2026-03-28
**Scope**: All 5 Graph Engine milestones + prompt system + MCP tools + document workflows
**Related**: [notebooklm-source-grounding-research.md](notebooklm-source-grounding-research.md)

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Gaps within existing specifications](#2-gaps-within-existing-specifications)
3. [Missing specifications – not covered at all](#3-missing-specifications--not-covered-at-all)
4. [Cross-cutting concerns](#4-cross-cutting-concerns)
5. [Inconsistencies between specifications](#5-inconsistencies-between-specifications)
6. [Recommendations – new specs and amendments](#6-recommendations--new-specs-and-amendments)

---

## 1. Executive summary

Erfana's Graph Engine specifications (M1–M5) provide a **strong foundation for search and retrieval** – keyword search, vector similarity, entity extraction, temporal queries, and MCP tool interfaces are all well-designed. However, they were architected as a **general-purpose knowledge graph**, not as an **audit grounding system**.

The critical gaps fall into three categories:

| Category | Impact | Count |
|----------|--------|-------|
| **Gaps in existing specs** – features partially specified but insufficient for grounding | High | 14 |
| **Missing specs** – entire workflows not designed at all | Critical | 6 |
| **Cross-cutting concerns** – consistency and edge case issues | Medium | 8 |

**The single largest gap**: There is no specification for the **grounded generation pipeline** – the workflow from "user requests an audit summary" through "retrieve sources" → "generate with citations" → "verify claims against corpus" → "produce confidence-rated output". The Graph Engine provides the retrieval layer, but the generation, citation, and verification layers are entirely undesigned.

---

## 2. Gaps within existing specifications

### 2.1 M1 (T4-004) – Graph foundation

#### Gap 1: Search results return snippets, not citable text spans

**What's specified**: `content_snippet` in search results (004-FR-023), typically 200–300 characters with context.

**What's needed for grounding**: Full text of the matched section, with exact byte offsets (`start_byte`, `end_byte`) so that citations can reference precise line ranges. A 200-char snippet is insufficient for Claude Code to verify whether a claim is supported – it needs the complete surrounding context.

**Impact**: Without full-text retrieval, Claude Code cannot produce accurate `[Source: file.md, lines X–Y]` citations because it doesn't know where the snippet falls within the file.

**Suggested amendment**: Add a `full_text` field to search results (opt-in via parameter to avoid payload bloat), and include `start_line`/`end_line` computed from `start_byte`/`end_byte`.

#### Gap 2: No heading slug generation algorithm

**What's specified**: Citation format uses markdown links `[Section Title](./path/file.md#section-title)` (004-FR-027), and heading slugs should be "URL-safe" (004-AC-020).

**What's missing**: No algorithm for converting headings to slugs. No collision handling when multiple sections share the same heading text. No specification of case folding, punctuation stripping, or Unicode normalization.

**Impact**: Citations may link to the wrong section or produce broken anchors. Two sections titled "Risk assessment" in the same file would generate identical slugs.

**Suggested amendment**: Adopt GitHub-flavored slug algorithm (lowercase, strip punctuation, spaces → hyphens, append `-N` suffix on collision). Document as a shared utility spec.

#### Gap 3: No search result provenance tracking

**What's specified**: Search returns `file_path`, `section_heading`, `content_snippet`, `relevance_score`.

**What's missing**: No `matched_terms` array showing which query terms matched, no `match_field` indicating whether the match was in heading or body, no `match_positions` for highlighting.

**Impact**: When generating audit documents, Claude Code cannot explain *why* a source was retrieved or assess whether the match is relevant to the specific claim being made.

**Suggested amendment**: Add `matched_terms: string[]`, `match_field: 'heading' | 'content'`, and `highlight_ranges: {start: number, end: number}[]` to search results.

---

### 2.2 M2 (T3-005) – Vector search

#### Gap 4: No query-based vector search

**What's specified**: `erfana_graph_related` takes a `section_id` and finds similar sections (005-FR-022).

**What's missing**: No tool accepts a **free-text query** for vector search. Claude Code cannot say "find passages semantically related to 'data retention policy compliance'" without first finding a section that discusses that topic and using its ID.

**Impact**: This is a fundamental limitation for audit grounding. The most common workflow is: user describes a topic → system finds all relevant passages. Requiring a section ID as input creates a chicken-and-egg problem.

**Suggested amendment**: Add a `query` parameter to `erfana_graph_related` (or create a new tool `erfana_graph_semantic_search`) that embeds the query text on-the-fly and performs vector similarity search against the corpus.

#### Gap 5: Chunk boundary semantics are underspecified

**What's specified**: Chunks of 256–384 tokens with 10–15% overlap (005-FR-017/018/019). Sentence boundary respect is LOW priority (005-FR-019).

**What's missing**: No specification of how chunk boundaries map back to source sections. When a vector match is found at chunk level, how is the original section context reconstructed? The spec says "minimum distance per section" for aggregation (005-FR-023) but doesn't specify how to return the matching *chunk* text rather than the full section.

**Impact**: For citation accuracy, knowing which specific paragraph within a section matched is critical. A section might be 2000 words long – citing the entire section is too vague for audit purposes.

**Suggested amendment**: Store chunk-level metadata (chunk_index, start_char, end_char within section) and return chunk-level results alongside section-level aggregation.

#### Gap 6: No cross-document deduplication awareness

**What's specified**: Content hash deduplication skips re-embedding identical content (005-FR-038).

**What's missing**: No specification for how search results handle duplicated content across files. If the same policy text appears in three documents, search returns three results with identical content but different paths. For audit grounding, this creates false confidence (same content cited from multiple "independent" sources).

**Impact**: Confidence ratings ("confirmed by 2+ independent sources") become unreliable if duplicated content inflates source counts.

**Suggested amendment**: Add a `content_hash` field to search results. Let Claude Code detect and collapse duplicates.

---

### 2.3 M3 (T3-006) – Knowledge graph

#### Gap 7: No composite entity + topic queries

**What's specified**: `erfana_graph_backlinks` finds all sections mentioning an entity. `erfana_graph_search` finds sections matching a keyword query. These are separate tools.

**What's missing**: No single query can answer "what did Person X say about Topic Y?" This requires manually calling backlinks for Person X, then filtering those results by Topic Y – a multi-step process that wastes Claude Code's context window and increases latency.

**Impact**: For audit interviews, the most critical question is attribution: "According to [interviewee], [claim]." Without composite queries, this requires multiple roundtrips.

**Suggested amendment**: Add `topic_filter` parameter to `erfana_graph_backlinks`, or create `erfana_graph_attributed_search({ entity: string, query: string })` that intersects entity mentions with semantic search results.

#### Gap 8: Entity extraction is pattern-only – no NLP

**What's specified**: Rule-based extraction via regex patterns: `[[wikilinks]]`, `#tags`, `@mentions`, dictionary terms (006-FR-005 through 008).

**What's missing**: No NLP/LLM-based entity extraction. Interview transcripts rarely contain wikilinks or hashtags. Person names, organization names, dates, and technical terms appear as plain text. The current extraction would miss virtually all entities in natural-language transcripts.

**Impact**: For audit grounding, entity extraction from transcripts is foundational. Without it, the "who said what" capability doesn't work for interview content. M3's entity extraction as specified is designed for structured markdown (developer notes, wiki-style docs), not natural language.

**Suggested amendment**: Add an optional NLP extraction mode using either: (a) local NER model via ONNX (e.g., `dslim/bert-base-NER`, ~400MB), or (b) LLM-based extraction via configured API (Claude/OpenAI) for higher accuracy. Make it configurable per-project. This could be a separate spec (T3-level) that extends M3.

#### Gap 9: No entity type for "statement" or "claim"

**What's specified**: Entity types: `concept`, `tag`, `person`, `technology` (006-FR-005 through 008).

**What's missing**: No entity type for **factual claims, decisions, or findings** – the core unit of audit work. Auditors need to track statements like "Access controls were last reviewed in Q2 2025" as first-class entities with attribution.

**Impact**: Without claim-level entities, the knowledge graph cannot model the audit domain. Contradiction detection (M4) works on entity relationships, not on factual statements.

**Suggested amendment**: Add entity types: `claim` (factual assertion), `decision` (action item or resolution), `finding` (audit observation). These would enable claim-level tracking, attribution, and contradiction detection.

#### Gap 10: Mention positions use character offsets in preprocessed text

**What's specified**: `start_char`, `end_char` positions in the **preprocessed** (markdown-stripped) text (006-AC-010).

**What's missing**: No mapping back to original markdown positions. If a user clicks a mention highlight, the editor shows the original markdown – but the character offsets don't match because markdown syntax was stripped.

**Impact**: Citation links to specific character positions will be off if they reference preprocessed coordinates in a raw markdown file.

**Suggested amendment**: Store both `raw_start_char`/`raw_end_char` (original markdown) and `processed_start_char`/`processed_end_char` (stripped text). Or maintain a position mapping table.

---

### 2.4 M4 (T3-007) – Temporal queries

#### Gap 11: Contradiction detection is edge-based only

**What's specified**: Detect contradictions when the same source entity has edges of the same type to different destinations (007-FR-014 through 016). Example: `ERFANA --uses--> sqlite-vss` AND `ERFANA --uses--> sqlite-vec`.

**What's missing**: No **content-level contradiction detection**. Two interview transcripts might contain contradictory factual claims ("The backup runs daily" vs. "Backups are weekly") without involving entity relationships at all. Edge-based contradiction detection only catches structural inconsistencies, not semantic ones.

**Impact**: For audit grounding, content contradictions are far more common and important than entity-relationship contradictions. This is the primary use case for temporal queries in audit work.

**Suggested amendment**: Add semantic contradiction detection: for each claim entity (Gap 9), compare its content against other claims about the same topic using vector similarity. Flag pairs with high similarity but contradictory content for human review. This requires the claim entity type and likely LLM-assisted comparison.

#### Gap 12: No temporal awareness in search

**What's specified**: `erfana_graph_timeline` returns edge history. FTS5 and vector search always query current state.

**What's missing**: Time-filtered search. "What did the documents say about access controls *as of January 2026*?" requires searching an older version of the corpus. The current design only tracks entity relationship changes over time, not document content changes.

**Impact**: Audit reports often need to reference the state of documentation at a specific point in time (e.g., "at the time of the incident"). Without temporal search, this is impossible.

**Suggested amendment**: This is a significant architectural addition. Options: (a) integrate with git history to reconstruct past file states, (b) store section content snapshots at each index event, or (c) acknowledge this limitation and recommend git-based manual reconstruction.

---

### 2.5 M5 (T3-008) – Polish

#### Gap 13: No search quality metrics

**What's specified**: Binary quantization search quality is "acceptable" (008-NFR-001). No other quality metrics defined.

**What's missing**: No precision/recall targets for search. No specification of how to measure whether search results are actually relevant to the query. No A/B testing framework for comparing BM25 vs. vector vs. hybrid results.

**Impact**: Without quality metrics, there's no way to know if the grounding system is actually reducing hallucinations or returning irrelevant sources that Claude Code incorporates incorrectly.

**Suggested amendment**: Define relevance metrics: (a) manual relevance judgments on a test corpus, (b) precision@K and recall@K targets, (c) MRR (Mean Reciprocal Rank) for top-result accuracy. Consider adding a "feedback" mechanism where users can mark search results as relevant/irrelevant.

#### Gap 14: No audit trail for search queries

**What's specified**: Health monitoring tracks database integrity, worker status, disk space (008-FR-022 through 025).

**What's missing**: No logging of search queries and results. For audit work, it's essential to know: what queries were run, what results were returned, which results were used in the final document, and whether any results were ignored.

**Impact**: Audit traceability requires demonstrating the methodology used to produce findings. Without query logs, the audit process itself is not auditable.

**Suggested amendment**: Add a `query_log` table: `(id, timestamp, tool_name, query_params, result_count, result_ids, session_id)`. Expose via MCP tool `erfana_graph_query_log`.

---

## 3. Missing specifications – not covered at all

These represent entire workflows or capabilities that have no specification in any milestone.

### Missing spec A: Grounded generation pipeline

**What's needed**: An end-to-end specification for how Claude Code generates audit documents with source grounding. This is the core missing piece.

**Scope**:
- Prompt template architecture for audit document generation
- Citation format standard (inline references, footnotes, or endnotes)
- Confidence rating system (how many independent sources confirm a claim)
- Verbatim quote extraction rules (when to quote vs. paraphrase)
- Gap identification (detecting topics not covered in source material)
- Output structure (executive summary → findings → gaps → contradictions → recommendations)

**Why no existing spec covers this**: The Graph Engine specs focus on **retrieval infrastructure**. Generation is treated as an external concern (Claude Code handles it). But without a specification, generation quality depends entirely on ad-hoc prompting.

**Suggested spec**: T3-level spec "Grounded audit document generation" covering prompt templates, citation standards, and verification workflows.

### Missing spec B: Post-generation claim verification

**What's needed**: A specification for verifying that generated documents are actually grounded in sources.

**Scope**:
- Claim extraction from generated documents (parse each factual statement)
- Source lookup for each claim (search corpus for supporting evidence)
- Citation accuracy verification (does the cited passage actually support the claim?)
- Unsupported claim flagging (claims with no corpus evidence)
- Confidence scoring (verbatim match vs. paraphrase vs. inference)
- Human review workflow (how flagged issues are presented to the user)

**Why this matters**: Research (ALCE benchmark, EMNLP 2023) shows that even the best models lack complete citation support 50% of the time. Post-generation verification is essential, not optional.

**Suggested spec**: T3-level spec "Claim verification and grounding audit" – could be a new MCP tool or a specialized Claude Code agent.

### Missing spec C: Interview transcript structuring

**What's needed**: A specification for how raw interview transcripts are structured for optimal retrieval.

**Scope**:
- Speaker identification and labeling (who is speaking)
- Topic segmentation (breaking transcripts into thematic sections)
- Question-answer pair extraction (mapping interviewer questions to interviewee responses)
- Timestamp preservation (linking text segments to audio timestamps)
- Metadata enrichment (interviewee role, date, location, audit area)
- Cross-transcript topic alignment (same topic discussed across multiple interviews)

**Why no existing spec covers this**: The current TranscriptionService outputs raw text with basic frontmatter. There's no post-transcription structuring step. The organize-import prompt handles file placement, not content structuring.

**Impact**: Unstructured transcripts make retrieval noisy. A question about "access controls" might retrieve the interviewer's question rather than the interviewee's answer. Speaker attribution is lost.

**Suggested spec**: T3-level spec "Interview transcript structuring" – could be a new prompt template + post-import processing step.

### Missing spec D: Source document registry

**What's needed**: A specification for tracking which source documents exist, their metadata, their relationships, and their authority level.

**Scope**:
- Document registry table (file path, type, author, date, authority level, scope)
- Authority hierarchy (policy > procedure > guideline > interview > informal note)
- Document relationships (supersedes, references, implements, contradicts)
- Version tracking (which version of a policy was in effect at audit time)
- Completeness tracking (which audit areas have source documents, which have gaps)

**Why this matters**: Not all sources are equal. A formal policy document carries more weight than an interview statement. The current system treats all markdown files identically.

**Suggested spec**: T3-level spec "Source document registry and authority model".

### Missing spec E: MCP tool for orchestrated grounding

**What's needed**: A higher-level MCP tool that orchestrates the full grounding workflow, rather than requiring Claude Code to manually call individual search/entity/backlink tools.

**Scope**:
- `erfana_ground_claim({ claim: string, context?: string })` – searches corpus for evidence supporting or contradicting a specific claim
- Returns: supporting passages with confidence scores, contradicting passages, related but inconclusive passages
- Internally orchestrates: keyword search + vector search + entity lookup + temporal check
- Includes: source authority weighting, cross-document deduplication, confidence aggregation

**Why this matters**: Currently, grounding a single claim requires 3–5 separate MCP tool calls (search, related, backlinks, timeline). This is slow, uses Claude Code's context window inefficiently, and requires the LLM to correctly orchestrate the retrieval – which itself is a source of errors.

**Suggested spec**: T3-level spec "Grounding orchestration MCP tool".

### Missing spec F: Grounding quality dashboard

**What's needed**: A UI panel that shows the grounding quality of the current document.

**Scope**:
- Claim count (total factual statements in document)
- Grounded percentage (claims with at least one supporting source)
- Citation accuracy (verified citations vs. total citations)
- Source diversity (number of independent sources used)
- Gap visualization (topics with no source coverage)
- Contradiction indicators (flagged inconsistencies)
- Export: grounding quality report as appendix to audit document

**Why this matters**: Auditors need to demonstrate due diligence. A grounding quality dashboard provides evidence that the document was systematically verified against sources.

**Suggested spec**: T3-level spec "Grounding quality dashboard" – a new erfana UI panel.

---

## 4. Cross-cutting concerns

### 4.1 Markdown variant is unspecified

The specs reference markdown stripping (004-FR-006, 005-FR-035) but never specify which markdown variant: CommonMark, GitHub Flavored Markdown (GFM), or another. GFM supports tables, task lists, strikethrough, and autolinks – all common in audit documents. If stripping rules don't account for GFM extensions, table content may be incorrectly processed.

### 4.2 Unicode and internationalization

Entity names, tags, and mentions are matched via ASCII-centric regex patterns. No specification for:
- Unicode normalization (NFC vs NFKC) for entity name matching
- Case-sensitivity rules for entity deduplication (is "GDPR" the same entity as "gdpr"?)
- Non-Latin script handling in tags and mentions
- Accented character handling in search queries

### 4.3 Large file handling

No specification addresses files larger than the chunking window. Interview transcripts can be 50–100 pages (50K+ tokens). The specs mention sections split by headings, but transcripts often have no headings – they're continuous text. Without heading-based section boundaries, how is a 100-page transcript sectioned for indexing?

### 4.4 Concurrent MCP tool access

The specs define rate limits per tool (100/min for search, 50/min for others) but don't address concurrent access from multiple Claude Code sessions. If two terminal tabs run Claude Code simultaneously, both hitting the MCP server, rate limits could be exhausted or results interleaved.

### 4.5 Search result ordering stability

No specification guarantees deterministic result ordering for identical queries. BM25 scores are deterministic for identical corpora, but if the corpus is being indexed concurrently, results may vary between calls. For audit traceability, identical queries should produce identical results (at least within the same index state).

### 4.6 Embedding model consistency across lifecycle

M5 specifies model migration with dual-write (008-FR-015), but doesn't address:
- What happens to query logs that reference old embedder_id results?
- How to compare search quality before/after migration?
- Whether historical citations remain valid after re-embedding (byte offsets may shift if chunking parameters change)

### 4.7 Error propagation in grounding pipeline

No specification addresses how errors in one stage affect downstream stages:
- If FTS5 search fails, does vector search still run?
- If entity extraction misidentifies a person, does contradiction detection produce false positives?
- If a citation references a deleted file, how is the broken link surfaced?

### 4.8 Privacy and redaction for audit content

M5 mentions regex-based redaction before indexing (from architecture doc), but no spec details:
- What patterns are redacted (API keys, SSNs, passwords?)
- Whether redacted content is searchable (indexed with redaction, or excluded entirely?)
- How citations handle redacted passages (cite redacted text? skip? flag?)

---

## 5. Inconsistencies between specifications

| Issue | Specs involved | Details |
|-------|---------------|---------|
| **Rate limit values** | T4-004 vs architecture doc | M1 spec says 100/min for search. Architecture doc says 50/min for entities/backlinks/timeline. Neither value appears in the M3/M4 specs themselves. |
| **Content hash algorithm** | T4-004 vs T3-005 | M1 specifies SHA-256 (004-FR-008). M2 references content hash deduplication (005-FR-038) but doesn't specify the algorithm – assumes SHA-256 from M1 but never states it. |
| **Whitespace normalization** | T4-004 vs T3-005 | M1 says "collapse multiple spaces/newlines to single space" (004-FR-007). M2 says "max 2 consecutive newlines" (005-FR-035). These are contradictory rules. |
| **Default search result count** | T4-004 vs T3-005 | M1 `erfana_graph_search` defaults to k=10 (004-FR-022). M2 `erfana_graph_related` defaults to k=20 (005-FR-022). No rationale for the difference. |
| **Section identity stability** | T4-004 vs T3-006 | M1 identifies sections by `file_id + start_byte/end_byte`. M3 identifies entity mentions by `section_id + start_char/end_char`. If a section is re-indexed with different byte offsets (due to edits above it), section_id changes, orphaning all mentions. |

---

## 6. Recommendations – new specs and amendments

### Priority 1 – Amendments to existing specs (high impact, low effort)

| # | Spec | Amendment | Effort |
|---|------|-----------|--------|
| 1 | T4-004 (M1) | Add `full_text`, `start_line`, `end_line` to search results | Small |
| 2 | T4-004 (M1) | Define heading slug algorithm with collision handling | Small |
| 3 | T4-004 (M1) | Add `matched_terms`, `match_field` to search results | Small |
| 4 | T3-005 (M2) | Add free-text query parameter to `erfana_graph_related` | Medium |
| 5 | T3-005 (M2) | Store chunk-level metadata (start_char, end_char within section) | Medium |
| 6 | T3-006 (M3) | Add `topic_filter` parameter to `erfana_graph_backlinks` | Small |
| 7 | All specs | Unify rate limit specifications in one place | Small |
| 8 | T4-004 vs T3-005 | Resolve whitespace normalization contradiction | Small |

### Priority 2 – New specifications (high impact, medium effort)

| # | Spec | Scope | Tier |
|---|------|-------|------|
| 9 | **Grounded generation pipeline** | Prompt templates, citation format, confidence ratings, output structure | T3 |
| 10 | **Claim verification** | Post-generation verification, unsupported claim flagging, human review | T3 |
| 11 | **Interview transcript structuring** | Speaker identification, topic segmentation, Q&A extraction | T3 |
| 12 | **Grounding orchestration MCP tool** | `erfana_ground_claim` – single-call grounding with composite search | T3 |

### Priority 3 – New specifications (medium impact, higher effort)

| # | Spec | Scope | Tier |
|---|------|-------|------|
| 13 | **Source document registry** | Authority model, version tracking, completeness tracking | T3 |
| 14 | **NLP entity extraction** | Local NER model or LLM-based extraction for natural language | T3 |
| 15 | **Grounding quality dashboard** | UI panel showing grounding metrics, gap visualization | T3 |
| 16 | **Search query audit log** | Query logging for audit traceability | T2 |
| 17 | **Semantic contradiction detection** | Content-level contradictions beyond entity relationships | T3 |

### Priority 4 – Acknowledged limitations (defer or accept)

| # | Issue | Recommendation |
|---|-------|---------------|
| 18 | Time-filtered search (past corpus states) | Acknowledge limitation; recommend git-based manual reconstruction |
| 19 | Cross-document content deduplication | Add `content_hash` to search results; defer dedup logic to consumer |
| 20 | Large file sectioning without headings | Define fallback: paragraph-based splitting when no headings exist |

---

## Appendix: gap impact matrix

| Gap | Grounding impact | Audit traceability impact | Implementation complexity |
|-----|-----------------|--------------------------|--------------------------|
| No full-text in search results | 🔴 Critical | 🔴 Critical | 🟢 Low |
| No query-based vector search | 🔴 Critical | 🟡 Medium | 🟡 Medium |
| No NLP entity extraction | 🔴 Critical | 🔴 Critical | 🔴 High |
| No grounded generation pipeline spec | 🔴 Critical | 🔴 Critical | 🟡 Medium |
| No claim verification spec | 🔴 Critical | 🔴 Critical | 🟡 Medium |
| No composite entity+topic queries | 🟡 High | 🟡 Medium | 🟢 Low |
| No search query audit log | 🟢 Low | 🔴 Critical | 🟢 Low |
| No heading slug algorithm | 🟡 Medium | 🟡 Medium | 🟢 Low |
| No content-level contradiction detection | 🟡 High | 🟡 Medium | 🔴 High |
| No source authority model | 🟡 Medium | 🟡 High | 🟡 Medium |
| No interview transcript structuring | 🔴 Critical | 🟡 Medium | 🟡 Medium |
| No grounding quality dashboard | 🟡 Medium | 🟡 High | 🟡 Medium |
