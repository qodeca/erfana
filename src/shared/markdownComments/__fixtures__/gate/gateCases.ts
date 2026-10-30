// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Claude Code gate samples (spec 024 024-FR-016, 024-NFR-004,
 * 024-AC-017, 024-AC-027): the Markdown files before any comment, the
 * comments Erfana's writer adds to them, and what an agent acting on the
 * open comments must change.
 *
 * Each open comment asks one small edit of its target, worded with "this
 * {kind}" and, where it matters, of a word that its neighbours share – so a
 * run passes only when the agent finds the block the comment is about from
 * the agent note and the hint lines, not from the words alone.
 *
 * `from` / `to` are the target's text before and after the edit: a substring
 * that occurs exactly once outside the comment blocks. A resolved comment
 * asks an edit too, which a run must NOT make: its `from` stays.
 *
 * The samples are written once, by `markdownGate.test.ts` with
 * `GATE_SAMPLES_WRITE=1`, and hashed into `gate.lock.json` before any run;
 * they are never edited after that (README).
 */
import type { MdTargetKind } from '../../mdIndex'

/** The one prompt every run gets, word for word; each run's file is copied in as {@link GATE_FILE_NAME}. */
export const GATE_PROMPT = 'Act on the open review comments in notes.md.'

/** The name each sample has inside its run's project folder. */
export const GATE_FILE_NAME = 'notes.md'

/** The made-up reviewer every gate comment is written by (architecture note 001 § 8 C20). */
export const GATE_AUTHOR = { name: 'Gate Reviewer', email: 'gate@example.invalid', role: 'human' } as const

/** The fixed clock of every gate comment. */
export const GATE_NOW_MS = Date.UTC(2026, 9, 30, 9, 0, 0)

/** The preview size every gate comment records. */
export const GATE_VIEW = { w: 900, h: 700, dpr: 2, x: 0, y: 0 } as const

/** One comment of a sample, in the order it is added. */
export interface GateComment {
  /**
   * The target's kind, the text its rendered text holds, and which match
   * (source order, deepest last). An outer list item's text holds its nested
   * items', so a nested item is never match 0; the writer refuses a target
   * that holds another match.
   */
  readonly kind: MdTargetKind
  readonly match: string
  readonly nth?: number
  /** The comment's only message. */
  readonly message: string
  /** Selected words (`anchor.sel`) – the window's selection, before the kind trims its context. */
  readonly sel?: { readonly exact: string; readonly prefix: string; readonly suffix: string }
  /** Resolved right after it is added: the run must leave its target alone. */
  readonly resolved?: true
  /** The target's text the edit replaces (open) or keeps (resolved); exactly once outside comments. */
  readonly from: string
  /** The target's text after the asked edit (open comments only). */
  readonly to?: string
}

/** One gate sample. */
export interface GateCase {
  /** The sample's file name without `.md`. */
  readonly name: string
  /** What it covers, in 024-NFR-004's words. */
  readonly covers: string
  readonly before: string
  readonly comments: readonly GateComment[]
  /** The agent runs a second time, in a new session, on its own output; nothing may change. */
  readonly runTwice?: true
}

/** The eleven samples of 024-NFR-004, in its order. */
export const GATE_CASES: readonly GateCase[] = [
  {
    name: 'gate-01-paragraph',
    covers: 'paragraph',
    before: '# Release notes\n\nThe new theme uses a warm colour for links.\n\nThe status badge uses a cool colour for warnings.\n',
    comments: [
      {
        kind: 'paragraph',
        match: 'status badge',
        message: "Change 'colour' to 'color' in this paragraph.",
        from: 'The status badge uses a cool colour for warnings.',
        to: 'The status badge uses a cool color for warnings.'
      }
    ]
  },
  {
    name: 'gate-02-heading',
    covers: 'heading',
    before: '# Setup guide\n\n## Install the tools\n\nRun the installer once.\n\n## Configure the tools\n\nEdit the settings file.\n',
    comments: [
      {
        kind: 'heading',
        match: 'Configure the tools',
        message: "Change 'tools' to 'editor' in this heading.",
        from: '## Configure the tools',
        to: '## Configure the editor'
      }
    ]
  },
  {
    name: 'gate-03-list-item-1',
    covers: 'list item 1',
    before: '# Launch plan\n\n- Freeze the API on Monday.\n- Run the load test on Monday.\n- Publish the notes on Friday.\n',
    comments: [
      {
        kind: 'item',
        match: 'Freeze the API',
        message: "Change 'Monday' to 'Tuesday' in this item.",
        from: '- Freeze the API on Monday.',
        to: '- Freeze the API on Tuesday.'
      }
    ]
  },
  {
    name: 'gate-04-list-item-2',
    covers: 'list item 2',
    before: '# Launch plan\n\n- Freeze the API on Monday.\n- Run the load test on Monday.\n- Publish the notes on Friday.\n',
    comments: [
      {
        kind: 'item',
        match: 'Run the load test',
        message: "Change 'Monday' to 'Wednesday' in this item.",
        from: '- Run the load test on Monday.',
        to: '- Run the load test on Wednesday.'
      }
    ]
  },
  {
    name: 'gate-05-nested-list-item',
    covers: 'nested list item',
    before: '# Release steps\n\n- Prepare the release\n  - Update the changelog today.\n  - Tag the build today.\n- Announce the release\n',
    comments: [
      {
        kind: 'item',
        match: 'Tag the build',
        nth: 1,
        message: "Change 'today' to 'tomorrow' in this item.",
        from: '  - Tag the build today.',
        to: '  - Tag the build tomorrow.'
      }
    ]
  },
  {
    name: 'gate-06-table-row',
    covers: 'table row',
    before: '# Owners\n\n| Task | Owner | Due |\n|---|---|---|\n| Write the docs | Ada | Monday |\n| Review the docs | Grace | Monday |\n',
    comments: [
      {
        kind: 'row',
        match: 'Review the docs',
        message: "Change 'Monday' to 'Thursday' in this row.",
        from: '| Review the docs | Grace | Monday |',
        to: '| Review the docs | Grace | Thursday |'
      }
    ]
  },
  {
    name: 'gate-07-quote-paragraph',
    covers: 'paragraph inside a block quote',
    before: '# Principles\n\n> Ship small changes often.\n>\n> Keep every change small and reviewed.\n\nThanks for reading.\n',
    comments: [
      {
        kind: 'paragraph',
        match: 'Keep every change',
        message: "Change 'small' to 'focused' in this paragraph.",
        from: '> Keep every change small and reviewed.',
        to: '> Keep every change focused and reviewed.'
      }
    ]
  },
  {
    name: 'gate-08-code-block',
    covers: 'code block',
    before: '# Build\n\nFor local work:\n\n```sh\nnpm install\nnpm run dev\n```\n\nFor CI:\n\n```sh\nnpm install\nnpm run build\n```\n',
    comments: [
      {
        kind: 'code',
        match: 'npm run build',
        message: "Change 'npm install' to 'npm ci' in this code block.",
        from: 'npm install\nnpm run build',
        to: 'npm ci\nnpm run build'
      }
    ]
  },
  {
    name: 'gate-09-resolved-comment',
    covers: 'resolved comment',
    before: '# Style notes\n\nUse the grey palette for borders.\n\nUse the grey palette for shadows.\n',
    comments: [
      {
        kind: 'paragraph',
        match: 'for borders',
        message: "Change 'grey' to 'gray' in this paragraph.",
        resolved: true,
        from: 'Use the grey palette for borders.'
      },
      {
        kind: 'paragraph',
        match: 'for shadows',
        message: "Change 'grey' to 'gray' in this paragraph.",
        from: 'Use the grey palette for shadows.',
        to: 'Use the gray palette for shadows.'
      }
    ]
  },
  {
    name: 'gate-10-selection-comment',
    covers: 'selection comment',
    before: '# Welcome\n\nOur team builds the colour picker and the colour themes.\n',
    comments: [
      {
        kind: 'paragraph',
        match: 'colour themes',
        message: "Change this word to 'color'.",
        sel: { exact: 'colour', prefix: 'colour picker and the ', suffix: ' themes.' },
        from: 'the colour picker and the colour themes.',
        to: 'the colour picker and the color themes.'
      }
    ]
  },
  {
    name: 'gate-11-run-twice',
    covers: 'run twice',
    runTwice: true,
    before: '# Operations\n\nRun the backup before each release.\n\nCheck the logs after each release.\n',
    comments: [
      {
        kind: 'paragraph',
        match: 'Run the backup',
        message: "Add the word 'nightly' before 'backup' in this paragraph.",
        from: 'Run the backup before each release.',
        to: 'Run the nightly backup before each release.'
      }
    ]
  }
]
