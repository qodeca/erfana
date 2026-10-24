// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Compile-time proof that the preload object is its contracts.
 *
 * Nothing imports this file and it has no runtime content: `npm run typecheck`
 * compiles it (test files are not type-checked, so the same assertions in
 * `__tests__/api-contract.test.ts` alone would prove nothing in CI). A bridge
 * that drifts from its contract, or an `Api` that stops being `typeof api`,
 * fails the typecheck here.
 */
import type { BrowserBridge } from '../shared/ipc/browser-schema'
import type { CameraBridge } from '../shared/ipc/camera-schema'
import type { ClipboardBridge } from '../shared/ipc/clipboard-schema'
import type { DocxBridge } from '../shared/ipc/docx-schema'
import type { ImageExportBridge } from '../shared/ipc/image-export-schema'
import type { ImportBridge } from '../shared/ipc/import-schema'
import type { MarkdownImageBridge } from '../shared/ipc/markdown-image-schema'
import type { PdfBridge } from '../shared/ipc/pdf-schema'
import type { PreviewBridge } from '../shared/ipc/preview-bridge-types'
import type { TranscriptionBridge, WhisperBridge } from '../shared/ipc/transcription-schema'
import type { DirectoryWatchBridge } from '../shared/ipc/directory-watch-schema'
import type { FileBridge } from '../shared/ipc/file-schema'
import type { FileWatchBridge } from '../shared/ipc/file-watch-schema'
import type { GitBridge } from '../shared/ipc/git-schema'
import type { GitPollingBridge, GitWatcherBridge } from '../shared/ipc/git-watcher-schema'
import type { GlobalSettingsBridge } from '../shared/ipc/global-settings-schema'
import type { LoggingBridge } from '../shared/ipc/logging-schema'
import type { ProjectLockBridge } from '../shared/ipc/project-lock-schema'
import type { QuitBridge } from '../shared/ipc/quit-schema'
import type { SettingsBridge } from '../shared/ipc/settings-schema'
import type { SystemBridge } from '../shared/ipc/system-schema'
import type { TerminalBridge } from '../shared/ipc/terminal-schema'
import type { Api } from './index'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

/** Platform types that hold `any` themselves (`Date#toJSON(key: any)`); the walk stops there. */
type Builtin = Date | RegExp | Error | Blob | ArrayBuffer | ArrayBufferView | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>

type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * `true` where `any` appears in `T`: as a value, a property, a parameter, a
 * return or a promised value. Depth is bounded so DOM and Node types end the walk.
 */
type AnyIn<T, Depth extends unknown[] = []> = Depth['length'] extends 14
  ? never
  : IsAny<T> extends true
    ? true
    : T extends (...args: infer A) => infer R
      ? AnyIn<A, [...Depth, 0]> | AnyIn<R, [...Depth, 0]>
      : T extends Promise<infer U>
        ? AnyIn<U, [...Depth, 0]>
        : T extends Builtin
          ? never
          : T extends readonly unknown[]
          ? AnyIn<T[number], [...Depth, 0]>
          : T extends object
            ? { [K in keyof T]-?: AnyIn<T[K], [...Depth, 0]> }[keyof T]
            : never

export type ApiContractChecks = [
  Assert<Equal<Api['file'], FileBridge>>,
  Assert<Equal<Api['terminal'], TerminalBridge>>,
  Assert<Equal<Api['fileWatch'], FileWatchBridge>>,
  Assert<Equal<Api['directoryWatch'], DirectoryWatchBridge>>,
  Assert<Equal<Api['git'], GitBridge>>,
  Assert<Equal<Api['gitWatcher'], GitWatcherBridge>>,
  Assert<Equal<Api['gitPolling'], GitPollingBridge>>,
  Assert<Equal<Api['settings'], SettingsBridge>>,
  Assert<Equal<Api['globalSettings'], GlobalSettingsBridge>>,
  Assert<Equal<Api['logging'], LoggingBridge>>,
  Assert<Equal<Api['quit'], QuitBridge>>,
  Assert<Equal<Api['system'], SystemBridge>>,
  Assert<Equal<Api['clipboard'], ClipboardBridge>>,
  Assert<Equal<Api['projectLock'], ProjectLockBridge>>,
  Assert<Equal<Api['testHooks'], { readonly enabled: boolean }>>,
  Assert<Equal<Api['import'], ImportBridge>>,
  Assert<Equal<Api['transcription'], TranscriptionBridge>>,
  Assert<Equal<Api['whisper'], WhisperBridge>>,
  Assert<Equal<Api['camera'], CameraBridge>>,
  Assert<Equal<Api['pdf'], PdfBridge>>,
  Assert<Equal<Api['docx'], DocxBridge>>,
  Assert<Equal<Api['imageExport'], ImageExportBridge>>,
  Assert<Equal<Api['browser'], BrowserBridge>>,
  Assert<Equal<Api['markdownImage'], MarkdownImageBridge>>,
  Assert<Equal<Api['preview'], PreviewBridge>>,
  // A bridge method that returns the unchecked `ipcRenderer.invoke` result would put `any` in the renderer
  Assert<Equal<AnyIn<Api>, never>>
]
