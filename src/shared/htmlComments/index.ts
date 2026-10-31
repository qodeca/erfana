// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML Preview comments – the format core (docs/designs/comments/html-preview-comments.md
 * §4.2 "Shared"; public spec docs/html-comments/format-v1.md).
 *
 * Pure code: no Electron, no file system; parse5, zod and @noble/hashes only.
 * Main and the renderer may import it; the preview preload may NOT (preloads
 * are self-contained bundles, electron.vite.config.ts).
 */
export {
  BLOCK_HEADER,
  buildAnchor,
  buildDraftAnchor,
  findAnchorTarget,
  isBlockHeader,
  normalizeQuoteText,
  prepareSnapshot,
  quoteOf,
  relativePath,
  resolveBlockTarget,
  resolveRelativePath,
  QUOTE_CONTEXT_CHARS,
  type BlockTargetQuery,
  type PreparedSnapshot,
  type TargetResolution,
  type TargetVia
} from './anchor'
export {
  findConflictHunks,
  hasConflictHunk,
  lineHasMarkerPrefix,
  markerAtLineStart,
  type ConflictHunk
} from '../comments/conflictMarkers'
export {
  BOM_CHAR,
  CHARSET_PRESCAN_BYTES,
  declaredCharsets,
  decodeLossless,
  encodeText,
  utf8Length,
  type DecodeFailure,
  type DecodeResult
} from '../comments/encoding'
export {
  AGENT_NOTE_LINES,
  AGENT_NOTE_PREFIX,
  BLOCK_MARKER,
  COMMENT_ID_PATTERN,
  CommentDataSchema,
  FORMAT_VERSION,
  MESSAGE_ID_PATTERN,
  TIMESTAMP_PATTERN,
  codePointLength,
  cryptoRandomBytes,
  escapeJsonForComment,
  escapeReadableInline,
  escapeReadableLine,
  formatTimestamp,
  isSafeCommentText,
  mintCommentId,
  mintMessageId,
  renderAgentNote,
  renderReadable,
  renderReadableLines,
  serializeBlock,
  visibleInline,
  type BlockLayout,
  type CommentAnchor,
  type CommentAuthor,
  type CommentData,
  type CommentMessage,
  type CommentView,
  type Eol,
  type RandomBytes,
  type RuntimeAnchor,
  type SerializeFailure,
  type SerializeResult,
  type TextQuote
} from '../comments/format'
export {
  detectFrameworkRegions,
  frameworkPlacementFor,
  type FrameworkKind,
  type FrameworkPlacement,
  type FrameworkRegions
} from './frameworkMarkers'
export { HtmlIndex, hasMoreStartTagsThan, indexHtml, type IndexedComment, type IndexedElement } from './htmlIndex'
export { HtmlParseLimitError, hasAttributeFlood, parseLimitsFor, type HtmlParseLimits } from './parseBounds'
export {
  ELEMENT_TOKEN_ATTRIBUTE,
  ELEMENT_TOKEN_PATTERN,
  instrumentHtml,
  mintElementToken,
  type InstrumentOptions,
  type InstrumentResult,
  type InstrumentedHtml
} from './instrument'
export {
  analyzeCommentDocument,
  hashText,
  parseCommentBlocks,
  parseCommentFile,
  parseIndexedBlocks,
  type CommentDocument,
  type CommentFileResult,
  type DamageReason,
  type FileCommentState,
  type ParsedBlock,
  type ReadOnlyReason
} from './parse'
export { directiveRunStart, inHtmlGeneratedRegion } from './htmlForeign'
export {
  applySplice,
  lineLayoutAt,
  planDelete,
  planInsert,
  planReplace,
  spliceBytes,
  spliceOriginOf,
  verifyCommentSplice,
  verifySplice,
  verifySpliceBytes,
  type DeleteRequest,
  type InsertRequest,
  type LineLayout,
  type Placement,
  type PlanFailure,
  type PlanResult,
  type ReplaceRequest,
  type SpliceOp,
  type SpliceOrigin,
  type SplicePlan,
  type VerifyFailure,
  type VerifyResult
} from './splice'
export {
  addReply,
  createThread,
  deleteMessage,
  editMessage,
  setStatus,
  type NewThread,
  type ThreadContext
} from '../comments/thread'
