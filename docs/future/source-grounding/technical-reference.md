# Source grounding – technical reference

> Part of [Source grounding research](README.md)

---

## 1. Anthropic Citations API

Anthropic offers a **first-party Citations API** (GA on Anthropic API and Vertex AI) that provides exact source attribution:

```json
{
  "model": "claude-sonnet-4-6-20250514",
  "messages": [{ "role": "user", "content": [...] }],
  "citations": { "enabled": true }
}
```

Input document types:
- **Plain text** with `type: "document"` + `source.type: "text"`
- **PDF** with `type: "document"` + `source.type: "base64"` (native PDF support)
- **Custom content blocks** – ideal for interview transcripts where each segment is a separately citable block

**Enterprise result**: Teams report going from ~10% hallucination rate to ~0% when combining Citations API with "extract quotes first" prompting. `cited_text` tokens are free (not counted toward output).

**Limitations**:
- **NOT available in Claude Code CLI** – no native citations support
- Cannot be used with Structured Outputs (returns 400 error)
- Requires API key + per-token cost

**Options for erfana**:
1. Build an MCP server that wraps the Citations API – Claude Code calls the MCP tool, which calls the API with citations enabled
2. Wait for Claude Code to support citations natively
3. Use the prompt-based grounding approach (works today)

**This is potentially the highest-impact feature for erfana's audit use case** and should be evaluated as Priority 2–3, not deferred.

**Source**: [Anthropic Citations API docs](https://docs.anthropic.com/en/docs/build-with-claude/citations)

---

## 2. MCP RAG server comparison

| Server | Transport | Embedding | Storage | Hybrid search | Notes |
|--------|-----------|-----------|---------|---------------|-------|
| **[mcp-local-rag](https://github.com/shinpr/mcp-local-rag)** | stdio | all-MiniLM-L6-v2 (Transformers.js) | LanceDB | Yes | 186 stars, single-maintainer – stopgap only |
| **[Qdrant MCP](https://github.com/qdrant/mcp-server-qdrant)** | stdio | External (bring your own) | Qdrant | Yes | Official, ~1,300 stars, production-grade |
| **[Chroma MCP](https://github.com/chroma-core/chroma-mcp)** | stdio | Built-in | ChromaDB | No (vector only) | Official, ~524 stars |
| **[Cognee MCP](https://github.com/topoteretes/cognee)** | stdio | Configurable | Cognee | Yes (Graph-RAG) | Emerging 2026 pattern – knowledge graph + vector |
| **[docs-mcp-server](https://github.com/arabold/docs-mcp-server)** | stdio | Built-in | Local | Yes | 1,200 stars, very active (v2.1.1, March 2026) |
| **[knowledge-mcp](https://github.com/olafgeibig/knowledge-mcp)** | stdio | Configurable | LightRAG | Yes (vector + knowledge graph) | ~39 stars, requires OpenAI API key |

**2026 trend**: Graph-RAG (combining knowledge graphs with vector retrieval) is emerging as the next evolution beyond pure vector RAG. Cognee MCP and knowledge-mcp represent this pattern.

---

## 3. Architecture blueprint

### Component architecture for grounded audit generation

```
+-----------------------------------------------------------+
|                     Erfana (Electron)                      |
|  Monaco Editor | Terminal | Project tree | Related panel   |
+----------------------------+------------------------------+
                             | IPC
+----------------------------v------------------------------+
|                   Main process (Node.js)                   |
|                                                            |
|  +--------------+  +--------------+  +----------------+   |
|  | Import       |  | Graph Engine |  | MCP Server     |   |
|  | Service      |  | Service      |  | (stdio)        |   |
|  |              |  |              |  |                |   |
|  | Audio/Video  |  | SQLite+FTS5  |  | graph_search   |   |
|  | PDF/Office   |  | sqlite-vec   |  | graph_related  |   |
|  | -> Markdown  |  | ONNX workers |  | graph_entities |   |
|  +------+-------+  +------+-------+  | graph_backlinks|   |
|         |                 |          | graph_timeline |   |
|         |    FileWatcher  |          +-------+--------+   |
|         +----events-------+                  |            |
+----------------------------------------------+------------+
                                               | stdio
                                    +----------v----------+
                                    | Claude Code (PTY)    |
                                    |                      |
                                    | Audit prompt template|
                                    | -> Retrieve sources  |
                                    | -> Generate with cites|
                                    | -> Verify claims     |
                                    +----------------------+
```

### Fully local deployment stack

| Component | Recommended | Alternative |
|-----------|------------|-------------|
| LLM | Claude Code (via Anthropic) | Ollama for offline use |
| Embeddings | bge-small-en-v1.5 (ONNX) | nomic-embed-text-v1.5, all-MiniLM-L6-v2 |
| Vector DB | SQLite + sqlite-vec (erfana native) | ChromaDB, pgvector |
| Full-text search | SQLite FTS5 (erfana native) | – |
| Document parsing | PyMuPDF + LiteParse (erfana planned) | Unstructured |
| Frontend | Erfana (already built) | – |

---

## 4. Technical risks and constraints

| Risk | Severity | Details |
|------|----------|---------|
| **sqlite-vec is alpha** | Medium | Still v0.1.x, no ANN indexing yet. A newer alternative, sqlite-vector (sqliteai), uses BLOB columns with zero-cost updates. sqlite-vec remains more established but its alpha status is a risk for audit-grade tooling. |
| **Transformers.js + Electron** | Medium | Documented issues: Electron forces CPU-only ONNX Runtime ([issue #1240](https://github.com/huggingface/transformers.js/issues/1240)), native module resolution errors ([issue #895](https://github.com/huggingface/transformers.js/issues/895)). Pin specific versions of both Transformers.js and onnxruntime. |
| **Memory budget** | Medium | ONNX Runtime (~50–100MB resident) + model weights + SQLite + Electron + Claude Code on 16GB machine. Embedding subsystem needs a defined memory budget and graceful degradation. |
| **Cold start** | Low | ONNX model loading takes 1–3s on CPU. Decision needed: load at app start (slower startup) or lazily on first query (slower first search). |
| **Index size** | Low | 10K sections x 384 dims x 4 bytes ~ 15MB vectors. 100K sections ~ 150MB. FTS5 adds ~50–100% of source text. Total index for large projects: 500MB–1GB. |
| **Cross-platform** | Medium | Native `.node` modules for ONNX/sqlite-vec require platform-specific binaries (macOS ARM64/x64, Windows, Linux). electron-rebuild needed. ASAR packaging constraints. |
| **mcp-local-rag reliability** | Medium | Single-maintainer, 186 stars. Use as stopgap only with a fallback plan. |
| **Citation accuracy** | High | ALCE benchmark shows even best models lack complete citation support 50% of the time. The verify step uses the same fallible LLM – consider CaLM-style cross-model verification. |

---

## 5. Recommendations

### Priority 1 – Immediate (this week)

1. **Formalize source/derived document distinction** – define frontmatter convention (`type: source` / `type: derived`) or folder structure (`sources/`)
2. **Create `audit-summary` prompt template** – enforce citation rules in Claude Code's generation
3. **Create `verify-claims` prompt template** – post-generation verification loop
4. **Test Layer 0 workflow** – Claude Code reading source files directly with citation rules; validate whether RAG is needed for typical project sizes
5. **Add `mcp-local-rag`** only if Layer 0 retrieval proves insufficient

### Priority 2 – Short-term (with Graph Engine M1–M2)

6. **Evaluate and prototype Citations API MCP wrapper** – highest-impact grounding feature; build MCP server wrapping the API with `citations.enabled=true`
7. **Prioritize M1 + M2 implementation** – add `full_text`, `start_line`/`end_line`, `sources_only` filter to search results
8. **Add query-based vector search to M2** – allow searching by concept text, not just section ID
9. **Upgrade embedding model** to bge-small-en-v1.5 or nomic-embed-text-v1.5

### Priority 3 – Medium-term (with Graph Engine M3–M4)

10. **Implement interview transcript structuring** – post-import prompt template for speaker identification and topic segmentation
11. **Build "who said what" queries** – `topic_filter` on `erfana_graph_backlinks`; let Claude Code orchestrate composite queries
12. **Build cross-interview contradiction detection** – content-level semantic comparison, not just edge-based

### Priority 4 – Optional

13. **Grounding quality dashboard** – UI panel showing grounding metrics
14. **Source document registry** with authority hierarchy
15. **Podcast generation** – if audio summaries are useful for audit briefings

---

## Appendix A: Audio/podcast generation (for reference)

This section covers NotebookLM's audio capabilities and open-source alternatives. These are not directly relevant to erfana's audit document use case but are included for completeness.

### NotebookLM's audio pipeline

| Stage | Model | Function |
|-------|-------|----------|
| 1. Script generation | Gemini | Generates annotated conversational dialogue between two speakers |
| 2. Text-to-semantic | SPEAR-TTS | Converts transcript to semantic tokens |
| 3. Semantic-to-acoustic | **SoundStorm** | Parallel generation (100x faster than autoregressive). [arXiv:2305.09636](https://arxiv.org/abs/2305.09636) |
| 4. Audio synthesis | SoundStream decoder | Produces final waveform audio |

### Key papers

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **AudioLM** (Google) | IEEE/ACM TASLP 2023 | Audio generation as language modeling. [arXiv:2209.03143](https://arxiv.org/abs/2209.03143) |
| **SoundStorm** (Google) | 2023 | Non-autoregressive parallel decoding – 30s audio in 0.5s. [arXiv:2305.09636](https://arxiv.org/abs/2305.09636) |
| **VALL-E** (Microsoft) | 2023 | Zero-shot voice cloning from 3 seconds. [arXiv:2301.02111](https://arxiv.org/abs/2301.02111) |
| **VoiceCraft** | ACL 2024 | Podcast-style speech. [arXiv:2403.16973](https://arxiv.org/abs/2403.16973) |
| **PodAgent** | ACL 2025 Findings | Multi-agent podcast generation. [arXiv:2503.00455](https://arxiv.org/abs/2503.00455) |
| **PaperWave** | CHI 2025 EA | Research papers to podcasts. [arXiv:2410.15023](https://arxiv.org/abs/2410.15023) |

### Podcast tools

| Project | Stars | Key strength |
|---------|-------|-------------|
| [Podcastfy](https://github.com/souzatharsis/podcastfy) | 6.2k | 100+ LLMs, 4 TTS providers, pip-installable |
| [Mozilla Document-to-Podcast](https://github.com/mozilla-ai/document-to-podcast) | 173 | CPU-only, 8GB RAM, no API keys |
| [Local-NotebookLM](https://github.com/Goekdeniz-Guelmez/Local-NotebookLM) | 811 | 16 output formats |

### TTS models (2026)

| Model | Size | Notes |
|-------|------|-------|
| Qwen3-TTS | 0.6–1.7B | Most adopted open-source TTS |
| VibeVoice (Microsoft) | – | 90 min continuous multi-speaker |
| Kokoro-82M | 82M | Tiny, CPU-friendly |

---

## Appendix B: Key sources

### Google NotebookLM
- [Google Blog – developing NotebookLM](https://blog.google/innovation-and-ai/products/developing-notebooklm/)
- [Google DeepMind podcast – inside NotebookLM](https://deepmind.google/discover/the-podcast/inside-notebooklm-with-raiza-martin-and-steven-johnson/)
- [DEV Community – technical deep-dive](https://dev.to/jubinsoni/architecting-the-future-of-research-a-technical-deep-dive-into-notebooklm-and-gemini-integration-m60)
- [arXiv:2504.09720 – NotebookLM RAG analysis](https://arxiv.org/abs/2504.09720)
- [Google DeepMind – Pushing the frontiers of audio generation](https://deepmind.google/blog/pushing-the-frontiers-of-audio-generation/)

### Open-source alternatives
- [Open Notebook](https://github.com/lfnovo/open-notebook) – 21.5k stars, MIT
- [SurfSense](https://github.com/MODSetter/SurfSense) – 13.6k stars, Apache 2.0
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) – 54k+ stars, easiest start

### MCP RAG servers
- [mcp-local-rag](https://github.com/shinpr/mcp-local-rag) – zero-setup stopgap
- [Qdrant MCP](https://github.com/qdrant/mcp-server-qdrant) – official, production-grade
- [Chroma MCP](https://github.com/chroma-core/chroma-mcp) – official
- [Cognee MCP](https://github.com/topoteretes/cognee) – Graph-RAG
- [docs-mcp-server](https://github.com/arabold/docs-mcp-server) – 1,200 stars, very active

### Anthropic
- [Citations API docs](https://docs.anthropic.com/en/docs/build-with-claude/citations)
- [Reducing hallucinations guide](https://docs.anthropic.com/en/docs/build-with-claude/reduce-hallucinations)
- [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)

### Tutorials
- [Mozilla AI – documents to podcasts locally](https://blog.mozilla.ai/blueprint-deep-dive-turn-documents-into-podcasts-locally-with-open-source-ai/)
- [Together AI – open source NotebookLM PDF to podcast](https://docs.together.ai/docs/open-notebooklm-pdf-to-podcast)
- [The New Stack – deploy open source NotebookLM](https://thenewstack.io/how-to-deploy-an-open-source-version-of-notebooklm/)

---

## Validation

**Date**: 2026-03-28
**Reviewers**: Solution architect, technical architect, online research agent, paper verification agent

**Key corrections applied**:
- Fixed paper #5 author attribution (Gupta et al., not Huang et al.)
- Added INT8 quantization qualifier to embedding model size
- Added source/derived document paradigm as foundational concept
- Added Layer 0 analysis – direct file reading may suffice for most projects
- Upgraded embedding model recommendations (bge-small-en-v1.5 recommended, nomic-embed-text-v1.5 as premium)
- Added technical risks section (sqlite-vec alpha, Electron+ONNX issues, memory/storage)
- Added 7 newly discovered papers (GINGER, AGREE, CaLM, FACTS Grounding, Contextual Retrieval, Late Chunking, audit procedure generation)
- Added 2 newly discovered MCP servers (Cognee MCP, docs-mcp-server update)
- Added export citation format and generated document versioning sections
- Restructured priorities: source/derived distinction first, Layer 0 validation before RAG investment
- Elevated Citations API from Priority 4 to Priority 2
- Moved audio/podcast content to Appendix A
