// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload HTML Preview comments bridge (`previewComments`) against its
 * wire (docs/designs/html-preview-comments.md §8): every method sends the
 * channel and payload main validates – a panel and main-minted keys, never a
 * path to write or an author – and every event subscription unsubscribes the
 * listener it added.
 */
import { vi } from 'vitest'
import { describeBridge } from './bridgeHarness'
import { previewCommentsBridge } from '../previewCommentsBridge'

vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))

const setMode = { panelId: 'preview-a', on: true, showIcons: false }
const save = { panelId: 'preview-a', op: 'add', draftToken: 'd'.repeat(22), text: 'Hi' }

describeBridge('previewComments bridge', previewCommentsBridge, {
  invokes: [
    { method: 'setMode', args: [setMode], channel: 'preview:commentSetMode', wire: [setMode] },
    { method: 'list', args: ['preview-a'], channel: 'preview:commentList', wire: [{ panelId: 'preview-a' }] },
    {
      method: 'reveal',
      args: ['preview-a', 'tkey'],
      channel: 'preview:commentCommand',
      wire: [{ panelId: 'preview-a', command: 'reveal', threadKey: 'tkey' }]
    },
    { method: 'save', args: [save], channel: 'preview:commentSave', wire: [save] },
    {
      method: 'setUnsavedSources',
      args: [['/p/a.html']],
      channel: 'preview:commentSetUnsavedSources',
      wire: [{ paths: ['/p/a.html'] }]
    }
  ],
  events: [
    { method: 'onDraftOpened', channel: 'preview:commentDraftOpened' },
    { method: 'onCommentsChanged', channel: 'preview:commentsChanged' },
    { method: 'onAnchorStatus', channel: 'preview:commentAnchorStatus' },
    { method: 'onModeChanged', channel: 'preview:commentModeChanged' },
    { method: 'onSaveSettled', channel: 'preview:commentSaveSettled' }
  ]
})
