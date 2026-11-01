// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The Markdown Preview's docked comment window, against the shared window rules. */
import { vi } from 'vitest'
import { runWindowRulesSuite } from '../../../../../shared/comments/__conformance__/overlay.suite'
import type { CommentDirtyGuard } from '../../../hooks/useCommentDirtyGuard'
import { MARKDOWN_WORDS, MD_SURFACE_COPY } from '../../Comments/commentCopyWords'
import { CommentWindow } from '../../Comments/CommentWindow'
import { CommentWordsContext } from '../../Comments/commentWords'
import { windowRulesDriver, type WindowRulesHost } from '../../Comments/__test-utils__/windowRulesDriver'

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../../hooks/useCommentDirtyGuard', () => ({ useCommentDirtyGuard: () => guard.current }))

const FILE = 'index.html'
const MARKDOWN_HOST: WindowRulesHost = {
  host: 'Markdown',
  seesOtherWindows: true,
  mount: (props, editor) => (
    <CommentWordsContext.Provider value={MARKDOWN_WORDS}>
      <CommentWindow
        {...props}
        modal={false}
        pausedText={editor === 'clean' ? null : editor === 'conflict' ? MD_SURFACE_COPY.pausedConflictReason(FILE) : MD_SURFACE_COPY.paused(FILE)}
      />
    </CommentWordsContext.Provider>
  )
}

runWindowRulesSuite('Markdown', () => windowRulesDriver(MARKDOWN_HOST, guard))
