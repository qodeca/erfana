// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The HTML Preview's comment window, against the shared window rules. */
import { afterEach, beforeEach, vi } from 'vitest'
import { runFocusTableSuite, runWindowRulesSuite } from '../../../../../../shared/comments/__conformance__/overlay.suite'
import type { CommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'
import { focusTableDriver } from '../../../Comments/__test-utils__/focusTableDriver'
import { windowRulesDriver, type WindowRulesHost } from '../../../Comments/__test-utils__/windowRulesDriver'
import { closeReturnsToPage } from './previewCommentRequests'
import { PreviewCommentsLayer } from './PreviewCommentsLayer'

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../../../hooks/useCommentDirtyGuard', () => ({ useCommentDirtyGuard: () => guard.current }))

const HTML_HOST: WindowRulesHost = {
  host: 'HTML',
  seesOtherWindows: false,
  mount: props => (
    <PreviewCommentsLayer
      {...props}
      menu={null}
      polite=""
      assertive=""
      onMenuClose={() => {}}
      onAddComment={() => {}}
      onCloseWindow={props.onClose}
      onNewComment={() => {}}
    />
  ),
  closeFocusesPage: closeReturnsToPage
}

let portalRoot: HTMLDivElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => portalRoot.remove())

runWindowRulesSuite('HTML', () => windowRulesDriver(HTML_HOST, guard))
runFocusTableSuite('HTML', () => focusTableDriver(HTML_HOST, guard))
