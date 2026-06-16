# Embedding pipeline – overview and preprocessing

> This is part 1 of the embedding pipeline documentation, split for readability.
>
> **Other parts:**
> - [Embedding pipeline – ONNX and workers](./embedding-pipeline-onnx-workers.md)
> - [Embedding pipeline – batch processing and models](./embedding-pipeline-batch-models.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers the end-to-end embedding pipeline: from raw markdown text to normalized vectors stored in SQLite, including ONNX Runtime integration, worker thread patterns, and stability considerations.

---

## Pipeline overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          EMBEDDING PIPELINE                          │
└─────────────────────────────────────────────────────────────────────┘

1. Raw Markdown
   └─▶ "# Introduction

This is **bold** text with [link](url)."

2. Text Preprocessing
   └─▶ Strip markdown syntax, preserve meaning
   └─▶ "Introduction

This is bold text with link."

3. Tokenization
   └─▶ ["introduction", "this", "is", "bold", "text", "with", "link"]
   └─▶ Token IDs: [101, 4003, 2023, 2003, 8398, 3793, 2007, 4957, 102]

4. Chunking (256-384 tokens, 10-15% overlap)
   └─▶ Chunk 1: tokens[0:256]
   └─▶ Chunk 2: tokens[230:486] (26 token overlap)

5. Batching (32-128 chunks per batch)
   └─▶ Batch 1: [chunk1, chunk2, ..., chunk32]

6. ONNX Embedding (EmbedderWorker thread)
   └─▶ Input: token_ids (int64), attention_mask (int64)
   └─▶ Output: embeddings (float32) [batch_size, seq_len, hidden_dim]
   └─▶ Mean pooling: [batch_size, hidden_dim]

7. L2 Normalization
   └─▶ vec' = vec / ||vec||₂
   └─▶ Norm = 1.0 (unit vector)

8. Storage
   └─▶ INSERT INTO embeddings (...) RETURNING id
   └─▶ INSERT INTO vss_sections (rowid, embedding) VALUES (?, ?)
```

---

## Text preprocessing

### Goals

1. **Preserve Meaning:** Keep semantic content (links, emphasis become plain text)
2. **Remove Noise:** Strip markdown syntax, code fences, HTML
3. **Normalize Whitespace:** Collapse multiple spaces/newlines

### Implementation

**File:** `src/main/services/TextPreprocessor.ts`

```typescript
export class TextPreprocessor {
  /**
   * Strip markdown syntax while preserving semantic meaning
   */
  static normalize(markdown: string): string {
    let text = markdown;

    // Remove YAML frontmatter
    text = text.replace(/^---
[\s\S]*?
---
/, '');

    // Remove code blocks (preserve inline code as text)
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1'); // Inline code → plain text

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Remove images: ![alt](url) → alt
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Remove links: [text](url) → text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove emphasis: **bold**, *italic* → text
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');

    // Remove headings: ## Heading → Heading
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Remove list markers: - item → item
    text = text.replace(/^\s*[-*+]\s+/gm, '');
    text = text.replace(/^\s*\d+\.\s+/gm, '');

    // Remove blockquotes: > quote → quote
    text = text.replace(/^\s*>\s+/gm, '');

    // Normalize whitespace
    text = text.replace(/
{3,}/g, '

'); // Max 2 consecutive newlines
    text = text.replace(/[ 	]+/g, ' '); // Collapse spaces
    text = text.trim();

    return text;
  }

  /**
   * Compute SHA-256 hash of normalized text (for deduplication)
   */
  static hash(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }
}
```

### Example

**Input:**
```markdown
## Introduction

This is **bold** text with a [link](https://example.com).

- Item 1
- Item 2

> Quoted text

```js
console.log('code');
```
```

**Output:**
```
Introduction

This is bold text with a link.

Item 1
Item 2

Quoted text
```

---

## Tokenization

### Why exact tokenization matters

Embedding models are trained with specific tokenizers. Using a different tokenizer breaks alignment between tokens and learned representations → poor quality embeddings.

**Example:** BERT-based models use WordPiece; GPT models use BPE. Mixing tokenizers causes:
- Token count mismatches (chunking breaks)
- Subword splits differ (semantic loss)
- Special tokens wrong (`[CLS]`, `[SEP]` positions)

### Tokenizer setup

**Install:**

```bash
npm install @huggingface/tokenizers
```

**File:** `src/main/services/TokenizerService.ts`

```typescript
import { AutoTokenizer } from '@huggingface/tokenizers';

export class TokenizerService {
  private tokenizer: any;
  private maxLength: number;

  async initialize(modelId: string, maxLength: number = 512): Promise<void> {
    // Download tokenizer from Hugging Face Hub
    this.tokenizer = await AutoTokenizer.from_pretrained(modelId);
    this.maxLength = maxLength;
    console.log(`Tokenizer loaded: ${modelId}`);
  }

  /**
   * Tokenize text and return token IDs + count
   */
  tokenize(text: string): { ids: number[]; count: number } {
    const encoded = this.tokenizer.encode(text);
    return {
      ids: encoded.ids,
      count: encoded.ids.length
    };
  }

  /**
   * Batch tokenize (for embedding worker)
   */
  batchTokenize(texts: string[]): {
    input_ids: number[][];
    attention_mask: number[][];
  } {
    const encoded = this.tokenizer.batch_encode_plus(texts, {
      padding: true,
      truncation: true,
      max_length: this.maxLength
    });

    return {
      input_ids: encoded.input_ids,
      attention_mask: encoded.attention_mask
    };
  }
}
```

### Token count estimation

**Use exact tokenizer, not approximations:**

```typescript
// ❌ BAD: Approximate (unreliable)
const approxTokens = text.split(/\s+/).length * 1.3;

// ✅ GOOD: Exact tokenization
const { count } = tokenizerService.tokenize(text);
```

---

## Chunking strategy

### Goals

1. **Fixed Size:** 256-384 tokens per chunk (fits model context window)
2. **Overlap:** 10-15% to preserve context across boundaries
3. **Semantic Boundaries:** Prefer splitting at sentence/paragraph breaks

### Implementation

**File:** `src/main/services/ChunkingService.ts`

```typescript
interface ChunkOptions {
  chunkSize: number; // e.g., 256
  overlapPercent: number; // e.g., 10 (= 10%)
}

export class ChunkingService {
  constructor(
    private tokenizerService: TokenizerService,
    private options: ChunkOptions
  ) {}

  /**
   * Split text into overlapping chunks
   */
  chunkText(text: string): Chunk[] {
    const { ids } = this.tokenizerService.tokenize(text);
    const { chunkSize, overlapPercent } = this.options;

    const overlapTokens = Math.floor(chunkSize * (overlapPercent / 100));
    const stride = chunkSize - overlapTokens;

    const chunks: Chunk[] = [];
    let start = 0;

    while (start < ids.length) {
      const end = Math.min(start + chunkSize, ids.length);
      const chunkIds = ids.slice(start, end);

      // Decode tokens back to text (for storage)
      const chunkText = this.tokenizerService.tokenizer.decode(chunkIds);

      chunks.push({
        text: chunkText,
        tokenIds: chunkIds,
        tokenCount: chunkIds.length,
        startToken: start,
        endToken: end
      });

      start += stride;
    }

    return chunks;
  }
}

interface Chunk {
  text: string;
  tokenIds: number[];
  tokenCount: number;
  startToken: number;
  endToken: number;
}
```

### Overlap rationale

**Without overlap:**
```
Chunk 1: [0:256]    "...machine learning is used for"
Chunk 2: [256:512]  "pattern recognition and..."
                     ^ Context lost: "what" is used for pattern recognition?
```

**With 10% overlap (26 tokens):**
```
Chunk 1: [0:256]    "...machine learning is used for"
Chunk 2: [230:486]  "machine learning is used for pattern recognition and..."
                     ^ Context preserved
```

**Trade-off:** More overlap = better context but slower indexing (more chunks).

---

## See also

- [Embedding pipeline – ONNX and workers](./embedding-pipeline-onnx-workers.md) – ONNX Runtime integration, worker thread architecture
- [Embedding pipeline – batch processing and models](./embedding-pipeline-batch-models.md) – batch processing, normalization, error handling, model selection
- [Architecture](./architecture-overview.md) – Worker thread design rationale
- [Vector Search](./vector-search-overview.md) – Storage and querying embeddings
- [Data Model](./data-model.md) – Schema for embeddings and vss_sections
- [Performance](./performance.md) – Benchmarks and optimization
