# NotebookLM-style source grounding for erfana

Research document – comprehensive analysis of how to integrate NotebookLM-like source grounding into erfana for hallucination-free audit document generation.

**Date**: 2026-03-28
**Author**: Research compiled via Claude Code
**Status**: Research complete, implementation pending

---

## Table of contents

1. [Problem statement](#1-problem-statement)
2. [How Google NotebookLM works](#2-how-google-notebooklm-works)
3. [Open-source alternatives landscape](#3-open-source-alternatives-landscape)
4. [Scientific papers – reading list](#4-scientific-papers--reading-list)
5. [Erfana integration analysis](#5-erfana-integration-analysis)
6. [Two-track strategy](#6-two-track-strategy)
7. [Grounded audit document generation pipeline](#7-grounded-audit-document-generation-pipeline)
8. [Prompt template designs](#8-prompt-template-designs)
9. [Anthropic Citations API](#9-anthropic-citations-api)
10. [MCP RAG server comparison](#10-mcp-rag-server-comparison)
11. [Architecture blueprint](#11-architecture-blueprint)
12. [Recommendations](#12-recommendations)

---

## 1. Problem statement

When preparing audit summary documents from interview transcripts and source documents, Claude Code must **ground every claim in specific source passages** and never hallucinate facts. This requires:

- Semantic search across all project files (transcripts, policies, evidence)
- Citation of exact source passages for every factual claim
- Contradiction detection across interviews
- "Who said what about which topic" attribution
- Post-generation verification that claims match sources

---

## 2. How Google NotebookLM works

### Architecture – "source grounding" vs traditional RAG

NotebookLM (originally "Project Tailwind", 2023) uses what Google calls **"source grounding"** rather than traditional RAG. The key enabler is **Gemini's massive context window** (up to 2M tokens with Mixture-of-Experts architecture):

| Aspect | Traditional RAG | NotebookLM |
|--------|----------------|------------|
| Document processing | Aggressive chunking (~256–512 tokens) | Full documents ingested via long context |
| Storage | Vector DB with embeddings | Native long-context processing |
| Retrieval | Top-K similarity search | Cross-document analysis in single pass |
| Structure | Lost during chunking | Preserved (headers, tables, lists) |

For larger corpora exceeding context limits, it falls back to **vector-based retrieval** – making it a **hybrid approach**. An academic analysis (arXiv:2504.09720) confirms the system uses vector embeddings and similarity search when the corpus is too large.

### Document processing pipeline

1. Text extraction preserving formatting
2. Structure identification (headers, tables, lists)
3. Multi-layer representation (semantic embeddings + keyword indices + structural metadata)
4. Embedding via proprietary Gemini embedding model
5. Every response includes **explicit citations** back to source passages

### Audio overview (podcast generation) – 4-stage pipeline

| Stage | Model | Function |
|-------|-------|----------|
| 1. Script generation | Gemini | Generates annotated conversational dialogue between two speakers |
| 2. Text-to-semantic | SPEAR-TTS | Converts transcript to semantic tokens capturing meaning |
| 3. Semantic-to-acoustic | **SoundStorm** | Parallel generation of acoustic tokens (100x faster than autoregressive) |
| 4. Audio synthesis | SoundStream decoder | Produces final waveform audio |

Performance: 2 minutes of dialogue in under 3 seconds on TPU v5e.

### Key Google Research papers

| Paper | Year | Contribution |
|-------|------|-------------|
| SoundStream | 2021 | Neural audio codec with RVQ |
| AudioLM | 2022 | Audio generation as language modeling |
| SoundStorm | 2023 | Parallel decoding via MaskGIT – [arXiv:2305.09636](https://arxiv.org/abs/2305.09636) |
| AudioPaLM | 2023 | Speech understanding and generation |
| NotebookLM as Socratic tutor | 2025 | RAG architecture analysis – [arXiv:2504.09720](https://arxiv.org/abs/2504.09720) |

**Sources**:
- [Google Blog – How Googlers developed NotebookLM](https://blog.google/innovation-and-ai/products/developing-notebooklm/)
- [Google DeepMind – Inside NotebookLM](https://deepmind.google/discover/the-podcast/inside-notebooklm-with-raiza-martin-and-steven-johnson/)
- [DEV Community – Technical deep-dive](https://dev.to/jubinsoni/architecting-the-future-of-research-a-technical-deep-dive-into-notebooklm-and-gemini-integration-m60)
- [Google DeepMind – Pushing the frontiers of audio generation](https://deepmind.google/blog/pushing-the-frontiers-of-audio-generation/)

---

## 3. Open-source alternatives landscape

### Full-featured NotebookLM alternatives

| Project | Stars | License | Stack | Key features |
|---------|-------|---------|-------|--------------|
| [Open Notebook](https://github.com/lfnovo/open-notebook) | 21.5k | MIT | Python/FastAPI + Next.js, SurrealDB, LangChain | Podcast gen, RAG chat, 16+ AI providers, Ollama for fully local |
| [SurfSense](https://github.com/MODSetter/SurfSense) | 13.6k | Apache 2.0 | FastAPI + Next.js, PostgreSQL/pgvector | 25+ connectors (Slack, Notion, GitHub), RBAC, team collaboration |
| [Khoj](https://github.com/khoj-ai/khoj) | 33.7k | AGPL-3.0 | Python | YC-backed, multi-platform, custom agents |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | 54k+ | MIT | Desktop app | Built-in LLM engine, 30+ providers, easiest setup |
| [Open-NotebookLM (OpenDCAI)](https://github.com/OpenDCAI/Open-NotebookLM) | ~50 | Apache 2.0 | Python | PPTs, mind maps, diagrams, podcasts, flashcards – closest feature parity |
| [RAGFlow](https://github.com/infiniflow/ragflow) | 76.4k | Apache 2.0 | Python | Visual pipeline builder, deep document understanding |

### Podcast-specific tools

| Project | Stars | Key strength |
|---------|-------|-------------|
| [Podcastfy](https://github.com/souzatharsis/podcastfy) | 6.2k | Best library – 100+ LLMs, 4 TTS providers, pip-installable |
| [Mozilla Document-to-Podcast](https://github.com/mozilla-ai/document-to-podcast) | 173 | CPU-only, 8GB RAM, no API keys (llama.cpp + Kokoro-82M TTS) |
| [open-notebooklm (gabrielchua)](https://github.com/gabrielchua/open-notebooklm) | 2.2k | Gradio UI, HuggingFace Spaces demo |
| [Local-NotebookLM](https://github.com/Goekdeniz-Guelmez/Local-NotebookLM) | 811 | 16 output formats (podcast, debate, lecture, etc.) |

### Best TTS models for local use (2026)

| Model | License | Size | Notes |
|-------|---------|------|-------|
| Qwen3-TTS | Apache 2.0 | 0.6–1.7B | Most adopted open-source TTS |
| VibeVoice (Microsoft) | – | – | 90 min continuous multi-speaker |
| Kokoro-82M | – | 82M | Tiny, CPU-friendly |
| Fish Speech V1.5 | – | – | High quality |
| CosyVoice2-0.5B | – | 500M | High quality |

### RAG framework comparison

| Framework | Stars | Best for | Latency |
|-----------|-------|----------|---------|
| LlamaIndex | 40k+ | Pure RAG, document Q&A | ~6ms |
| LangChain | 100k+ | Complex agents, rapid prototyping | Higher |
| Haystack | ~18k | Production pipelines, efficiency | ~5.9ms |
| RAGFlow | 76.4k | Visual/no-code, deep doc understanding | – |

---

## 4. Scientific papers – reading list

### RAG foundations

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **Lewis et al. – RAG for Knowledge-Intensive NLP** | 2020 | Foundational RAG paper – combining parametric + non-parametric memory. [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) |
| **Self-RAG** (Asai et al.) | ICLR 2024 | LM learns *when* to retrieve and self-critiques via reflection tokens. Outperforms ChatGPT on QA. [arXiv:2310.11511](https://arxiv.org/abs/2310.11511) |
| **RAPTOR** (Sarthi et al.) | ICLR 2024 | Hierarchical tree of recursive summaries for multi-level retrieval. +20% on QuALITY benchmark. [arXiv:2401.18059](https://arxiv.org/abs/2401.18059) |
| **RAG survey** (Gao et al.) | 2023 | Taxonomises Naive, Advanced, and Modular RAG paradigms. [arXiv:2312.10997](https://arxiv.org/abs/2312.10997) |
| **RAG survey** (Huang et al.) | 2024 | Updated comprehensive survey. [arXiv:2410.12837](https://arxiv.org/abs/2410.12837) |
| **ColBERT** (Khattab & Zaharia) | 2020 | Late-interaction retrieval – 2 orders of magnitude faster than cross-encoders. [arXiv:2004.12832](https://arxiv.org/abs/2004.12832) |

**Advanced RAG techniques**: Hybrid search (BM25 + dense vectors via Reciprocal Rank Fusion) yields 15–30% retrieval improvement; query decomposition and multi-hop retrieval address complex reasoning chains.

### Citation and attribution

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **ALCE** (Princeton) | EMNLP 2023 | Citation evaluation benchmark – even best models lack complete citation support 50% of the time. [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) |
| **"Attribute First, then Generate"** | ACL 2024 | Selects source segments before generating text. [arXiv:2403.17104](https://arxiv.org/abs/2403.17104) |
| **ReClaim** | 2024 | Interleaves references and claims sentence-by-sentence |
| **MTRAG** | TACL 2025 | Multi-turn conversational RAG benchmark – reveals SOTA systems struggle on later turns and unanswerable questions. [arXiv:2501.03468](https://arxiv.org/abs/2501.03468) |

### Document understanding

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **ColPali** (Faysse et al.) | ICLR 2025 | Vision language model generating multi-vector embeddings from document page images – bypasses OCR entirely. [arXiv:2407.01449](https://arxiv.org/abs/2407.01449) |
| **LayoutLMv3** (Huang et al.) | ACM MM 2022 | Unified text + image masking with word-patch alignment. SOTA on form understanding, document VQA. [arXiv:2204.08387](https://arxiv.org/abs/2204.08387) |
| **DocLLM** | ACL 2024 | Layout-aware generative LLM with disentangled spatial attention |
| **DocLayLLM** | CVPR 2025 | Efficient multi-modal document AI |

### Audio/podcast generation

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **AudioLM** (Google) | 2022/2023 | Audio generation as language modeling over discrete tokens. [arXiv:2209.03143](https://arxiv.org/abs/2209.03143) |
| **SoundStorm** (Google) | 2023 | Non-autoregressive parallel decoding – 30s audio in 0.5s. [arXiv:2305.09636](https://arxiv.org/abs/2305.09636) |
| **VALL-E** (Microsoft) | 2023 | Zero-shot voice cloning from 3 seconds of audio. [arXiv:2301.02111](https://arxiv.org/abs/2301.02111) |
| **VoiceCraft** | ACL 2024 | Excels at in-the-wild speech including podcasts. [arXiv:2403.16973](https://arxiv.org/abs/2403.16973) |
| **PodAgent** | ACL 2025 | Multi-agent podcast generation – 87.4% voice-matching accuracy. [arXiv:2503.00455](https://arxiv.org/abs/2503.00455) |
| **PaperWave** | 2024 | Converting research papers to conversational podcasts. [arXiv:2410.15023](https://arxiv.org/abs/2410.15023) |

### Embedding models for local/Electron use

| Model | Size | Dimensions | Notes |
|-------|------|-----------|-------|
| all-MiniLM-L6-v2 | 23MB ONNX | 384 | Production-validated, erfana's planned choice |
| nomic-embed-text-v1.5 | 40MB INT4 | 64–768 variable | Outperforms OpenAI Ada-002 |
| EmbeddingGemma | <200MB quantized | – | 100+ languages, designed for on-device |

---

## 5. Erfana integration analysis

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

1. **No grounded generation workflow** – the pipeline from "retrieve relevant passages" → "generate summary with citations" → "verify claims against sources" is not designed
2. **No audit-specific prompt templates** – current templates are generic (explain, modify, ask, visualize)
3. **No citation format standard** – no convention for how citations reference source passages in generated documents
4. **Graph Engine not yet built** – all 5 milestones are in draft/spec status
5. **No query-based vector search** in M2 spec – only section-ID-based similarity, no "search by concept text"
6. **No composite entity+topic queries** in M3 spec – can't do "what did Person X say about Topic Y" in one call

---

## 6. Two-track strategy

### Track A – Immediate (days, not weeks)

Use an **existing MCP RAG server** to give Claude Code grounded access to project files right now, before the Graph Engine is built.

**Recommended: `mcp-local-rag`** ([shinpr/mcp-local-rag](https://github.com/shinpr/mcp-local-rag)):
- Zero setup: `npx mcp-local-rag`
- Uses Transformers.js + **all-MiniLM-L6-v2** (same model erfana's Graph Engine M2 plans to use)
- LanceDB for vector storage, fully private
- Hybrid semantic + keyword search
- No API keys needed

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
| M1 | FTS5 + BM25 search | Add: citation-aware search – return exact text spans, not just snippets |
| M2 | Vector similarity | Add: query-based vector search – search by concept text, not just section ID |
| M3 | Entity extraction | Add: person/topic composite queries – "who said what about which topic" |
| M4 | Temporal queries | Add: cross-interview contradiction detection – flag conflicting statements |

---

## 7. Grounded audit document generation pipeline

### The full workflow

```
Step 1: INGEST
  Interview recordings → TranscriptionService → markdown transcripts
  Source documents (PDF, DOCX) → Import converters → markdown
  All files stored in project directory with YAML frontmatter

Step 2: INDEX (Graph Engine or MCP RAG server)
  FileWatcher detects new/changed files
  → FTS5 indexes text (keyword search)
  → ONNX embeds chunks (semantic search)
  → Entity extraction: persons, topics, decisions, dates

Step 3: RETRIEVE (MCP tools, invoked by Claude Code)
  User: "Prepare audit summary for Topic X"
  → erfana_graph_search({ query: "Topic X" })
  → erfana_graph_related({ section_id: ... })
  → erfana_graph_backlinks({ entity_name: "Person Y" })
  Returns: ranked passages with file paths, section headings, exact text

Step 4: GENERATE (Claude Code with grounding prompt)
  System prompt enforces:
  - Every claim MUST have a [source] citation
  - Use ONLY information from retrieved passages
  - When information is absent, say "not covered in interviews"
  - Extract verbatim quotes before synthesizing

Step 5: VERIFY (post-generation claim check)
  For each claim in the generated document:
  → Search corpus for supporting evidence
  → Flag unsupported claims
  → Mark confidence level (verbatim quote vs. inferred)
  → Retract or qualify claims without sufficient support
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

## 8. Prompt template designs

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

1. **Source-only generation**: Use ONLY information from the project files. Do not add knowledge from training data.
2. **Citation required**: Every factual claim MUST include a source citation: `[Source: filename.md, lines X–Y]` or `[Source: filename.md, "verbatim quote"]`
3. **Verbatim-first**: Before synthesizing a finding, extract the exact quote from the source document. Include it as a blockquote, then summarize.
4. **Absence acknowledgment**: If a topic was not covered, explicitly state: "This topic was not addressed in the reviewed materials."
5. **Contradiction flagging**: If sources disagree, present both positions with their respective citations.
6. **Confidence levels**:
   - 🟢 **Confirmed**: Supported by 2+ independent sources
   - 🟡 **Single source**: Supported by 1 source only
   - 🔴 **Inferred**: Not directly stated, interpretation of available data

**Output structure**: Executive summary → Detailed findings (with citations) → Gaps and limitations → Contradictions → Recommendations

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
1. Search corpus for the cited source using MCP graph tools
2. Verify the claim matches the source content
3. Check that the citation (file, lines) is accurate
4. Flag: claims without citations, citations that don't support the claim, misquotes, claims from LLM training data

---

## 9. Anthropic Citations API

Anthropic offers a **first-party Citations API** that provides exact source attribution:

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

**Enterprise result**: Teams report going from ~10% hallucination rate to ~0% when combining Citations API with "extract quotes first" prompting.

**Limitation**: This is an API feature, not directly available in Claude Code CLI. Options:
1. Build an MCP server that wraps the Citations API
2. Wait for Claude Code to support citations natively
3. Use the prompt-based grounding approach (works today)

**Source**: [Anthropic Citations API docs](https://docs.anthropic.com/en/docs/build-with-claude/citations)

---

## 10. MCP RAG server comparison

| Server | Transport | Embedding | Storage | Hybrid search | Notes |
|--------|-----------|-----------|---------|---------------|-------|
| **[mcp-local-rag](https://github.com/shinpr/mcp-local-rag)** | stdio | all-MiniLM-L6-v2 (Transformers.js) | LanceDB | Yes | **Recommended** – same model as erfana M2 |
| **[Qdrant MCP](https://github.com/qdrant/mcp-server-qdrant)** | stdio | External (bring your own) | Qdrant | Yes | Official, production-grade |
| **[Chroma MCP](https://github.com/chroma-core/chroma-mcp)** | stdio | Built-in | ChromaDB | No (vector only) | Official, simple |
| **[knowledge-mcp](https://github.com/olafgeibig/knowledge-mcp)** | stdio | Configurable | LightRAG | Yes (vector + knowledge graph) | Most sophisticated |
| **[docs-mcp-server](https://github.com/arabold/docs-mcp-server)** | stdio | Built-in | Local | Yes | Alternative to Context7 |

---

## 11. Architecture blueprint

### Component architecture for grounded audit generation

```
┌─────────────────────────────────────────────────────────┐
│                     ERFANA (Electron)                    │
│  Monaco Editor │ Terminal │ Project tree │ Related panel  │
└────────────────────────┬────────────────────────────────┘
                         │ IPC
┌────────────────────────▼────────────────────────────────┐
│                   Main process (Node.js)                  │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Import       │  │ Graph Engine │  │ MCP Server     │ │
│  │ Service      │  │ Service      │  │ (stdio)        │ │
│  │              │  │              │  │                │ │
│  │ Audio/Video  │  │ SQLite+FTS5  │  │ graph_search   │ │
│  │ PDF/Office   │  │ sqlite-vec   │  │ graph_related  │ │
│  │ → Markdown   │  │ ONNX workers │  │ graph_entities │ │
│  └──────┬───────┘  └──────┬───────┘  │ graph_backlinks│ │
│         │                 │          │ graph_timeline │ │
│         │    FileWatcher  │          └───────┬────────┘ │
│         └────────events───┘                  │          │
└──────────────────────────────────────────────┼──────────┘
                                               │ stdio
                                    ┌──────────▼──────────┐
                                    │ Claude Code (PTY)    │
                                    │                      │
                                    │ Audit prompt template│
                                    │ → Retrieve sources   │
                                    │ → Generate with cites│
                                    │ → Verify claims      │
                                    └──────────────────────┘
```

### Immediate architecture (Track A)

```
┌─────────────────────────────────────────────────────────┐
│                     ERFANA (Electron)                    │
└────────────────────────┬────────────────────────────────┘
                         │
                    ┌────▼────┐
                    │ Terminal │
                    └────┬────┘
                         │ PTY
              ┌──────────▼──────────┐
              │ Claude Code          │
              │                      │
              │ ┌──────────────────┐ │
              │ │ mcp-local-rag    │ │    ← Add to .mcp.json
              │ │ (npx)            │ │
              │ │                  │ │
              │ │ Transformers.js  │ │
              │ │ all-MiniLM-L6-v2 │ │
              │ │ LanceDB          │ │
              │ └──────────────────┘ │
              │                      │
              │ Audit prompt template│    ← Add to prompts/templates/
              │ Verify prompt template│
              └──────────────────────┘
```

### Fully local deployment stack (for building from scratch)

| Component | Recommended | Alternative |
|-----------|------------|-------------|
| LLM | Ollama (Llama 3.1-8B or Qwen2.5-7B) | LM Studio, vLLM |
| Embeddings | all-MiniLM-L6-v2 (ONNX) | nomic-embed-text, BGE |
| Vector DB | SQLite + sqlite-vec (erfana native) | ChromaDB, pgvector |
| Full-text search | SQLite FTS5 (erfana native) | – |
| Document parsing | PyMuPDF + Unstructured | LiteParse (erfana planned) |
| TTS (if needed) | Kokoro-82M (CPU) or Qwen3-TTS (GPU) | Bark, CosyVoice2 |
| Frontend | Erfana (already built) | – |

### Minimum hardware

| Tier | RAM | GPU | Capability |
|------|-----|-----|-----------|
| CPU-only | 16GB | None | Keyword search + basic embedding |
| Entry GPU | 16GB + 8GB VRAM | RTX 3060/4060 | Fast embedding + local LLM |
| Recommended | 32GB + 24GB VRAM | RTX 4090 | 13B+ LLM + high-quality TTS |

---

## 12. Recommendations

### Priority 1 – Immediate (this week)

1. **Add `mcp-local-rag` to erfana's `.mcp.json`** – gives Claude Code instant semantic search over all project files
2. **Create `audit-summary` prompt template** – enforce citation rules in Claude Code's generation
3. **Create `verify-claims` prompt template** – post-generation verification loop
4. **Test the workflow** on a real audit project with interview transcripts

### Priority 2 – Short-term (with Graph Engine M1–M2)

5. **Prioritize M1 + M2 implementation** – FTS5 keyword search + vector similarity are the foundation
6. **Add citation-aware search to M1** – return full text spans, not just 200-char snippets
7. **Add query-based vector search to M2** – allow searching by concept text, not just section ID
8. **Remove `mcp-local-rag`** once erfana's native MCP tools are operational

### Priority 3 – Medium-term (with Graph Engine M3–M4)

9. **Build "who said what" composite queries** – entity + topic filtering for interview attribution
10. **Build cross-interview contradiction detection** – temporal queries to flag inconsistencies
11. **Build an `audit-report` MCP tool** – orchestrates the full retrieve → generate → verify pipeline

### Priority 4 – Optional/premium

12. **Citations API MCP wrapper** – build an MCP server that calls Anthropic's Citations API for first-party attribution (highest quality grounding, requires API key + cost)
13. **Podcast generation** – if audio summaries are useful for audit briefings, integrate Podcastfy or build custom pipeline

---

## Appendix: key sources

### Google NotebookLM
- [Google Blog – developing NotebookLM](https://blog.google/innovation-and-ai/products/developing-notebooklm/)
- [Google DeepMind podcast – inside NotebookLM](https://deepmind.google/discover/the-podcast/inside-notebooklm-with-raiza-martin-and-steven-johnson/)
- [DEV Community – technical deep-dive](https://dev.to/jubinsoni/architecting-the-future-of-research-a-technical-deep-dive-into-notebooklm-and-gemini-integration-m60)
- [arXiv:2504.09720 – NotebookLM RAG analysis](https://arxiv.org/abs/2504.09720)

### Open-source alternatives
- [Open Notebook](https://github.com/lfnovo/open-notebook) – 21.5k stars, MIT
- [SurfSense](https://github.com/MODSetter/SurfSense) – 13.6k stars, Apache 2.0
- [Podcastfy](https://github.com/souzatharsis/podcastfy) – 6.2k stars, best podcast library
- [Mozilla Document-to-Podcast](https://github.com/mozilla-ai/document-to-podcast) – CPU-only
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) – 54k+ stars, easiest start

### MCP RAG servers
- [mcp-local-rag](https://github.com/shinpr/mcp-local-rag) – zero-setup, recommended
- [Qdrant MCP](https://github.com/qdrant/mcp-server-qdrant) – official
- [Chroma MCP](https://github.com/chroma-core/chroma-mcp) – official
- [knowledge-mcp](https://github.com/olafgeibig/knowledge-mcp) – hybrid RAG + knowledge graph

### Anthropic
- [Citations API docs](https://docs.anthropic.com/en/docs/build-with-claude/citations)
- [Reducing hallucinations guide](https://docs.anthropic.com/en/docs/build-with-claude/reduce-hallucinations)

### Tutorials
- [Mozilla AI – documents to podcasts locally](https://blog.mozilla.ai/blueprint-deep-dive-turn-documents-into-podcasts-locally-with-open-source-ai/)
- [Together AI – open source NotebookLM PDF to podcast](https://docs.together.ai/docs/open-notebooklm-pdf-to-podcast)
- [The New Stack – deploy open source NotebookLM](https://thenewstack.io/how-to-deploy-an-open-source-version-of-notebooklm/)
