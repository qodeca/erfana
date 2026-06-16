# Source grounding – strategy and pipeline design

> Part of [Source grounding research](README.md)

---

## 1. Erfana integration analysis

### What already exists

| NotebookLM capability | Erfana equivalent | Status |
|----------------------|-------------------|--------|
| Document ingestion (PDF, audio, video, web) | Import system (converters) | **Implemented** |
| Audio/video transcription | TranscriptionService (OpenAI + local whisper) | **Implemented** |
| Prompt templates with file context | 14 templates with `{{fileRef}}`, `{{selectedText}}` | **Implemented** |
| Terminal integration for Claude Code | xterm.js PTY with Claude Code optimizations | **Implemented** |
| 12 Claude Code agents | `.claude/agents/` (bug-investigator, code-reviewer, etc.) | **Implemented** |
| MCP server infrastructure | `.mcp.json` with circuit-electron, time | **Implemented** |

### What the Graph Engine specs cover

| Milestone | Spec | Deliverable | Audit grounding value |
|-----------|------|-------------|----------------------|
| M1 | T4-004 | FTS5 + BM25 keyword search, related sidebar, MCP tools | Find specific terms across all transcripts |
| M2 | T3-005 | sqlite-vec + ONNX embeddings, hybrid search | Semantic search – find themes even without exact keywords |
| M3 | T3-006 | Entity extraction, backlinks, knowledge panel | "Who said what" – person/topic attribution |
| M4 | T3-007 | Temporal queries, change tracking, contradiction detection | Flag conflicting statements across interviews |
| M5 | T3-008 | Visualization, reindexing UX, quantization | Production polish |

### What's missing

1. **No source/derived document distinction** – all files treated identically (see [README section 2](README.md#2-the-sourcederived-document-paradigm))
2. **No grounded generation workflow** – the pipeline from "retrieve" -> "generate with citations" -> "verify claims" is not designed
3. **No audit-specific prompt templates** – current templates are generic (explain, modify, ask, visualize)
4. **No citation format standard** – no convention for source references in generated documents
5. **Graph Engine not yet built** – all 5 milestones are in draft/spec status
6. **No query-based vector search** in M2 spec – only section-ID-based similarity
7. **No composite entity+topic queries** in M3 spec

---

## 2. Layer 0 – does erfana even need RAG?

Before investing in RAG infrastructure, consider that Claude Code **already has powerful file access tools**:

- **Read**: read any file in the project
- **Grep**: search file contents by regex
- **Glob**: find files by pattern
- **200K-token context window**: holds ~150 pages / ~30–40 interview transcripts

### Layered approach

| Layer | Infrastructure needed | When it adds value |
|-------|----------------------|-------------------|
| **Layer 0** | Prompt templates + direct file reading | Works today. Sufficient when corpus is <100K tokens (~75 pages) and the user knows which files to reference |
| **Layer 1** | FTS5 keyword search (M1) | Helps when you don't know which file contains a term. Useful for 50+ source files |
| **Layer 2** | Vector embeddings (M2) | Concept-based retrieval when keywords are insufficient. Useful for 100+ files or domain-specific language |
| **Layer 3** | Entity extraction + temporal (M3–M4) | "Who said what" attribution across many interviews. Contradiction detection. Useful for complex multi-interview projects |

### Recommendation

**Validate Layer 0 first.** Most audit projects have 10–30 interview transcripts and 20–50 policy documents. Total content is typically 50K–150K tokens. At this scale, Claude Code reading files directly with well-designed prompt templates may be sufficient for grounded document generation.

**Break-even heuristic**: If total source content exceeds ~100K tokens (~75 pages), introduce Layer 1 (keyword search). If concept-based retrieval is needed, add Layer 2. Add Layer 3 only for complex multi-interview attribution.

---

## 3. Two-track strategy

### Track A – Immediate (days, not weeks)

If Layer 0 proves insufficient, use an **existing MCP RAG server** as a stopgap before the Graph Engine is built.

**Candidate: `mcp-local-rag`** ([shinpr/mcp-local-rag](https://github.com/shinpr/mcp-local-rag)):
- Zero setup: `npx mcp-local-rag`
- Uses Transformers.js + all-MiniLM-L6-v2
- LanceDB for vector storage, fully private
- Hybrid semantic + keyword search
- **Caveat**: single-maintainer project, 186 stars – stopgap only, have a fallback plan

Add to erfana's `.mcp.json`:
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["mcp-local-rag", "--dir", "."],
      "env": {}
    }
  }
}
```

### Track B – Planned (Graph Engine milestones)

Priority adjustments for audit grounding:

| Milestone | Original focus | Audit-grounding additions |
|-----------|---------------|--------------------------|
| M1 | FTS5 + BM25 search | Add: `full_text`, `start_line`/`end_line` in results; `sources_only` filter |
| M2 | Vector similarity | Add: free-text query parameter; upgrade embedding model |
| M3 | Entity extraction | Add: `topic_filter` on backlinks; LLM-based extraction for transcripts |
| M4 | Temporal queries | Add: content-level contradiction detection |

---

## 4. Grounded audit document generation pipeline

### The full workflow

```
Step 1: DESIGNATE SOURCES
  User marks files as source documents (frontmatter, folder, or registry)
  System distinguishes source (ground truth) from derived (generated)

Step 2: INGEST
  Interview recordings -> TranscriptionService -> markdown transcripts
  Source documents (PDF, DOCX) -> Import converters -> markdown
  All files stored in project directory with YAML frontmatter

Step 3: INDEX (Graph Engine or MCP RAG server)
  FileWatcher detects new/changed files
  -> FTS5 indexes text (keyword search)
  -> ONNX embeds chunks (semantic search)
  -> Entity extraction: persons, topics, decisions, dates

Step 4: RETRIEVE (MCP tools or direct file reading)
  User: "Prepare audit summary for Topic X"
  -> erfana_graph_search({ query: "Topic X", sources_only: true })
  -> erfana_graph_related({ section_id: ..., sources_only: true })
  Returns: ranked passages with file paths, section headings, exact text

Step 5: GENERATE (Claude Code with grounding prompt)
  System prompt enforces:
  - Every claim MUST have a [source] citation
  - Use ONLY information from designated source documents
  - When information is absent, say "not covered in interviews"
  - Extract verbatim quotes before synthesizing

Step 6: VERIFY (post-generation claim check)
  For each claim in the generated document:
  -> Search corpus for supporting evidence
  -> Flag unsupported claims
  -> Mark confidence level (verbatim quote vs. inferred)
  -> Retract or qualify claims without sufficient support
```

### Source citation format

For audit documents, citations should trace to:
```markdown
[Source: interview-john-doe-2026-03-15.md, lines 45–67]
[Source: policy-document-v3.pdf, section 2.4]
[Source: risk-assessment-q1.md, "verbatim quote here"]
```

This leverages erfana's existing frontmatter metadata (`source`, `type`, `date`) for traceability.

---

## 5. Prompt template designs

### Audit summary template

A new prompt template for erfana's prompt system (`src/renderer/src/prompts/templates/`):

```yaml
---
name: audit-summary
area: document
subArea: audit
icon: FileCheck
targetPanel: terminal
autoExecute: true
---
```

**Grounding rules** (enforced in prompt):

1. **Source-only generation**: Use ONLY information from designated source documents. Do not add knowledge from training data.
2. **Citation required**: Every factual claim MUST include a source citation: `[Source: filename.md, lines X–Y]` or `[Source: filename.md, "verbatim quote"]`
3. **Verbatim-first**: Before synthesizing a finding, extract the exact quote from the source document. Include it as a blockquote, then summarize.
4. **Absence acknowledgment**: If a topic was not covered, explicitly state: "This topic was not addressed in the reviewed materials."
5. **Contradiction flagging**: If sources disagree, present both positions with their respective citations.
6. **Confidence levels**:
   - **Confirmed**: Supported by 2+ independent sources
   - **Single source**: Supported by 1 source only
   - **Inferred**: Not directly stated, interpretation of available data

**Output structure**: Executive summary -> Detailed findings (with citations) -> Gaps and limitations -> Contradictions -> Recommendations

### Verify-claims template

```yaml
---
name: verify-claims
area: document
subArea: audit
icon: ShieldCheck
targetPanel: terminal
autoExecute: true
---
```

Reviews a generated audit document for grounding accuracy. For each factual claim:
1. Search corpus for the cited source using MCP graph tools or direct file reading
2. Verify the claim matches the source content
3. Check that the citation (file, lines) is accurate
4. Flag: claims without citations, citations that don't support the claim, misquotes, claims from LLM training data

See **CaLM** (ACL 2024 Findings, [arXiv:2406.05365](https://arxiv.org/abs/2406.05365)) – proposes using a smaller model to verify a larger model's output via contrastive checking. This could inform a two-model verification approach.

---

## 6. Export citation format

Internal citations (`[Source: file.md, lines 45–67]`) reference file paths and line numbers – these are meaningless in external deliverables shared with stakeholders.

**External format**: `[Source: "Access Control Policy v3", section 2.4]` – references document titles and section headings.

The export pipeline (PdfService, DocxService) should transform internal -> external citations using frontmatter metadata (`title`, `source` fields). Footnote or endnote formatting should be configurable per export.

---

## 7. Generated document versioning

Generated audit summaries should include frontmatter recording their provenance:

```yaml
---
type: derived
generated_at: 2026-03-28T14:30:00Z
sources:
  - path: interviews/john-doe-2026-03-15.md
    content_hash: sha256:abc123...
  - path: policies/access-control-v3.md
    content_hash: sha256:def456...
retrieval_queries:
  - "access control audit findings"
  - "data retention policy compliance"
---
```

This enables **staleness detection**: when a source file changes after a derived document was generated, the system can flag the derived document as potentially outdated.
