# Source grounding for erfana

> **Status**: Research complete, implementation pending
> **Date**: 2026-03-28

Research and gap analysis for integrating NotebookLM-style source grounding into erfana for hallucination-free audit document generation.

**Related documents**:
- [Strategy and pipeline design](strategy.md) – erfana integration, Layer 0 analysis, two-track strategy, pipeline, prompt templates
- [Technical reference](technical-reference.md) – Citations API, MCP RAG servers, architecture blueprint, risks
- [Gap analysis](gap-analysis.md) – gaps in current specs for grounding
- [Missing specs and recommendations](missing-specs.md) – new specs needed, cross-cutting concerns, impact matrix
- [Implementation roadmap](implementation-roadmap.md) – spec-ready outlines, dependency graph, file paths

---

## 1. Problem statement

When preparing audit summary documents from interview transcripts and source documents, Claude Code must **ground every claim in specific source passages** and never hallucinate facts. This requires:

- Semantic search across all project files (transcripts, policies, evidence)
- Citation of exact source passages for every factual claim
- Contradiction detection across interviews
- "Who said what about which topic" attribution
- Post-generation verification that claims match sources

---

## 2. The source/derived document paradigm

Erfana's use case is fundamentally different from NotebookLM or general-purpose RAG. Users have two distinct categories of documents:

- **Source documents** (ground truth): interview transcripts, policy documents, audit evidence, regulatory requirements – these are authoritative and their content should never be questioned by the system
- **Derived documents** (generated output): audit summaries, findings reports, compliance assessments – these are created by Claude Code from sources and must be provably grounded

**The system must ensure derived documents cite only source documents – never other derived documents** (which would create circular reasoning). This distinction is the foundational architectural concept for erfana's grounding system.

### Formalization options

| Approach | Mechanism | Complexity |
|----------|-----------|------------|
| Frontmatter tag | `type: source` vs `type: derived` with `authority: policy\|procedure\|interview\|note` | Low |
| Folder convention | `sources/` directory for ground truth documents | Low |
| Registry | `.erfana/sources.json` listing authoritative files | Medium |

This distinction must permeate:
- **MCP tools**: `sources_only: boolean` parameter on all search tools
- **Prompt templates**: explicitly designate which files are authoritative
- **Verification pipeline**: check citations only against designated sources
- **UI**: visual distinction in the project tree (icon or colour badge)

---

## 3. How Google NotebookLM works

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

### Audio overview

NotebookLM also generates podcast-style audio discussions from documents via a 4-model pipeline (Gemini -> SPEAR-TTS -> SoundStorm -> SoundStream). Not relevant to erfana's audit use case – see [technical-reference.md appendix](technical-reference.md#appendix-a-audiopodcast-generation-for-reference) for details.

**Sources**:
- [Google Blog – How Googlers developed NotebookLM](https://blog.google/innovation-and-ai/products/developing-notebooklm/)
- [Google DeepMind – Inside NotebookLM](https://deepmind.google/discover/the-podcast/inside-notebooklm-with-raiza-martin-and-steven-johnson/)
- [DEV Community – Technical deep-dive](https://dev.to/jubinsoni/architecting-the-future-of-research-a-technical-deep-dive-into-notebooklm-and-gemini-integration-m60)

---

## 4. Open-source alternatives landscape

### Full-featured NotebookLM alternatives

| Project | Stars | License | Stack | Key features |
|---------|-------|---------|-------|--------------|
| [Open Notebook](https://github.com/lfnovo/open-notebook) | 21.5k | MIT | Python/FastAPI + Next.js, SurrealDB, LangChain | Podcast gen, RAG chat, 16+ AI providers, Ollama for fully local |
| [SurfSense](https://github.com/MODSetter/SurfSense) | 13.6k | Apache 2.0 | FastAPI + Next.js, PostgreSQL/pgvector | 25+ connectors (Slack, Notion, GitHub), RBAC, team collaboration |
| [Khoj](https://github.com/khoj-ai/khoj) | 33.7k | AGPL-3.0 | Python | YC-backed, multi-platform, custom agents |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | 54k+ | MIT | Desktop app | Built-in LLM engine, 30+ providers, easiest setup |
| [Open-NotebookLM (OpenDCAI)](https://github.com/OpenDCAI/Open-NotebookLM) | ~50 | Apache 2.0 | Python | PPTs, mind maps, diagrams, podcasts, flashcards – closest feature parity |
| [RAGFlow](https://github.com/infiniflow/ragflow) | 76.4k | Apache 2.0 | Python | Visual pipeline builder, deep document understanding |

### RAG framework comparison

| Framework | Stars | Best for | Latency |
|-----------|-------|----------|---------|
| LlamaIndex | 40k+ | Pure RAG, document Q&A | ~6ms |
| LangChain | 100k+ | Complex agents, rapid prototyping | Higher |
| Haystack | ~18k | Production pipelines, efficiency | ~5.9ms |
| RAGFlow | 76.4k | Visual/no-code, deep doc understanding | – |

---

## 5. Scientific papers – reading list

### RAG foundations

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **Lewis et al. – RAG for Knowledge-Intensive NLP** | NeurIPS 2020 | Foundational RAG paper – combining parametric + non-parametric memory. [arXiv:2005.11401](https://arxiv.org/abs/2005.11401) |
| **Self-RAG** (Asai et al.) | ICLR 2024 | LM learns *when* to retrieve and self-critiques via reflection tokens. Outperforms ChatGPT on QA. [arXiv:2310.11511](https://arxiv.org/abs/2310.11511) |
| **RAPTOR** (Sarthi et al.) | ICLR 2024 | Hierarchical tree of recursive summaries for multi-level retrieval. +20% on QuALITY benchmark. [arXiv:2401.18059](https://arxiv.org/abs/2401.18059) |
| **RAG survey** (Gao et al.) | 2023 | Taxonomises Naive, Advanced, and Modular RAG paradigms. [arXiv:2312.10997](https://arxiv.org/abs/2312.10997) |
| **RAG survey** (Gupta et al.) | 2024 | Survey on retrieval-augmented text generation. [arXiv:2410.12837](https://arxiv.org/abs/2410.12837) |
| **ColBERT** (Khattab & Zaharia) | SIGIR 2020 | Late-interaction retrieval – 2 orders of magnitude faster than cross-encoders. [arXiv:2004.12832](https://arxiv.org/abs/2004.12832) |

Note: A separate RAG survey by Huang & Huang is at [arXiv:2404.10981](https://arxiv.org/abs/2404.10981).

**Advanced RAG techniques**: Hybrid search (BM25 + dense vectors via Reciprocal Rank Fusion) yields 15–30% retrieval improvement; query decomposition and multi-hop retrieval address complex reasoning chains.

### Citation and attribution

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **ALCE** (Princeton) | EMNLP 2023 | Citation evaluation benchmark – even best models lack complete citation support 50% of the time. [arXiv:2305.14627](https://arxiv.org/abs/2305.14627) |
| **"Attribute First, then Generate"** | ACL 2024 | Selects source segments before generating text. [arXiv:2403.17104](https://arxiv.org/abs/2403.17104) |
| **ReClaim** | 2024 | Interleaves references and claims sentence-by-sentence |
| **MTRAG** | TACL 2025 | Multi-turn conversational RAG benchmark – reveals SOTA systems struggle on later turns and unanswerable questions. [arXiv:2501.03468](https://arxiv.org/abs/2501.03468) |

### Grounded generation and verification

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **GINGER** (Lajewska & Balog) | SIGIR 2025 | Modular grounded RAG using atomic "information nuggets" – SOTA on TREC RAG'24. [arXiv:2503.18174](https://arxiv.org/abs/2503.18174) |
| **AGREE** (Xi Ye et al.) | NAACL 2024 | Fine-tunes LLMs for self-grounding – 30%+ improvement over prompting. [arXiv:2311.09533](https://arxiv.org/abs/2311.09533) |
| **CaLM** | ACL 2024 Findings | Smaller LM verifies grounded output of larger LM via contrastive checking. [arXiv:2406.05365](https://arxiv.org/abs/2406.05365) |
| **FACTS Grounding** (Google DeepMind) | 2025 | Benchmark for LLM factuality in document-grounded generation. [arXiv:2501.03200](https://arxiv.org/abs/2501.03200) |
| **Contextual Retrieval** (Anthropic) | 2024 | Adding context to chunks before embedding – improves retrieval by 49% |
| **Late Chunking** (JinaAI) | 2024 | Embed full documents first, then chunk embeddings – preserves cross-chunk context |
| **Audit procedure generation** | EMNLP 2025 | LLM-based audit procedure generation – directly relevant to erfana |

### Document understanding

| Paper | Year | Key contribution |
|-------|------|-----------------|
| **ColPali** (Faysse et al.) | ICLR 2025 | Vision language model generating multi-vector embeddings from document page images – bypasses OCR entirely. [arXiv:2407.01449](https://arxiv.org/abs/2407.01449) |
| **LayoutLMv3** (Huang et al.) | ACM MM 2022 | Unified text + image masking with word-patch alignment. SOTA on form understanding, document VQA. [arXiv:2204.08387](https://arxiv.org/abs/2204.08387) |
| **DocLLM** | ACL 2024 | Layout-aware generative LLM with disentangled spatial attention |
| **DocLayLLM** | CVPR 2025 | Efficient multi-modal document AI |

### Embedding models for local/Electron use

| Model | Size | Dimensions | Notes |
|-------|------|-----------|-------|
| bge-small-en-v1.5 | ~130MB ONNX | 384 | **Recommended** – drop-in upgrade, available as `Xenova/bge-small-en-v1.5` |
| nomic-embed-text-v1.5 | ~280MB ONNX | 64–768 (Matryoshka) | Premium option – 8192-token context, outperforms OpenAI Ada-002 |
| all-MiniLM-L6-v2 | 23MB ONNX INT8 (full FP32: 90MB) | 384 | Legacy (2019) – smallest option, 512-token context limit |
| snowflake-arctic-embed-s | ~33M params | 384 | Newer alternative, needs ONNX conversion |

Note: [transformersjs-electron](https://github.com/Mintplex-Labs/transformersjs-electron) provides a reference implementation for running Transformers.js in Electron.
