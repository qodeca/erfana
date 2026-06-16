# Source grounding – implementation roadmap

> Part of [Source grounding research](README.md)
> Related: [Gap analysis](gap-analysis.md) | [Missing specs](missing-specs.md)

---

## 1. Spec-ready outlines for new specifications

These outlines provide enough structured detail for Claude Code to create actual specs using the `managing-specs` skill. Each includes: suggested tier, slug, key requirements, and acceptance criteria outlines.

### Spec A: Grounded generation pipeline

| Field | Value |
|-------|-------|
| **Tier** | T3 |
| **Slug** | `grounded-generation-pipeline` |
| **Depends on** | Gap 0 (source/derived distinction), M1 (T4-004) |
| **Extends** | Prompt template system (`src/renderer/src/prompts/`) |

**Key requirements**:
1. Define citation format standard: `[Source: {filename}, lines {start}–{end}]` for internal use, with frontmatter `title` fallback
2. Define audit summary output structure: executive summary -> findings (with citations) -> gaps -> contradictions -> recommendations
3. Implement `audit-summary` prompt template at `src/renderer/src/prompts/templates/audit-summary.md`
4. Implement `verify-claims` prompt template at `src/renderer/src/prompts/templates/verify-claims.md`
5. Define confidence rating system: confirmed (2+ sources), single source, inferred

**Acceptance criteria**:
- Claude Code generates an audit summary where every factual claim has a citation
- Verify-claims template identifies at least 80% of uncited claims in a test document
- Output follows the defined structure consistently

### Spec B: Claim verification

| Field | Value |
|-------|-------|
| **Tier** | T3 |
| **Slug** | `claim-verification` |
| **Depends on** | Spec A (grounded generation pipeline), M1 (T4-004) |
| **Extends** | Prompt template system, potentially a new Claude Code agent |

**Key requirements**:
1. Define claim extraction rules: identify factual statements in generated documents
2. For each claim, search corpus for supporting evidence using MCP tools or Read/Grep
3. Verify citation accuracy: does the cited passage actually support the claim?
4. Flag categories: uncited claims, inaccurate citations, paraphrased-beyond-recognition, training-data-sourced
5. Produce a verification report with pass/fail per claim and overall grounding score

**Acceptance criteria**:
- Verification report correctly identifies deliberately planted false citations in a test document
- Grounding score correlates with actual citation accuracy (manual check on 20+ claims)

### Spec C: Interview transcript structuring

| Field | Value |
|-------|-------|
| **Tier** | T3 |
| **Slug** | `interview-transcript-structuring` |
| **Depends on** | TranscriptionService (existing), organize-import prompt (existing) |
| **Extends** | Import pipeline (`src/main/services/import/`) |

**Key requirements**:
1. Post-transcription prompt template that identifies speakers and labels utterances
2. Topic segmentation: break transcript into thematic sections with headings
3. Q&A pair extraction: map interviewer questions to interviewee responses
4. Enrich frontmatter: `speakers: [...]`, `topics: [...]`, `audit_area: "..."`, `interviewee_role: "..."`
5. Preserve timestamps linking text segments to audio positions (from whisper output)

**Acceptance criteria**:
- A raw 30-minute interview transcript is structured into speaker-labeled, topic-segmented sections
- Frontmatter includes all speaker names and topic list
- Structured transcript improves retrieval relevance (manual comparison: structured vs raw)

### Spec D: Source document registry

| Field | Value |
|-------|-------|
| **Tier** | T3 |
| **Slug** | `source-document-registry` |
| **Depends on** | Gap 0 (source/derived distinction) |
| **Extends** | Project settings (`.erfana/settings.json`), Graph Engine M1 |

**Key requirements**:
1. Define authority hierarchy: `policy > procedure > guideline > interview > informal_note`
2. Frontmatter field: `authority: policy|procedure|guideline|interview|note`
3. Document relationships via frontmatter: `supersedes: [path]`, `references: [path]`, `implements: [path]`
4. Completeness tracking: define expected audit areas, check which have source coverage
5. MCP tool integration: search results include `authority_level` for weighting

**Acceptance criteria**:
- Search results sort higher-authority sources first when `authority_weighted: true`
- Completeness report shows which audit areas lack source documents

### Spec E: Improved MCP tool output (revised from orchestration)

| Field | Value |
|-------|-------|
| **Tier** | T2 |
| **Slug** | `mcp-tool-grounding-output` |
| **Depends on** | M1 (T4-004), Gap 0 |
| **Amends** | 004-FR-023, 004-FR-027, 005-FR-022 |

**Key requirements**:
1. Add `full_text`, `start_line`, `end_line` to `erfana_graph_search` results (amend 004-FR-023)
2. Add `sources_only: boolean` filter to all search MCP tools
3. Add `matched_terms: string[]` and `match_field: 'heading' | 'content'` to search results
4. Add free-text `query` parameter to `erfana_graph_related` (amend 005-FR-022)
5. Add `content_hash` field to search results for deduplication awareness

**Acceptance criteria**:
- Search results include full section text and line numbers when `full_text: true`
- `sources_only: true` excludes files without `type: source` frontmatter
- Vector search accepts free-text query string

### Spec F: Grounding quality dashboard

| Field | Value |
|-------|-------|
| **Tier** | T3 |
| **Slug** | `grounding-quality-dashboard` |
| **Depends on** | Spec A (generation pipeline), Spec B (verification) |
| **Extends** | Renderer UI (`src/renderer/src/components/Panels/`) |

**Key requirements**:
1. New panel showing grounding metrics for the active document
2. Metrics: claim count, grounded percentage, citation accuracy, source diversity, gap count
3. Colour-coded confidence breakdown distribution
4. Gap visualization: topics with no source coverage highlighted
5. Export as appendix section for inclusion in audit deliverables

**Acceptance criteria**:
- Dashboard updates when the active document changes
- Metrics match manual count on a test document (+-5% tolerance)

### Spec G: Source dependency tracking

| Field | Value |
|-------|-------|
| **Tier** | T2 |
| **Slug** | `source-dependency-tracking` |
| **Depends on** | Gap 0 (source/derived distinction) |
| **Extends** | FileWatcherService, frontmatter conventions |

**Key requirements**:
1. Generated documents include frontmatter: `derived_from: [{path, content_hash}]`, `derived_at: ISO-date`
2. Staleness detection: when source file changes, flag derived documents as potentially outdated
3. UI indicator in project tree for stale derived documents
4. Re-generation prompt: offer to re-run generation with updated sources

**Acceptance criteria**:
- Editing a source file causes its derived documents to show a "stale" indicator
- Frontmatter `content_hash` values match actual source file hashes

### Spec H: Export citation format transformation

| Field | Value |
|-------|-------|
| **Tier** | T2 |
| **Slug** | `export-citation-format` |
| **Depends on** | PdfService (existing), DocxService (existing) |
| **Extends** | `src/main/services/PdfService.ts`, `src/main/services/DocxService.ts` |

**Key requirements**:
1. Transform internal citations `[Source: file.md, lines X–Y]` -> external format `[Source: "Document Title", section N.N]`
2. Use frontmatter `title` field for document name; fall back to filename if missing
3. Support footnote and endnote citation styles (configurable per export)
4. Handle broken citations gracefully (missing file -> "[Source unavailable]")

**Acceptance criteria**:
- PDF export replaces all internal citations with human-readable external format
- Missing source files produce "[Source unavailable]" rather than broken references

---

## 2. Dependency graph

```
Gap 0: Source/derived distinction
  +-- Spec E: MCP tool output (sources_only filter)
  +-- Spec G: Source dependency tracking
  +-- Spec D: Source document registry
  +-- Spec A: Grounded generation pipeline
       +-- Spec B: Claim verification
       |    +-- Spec F: Grounding quality dashboard
       +-- Spec C: Interview transcript structuring
            +-- Gap 8/9: NLP entity extraction + claim types (M3)

M1 (T4-004): Graph foundation
  +-- Spec E: MCP tool output (full_text, matched_terms)
  +-- M2 (T3-005): Vector search
  |    +-- Spec E: MCP tool output (query-based vector search)
  +-- M3 (T3-006): Knowledge graph
       +-- M4 (T3-007): Temporal queries

Spec H: Export citation format (independent – extends existing PdfService/DocxService)
```

**Critical path**: Gap 0 -> Spec A -> Spec B -> Spec F

**Parallelizable**: Spec H (export citations) and Spec G (dependency tracking) can be done independently at any time after Gap 0.

---

## 3. Implementation file path map

Exact locations where each component should be created or modified.

### Prompt templates (new files)

| Template | Path | Variables available |
|----------|------|-------------------|
| audit-summary | `src/renderer/src/prompts/templates/audit-summary.md` | `{{selectedText}}`, `{{fileRef}}`, `{{basename filePath}}`, `{{formatLineRange startLine endLine}}` |
| verify-claims | `src/renderer/src/prompts/templates/verify-claims.md` | `{{selectedText}}`, `{{fileRef}}` |
| structure-transcript | `src/renderer/src/prompts/templates/structure-transcript.md` | `{{selectedText}}`, `{{fileRef}}`, `{{basename filePath}}` |

Template frontmatter fields: `name`, `area`, `subArea`, `icon` (Lucide name), `targetPanel` (terminal), `autoExecute` (boolean), `requiresInput` (boolean), `inputPrompt` (string).

### Service modifications

| Component | File | Change |
|-----------|------|--------|
| Graph search MCP tool | `src/main/services/GraphEngineService.ts` (to be created in M1) | Add `full_text`, `start_line`, `end_line`, `sources_only`, `matched_terms` to search results |
| Source/derived detection | `src/main/services/FileService.ts` | Add helper to read frontmatter `type` field from markdown files |
| Staleness detection | `src/main/services/DirectoryWatcherService.ts` | On file change, check if file is listed in any derived document's `derived_from` array |
| PDF citation transform | `src/main/services/PdfService.ts` | Add citation regex replacement in export pipeline |
| DOCX citation transform | `src/main/services/DocxService.ts` | Add citation regex replacement in export pipeline |

### Configuration

| Component | File | Change |
|-----------|------|--------|
| MCP server registration | `.mcp.json` | Add `erfana-graph` server entry (when M1 is built) |
| Source/derived convention | `.erfana/settings.json` | Add `sourceDocuments` config section |
| Grounding panel | `src/renderer/src/components/Panels/` | New `GroundingPanel.tsx` (Spec F) |

### Spec directories (to be created via managing-specs skill)

| Spec | Directory |
|------|-----------|
| Spec A | `specs/spec-t3-{id}-grounded-generation-pipeline/` |
| Spec B | `specs/spec-t3-{id}-claim-verification/` |
| Spec C | `specs/spec-t3-{id}-interview-transcript-structuring/` |
| Spec D | `specs/spec-t3-{id}-source-document-registry/` |
| Spec E | `specs/spec-t2-{id}-mcp-tool-grounding-output/` |
| Spec F | `specs/spec-t3-{id}-grounding-quality-dashboard/` |
| Spec G | `specs/spec-t2-{id}-source-dependency-tracking/` |
| Spec H | `specs/spec-t2-{id}-export-citation-format/` |

IDs assigned sequentially from `specs/registry.json` (current max: 021).

---

## 4. Example audit project structure

A concrete reference showing what a grounding-enabled erfana project looks like.

```
my-audit-project/
+-- .erfana/
|   +-- settings.json              # sourceDocuments config
|
+-- sources/                       # Ground truth documents
|   +-- interviews/
|   |   +-- john-doe-2026-03-15.md  # type: source, authority: interview
|   |   +-- jane-smith-2026-03-17.md
|   +-- policies/
|   |   +-- access-control-v3.md    # type: source, authority: policy
|   |   +-- data-retention-v2.md
|   +-- evidence/
|       +-- screenshot-admin-panel.png
|       +-- config-export-2026-03.md # type: source, authority: note
|
+-- reports/                       # Derived documents
|   +-- audit-summary-q1-2026.md   # type: derived, derived_from: [...]
|   +-- findings-access-control.md
|
+-- working/                       # Drafts, notes (neither source nor derived)
|   +-- planning-notes.md
|   +-- topic-outline.md
|
+-- CLAUDE.md                      # Project-level instructions
```

### Example source document frontmatter

```yaml
---
title: "Access control policy v3"
type: source
authority: policy
date: 2025-11-01
author: "Security team"
audit_areas:
  - access-control
  - authentication
---
```

### Example derived document frontmatter

```yaml
---
title: "Audit findings – access control"
type: derived
derived_at: 2026-03-28T14:30:00Z
derived_from:
  - path: sources/interviews/john-doe-2026-03-15.md
    content_hash: "sha256:a1b2c3..."
  - path: sources/interviews/jane-smith-2026-03-17.md
    content_hash: "sha256:d4e5f6..."
  - path: sources/policies/access-control-v3.md
    content_hash: "sha256:789abc..."
confidence:
  confirmed: 12
  single_source: 5
  inferred: 2
---
```

---

## 5. Key decisions and rejected alternatives

Decisions made during research and validation. Recorded so Claude Code does not re-explore dead ends.

| Decision | Chosen approach | Rejected alternative | Rationale |
|----------|----------------|---------------------|-----------|
| **Source/derived mechanism** | Frontmatter `type` tag + folder convention | Separate database table | Frontmatter is portable, readable, and works with existing tools. A DB table would create a second source of truth. |
| **Entity extraction method** | LLM-based via Claude Code prompt (post-import) | Local NER model (bert-base-NER, ~400MB) | Claude Code is already present. One-time extraction doesn't need real-time performance. Saves ~400MB of native module complexity in Electron. |
| **MCP grounding architecture** | Simple composable tools + Claude Code orchestration | Single `erfana_ground_claim` orchestration tool | Claude Code is already an orchestration agent. Duplicating orchestration inside an MCP tool adds complexity without benefit. |
| **Embedding model** | bge-small-en-v1.5 (recommended), nomic-embed-text-v1.5 (premium) | all-MiniLM-L6-v2 (legacy) | MiniLM is from 2019 with 512-token context. bge-small has same dimensions (384) but better quality. nomic has 8192-token context for longer audit sections. |
| **Citation format** | `[Source: filename.md, lines X–Y]` (internal) with export transformation | Footnotes only | Inline citations are easier for Claude Code to generate and verify. Export pipeline transforms to footnotes/endnotes for deliverables. |
| **RAG necessity** | Layer 0 first (direct reading), add RAG only when needed | RAG from day one | Most audit projects fit in Claude's 200K-token context. RAG adds complexity. Validate need before building. |
| **Citations API** | Evaluate as Priority 2–3 (MCP wrapper) | Defer to Priority 4 | First-party citation support with free `cited_text` tokens is potentially the highest-impact feature. Worth prototyping early. |
| **Contradiction detection** | Content-level semantic comparison (future) | Edge-based only (current M4 spec) | Audit contradictions are content-level ("daily" vs "weekly" backups), not entity-relationship-level. Edge-based catches only structural inconsistencies. |
| **Interim RAG server** | mcp-local-rag (stopgap only) | Build native RAG first | Provides immediate value while Graph Engine is developed. But single-maintainer risk acknowledged – have fallback plan. |
| **sqlite-vec vs alternatives** | sqlite-vec (established, but alpha risk acknowledged) | sqlite-vector (sqliteai) | sqlite-vec has broader ecosystem integration and Mozilla backing. sqlite-vector is newer with zero-cost updates. Monitor both. |
