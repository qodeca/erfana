// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/** The HTML Preview's comments drawer, against the shared review-loop suite. */
import { vi } from 'vitest'
import { runDrawerBulkSuite } from '../../../../../../shared/comments/__conformance__/drawerBulk.suite'
import type { CommentDirtyGuard } from '../../../../hooks/useCommentDirtyGuard'
import { HTML_WORDS } from '../../../Comments/commentCopyWords'
import { drawerBulkDriver } from '../../../Comments/__test-utils__/drawerBulkDriver'

const guard = vi.hoisted(() => ({ current: null as unknown as CommentDirtyGuard }))
vi.mock('../../../../hooks/useCommentDirtyGuard', () => ({ useCommentDirtyGuard: () => guard.current }))

runDrawerBulkSuite('HTML', () => drawerBulkDriver(HTML_WORDS, guard))
