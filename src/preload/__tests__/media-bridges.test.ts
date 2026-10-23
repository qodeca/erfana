// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The preload import, media and export bridges (`import`, `transcription`,
 * `whisper`, `camera`, `pdf`, `docx`, `imageExport`, `browser`) against their
 * wire: every method sends the channel it always sent, with the arguments it
 * always sent, and every event subscription unsubscribes the listener it added.
 */
import { vi } from 'vitest'
import { describeBridge } from './bridgeHarness'
import { importBridge } from '../importBridge'
import { transcriptionBridge, whisperBridge } from '../transcriptionBridge'
import { cameraBridge } from '../cameraBridge'
import { docxBridge, pdfBridge } from '../documentExportBridge'
import { imageExportBridge } from '../imageExportBridge'
import { browserBridge } from '../browserBridge'

vi.mock('electron', async () => ({ ipcRenderer: (await import('./bridgeHarness')).ipc }))

const documentRequest = { filePath: '/p/a.pdf', options: { ocr: true } }

describeBridge('import bridge', importBridge, {
  invokes: [
    { method: 'selectFile', args: [], channel: 'import:selectFile', wire: [] },
    { method: 'validate', args: ['/p/a.pdf'], channel: 'import:validate', wire: ['/p/a.pdf'] },
    { method: 'process', args: ['/p/a.pdf'], channel: 'import:process', wire: ['/p/a.pdf'] },
    { method: 'getSupportedExtensions', args: [], channel: 'import:getSupportedExtensions', wire: [] },
    { method: 'isSupported', args: ['.pdf'], channel: 'import:isSupported', wire: ['.pdf'] },
    { method: 'documentImport', args: [documentRequest], channel: 'import:document', wire: [documentRequest] },
    { method: 'cancelDocument', args: [], channel: 'import:documentCancel', wire: [] },
    { method: 'getDocumentExtensions', args: [], channel: 'import:getDocumentExtensions', wire: [] },
    {
      method: 'toolStatus',
      args: [{ recheck: true }],
      channel: 'import:toolStatus',
      wire: [{ recheck: true }]
    }
  ],
  events: [
    { method: 'onDocumentProgress', channel: 'import:documentProgress' },
    { method: 'onDependenciesReady', channel: 'import:dependenciesReady' }
  ]
})

const transcriptionRequest = { filePath: '/p/a.mp3', language: 'en' }

describeBridge('transcription bridge', transcriptionBridge, {
  invokes: [
    {
      method: 'import',
      args: [transcriptionRequest],
      channel: 'transcription:import',
      wire: [transcriptionRequest]
    },
    { method: 'cancel', args: [], channel: 'transcription:cancel', wire: [] },
    { method: 'validate', args: ['/p/a.mp3'], channel: 'transcription:validate', wire: ['/p/a.mp3'] },
    { method: 'setApiKey', args: ['key'], channel: 'transcription:setApiKey', wire: ['key'] },
    { method: 'hasApiKey', args: [], channel: 'transcription:hasApiKey', wire: [] },
    { method: 'clearApiKey', args: [], channel: 'transcription:clearApiKey', wire: [] }
  ],
  events: [{ method: 'onProgress', channel: 'transcription:progress' }]
})

describeBridge('whisper bridge', whisperBridge, {
  invokes: [
    { method: 'ensureBinary', args: [], channel: 'transcription:whisperEnsureBinary', wire: [] },
    { method: 'ensureModel', args: ['base'], channel: 'transcription:whisperEnsureModel', wire: ['base'] },
    { method: 'listModels', args: [], channel: 'transcription:whisperListModels', wire: [] },
    { method: 'deleteModel', args: ['base'], channel: 'transcription:whisperDeleteModel', wire: ['base'] }
  ],
  events: [{ method: 'onDownloadProgress', channel: 'transcription:whisperDownloadProgress' }]
})

const photo = { dataUrl: 'data:image/jpeg;base64,AA==', timestamp: 1 }

describeBridge('camera bridge', cameraBridge, {
  invokes: [{ method: 'save', args: [photo], channel: 'camera:save', wire: [photo] }]
})

const exportRequest = { html: '<p>x</p>', fileName: 'doc' }

describeBridge('pdf bridge', pdfBridge, {
  invokes: [{ method: 'exportToPdf', args: [exportRequest], channel: 'pdf:exportToPdf', wire: [exportRequest] }]
})

describeBridge('docx bridge', docxBridge, {
  invokes: [
    { method: 'exportToDocx', args: [exportRequest], channel: 'docx:exportToDocx', wire: [exportRequest] }
  ]
})

const imageRequest = { filePath: '/p/a.png', target: 'png' }

describeBridge('imageExport bridge', imageExportBridge, {
  invokes: [{ method: 'run', args: [imageRequest], channel: 'image-export:run', wire: [imageRequest] }]
})

describeBridge('browser bridge', browserBridge, {
  invokes: [
    {
      method: 'openFile',
      args: ['/p/a.html'],
      channel: 'browser:openFile',
      wire: [{ filePath: '/p/a.html' }]
    }
  ]
})
