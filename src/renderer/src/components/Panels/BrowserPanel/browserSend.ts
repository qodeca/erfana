// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Sending a held capture to the agent (spec 025, 025-FR-031, 025-FR-032,
 * 025-FR-046, 025-FR-060, 025-FR-061; solution design § 6.2 and § 9.3;
 * commit 19).
 *
 * 1. **No terminal** – the guard's `noTerminal`, without asking main.
 * 2. **`writeCapture`** – main runs the shell guard first and writes nothing
 *    when it refuses (`{ guard }`); otherwise it writes the context file,
 *    the screenshot and the crop and answers their project-relative paths.
 * 3. **The prompt** – the action's template (`browser-explain`, …) through
 *    `executePromptTemplate` to the chosen terminal: `@` file references and
 *    the user's instruction only, no page text (025-FR-036); control
 *    characters stripped and one bracketed paste, then Enter (the send slice,
 *    `sendToTerminalId`); the terminal panel is revealed without moving focus
 *    and never opened or waited for.
 * 4. **A failed terminal write** deletes the files just written
 *    (`discardCaptureFiles`); the capture stays held for a retry (025-FR-046).
 * 5. **Success** tells main `closePick` with `sent`: pick mode ends, the page
 *    unfreezes and the capture is released (025-FR-032).
 *
 * Toasts and banners are the caller's: this answers what happened.
 */
import type { CaptureGuardSchema, WriteCaptureResponse } from '../../../../../shared/ipc/browser-tab-schema'
import type { PromptVariables } from '../../../prompts/types'
import type { PromptResult } from '../../../utils/panelUtils'
import type { z } from 'zod'

/** The four web actions (025-FR-030). */
export type SendAction = 'explain' | 'ask' | 'change' | 'prompt'

/** The action's name as the send notice says it ("Sent Explain to …", deck *Send notice*). */
export const ACTION_NAMES: Readonly<Record<SendAction, string>> = Object.freeze({
  explain: 'Explain',
  ask: 'Ask',
  change: 'Change',
  prompt: 'Prompt'
})

export type CaptureGuard = z.infer<typeof CaptureGuardSchema>

/** One send. */
export interface SendRequest {
  readonly tabId: string
  readonly captureId: string
  /** The target terminal, or `null` when none is open. */
  readonly terminalId: string | null
  /** The target's name, for the failure reason. */
  readonly terminalName: string
  readonly action: SendAction
  /** The dialog's instruction; `''` for Explain. */
  readonly instruction: string
  /** The reviewer answered a wrapper or unknown banner with **Send anyway** (S-23). */
  readonly sendAnyway?: boolean
}

/** What a send came to. */
export type SendOutcome =
  | { readonly kind: 'sent'; readonly contextPath: string }
  | { readonly kind: 'guard'; readonly guard: CaptureGuard }
  | { readonly kind: 'failed'; readonly reason: string }

/** What the send needs from the window. */
export interface SendDeps {
  readonly writeCapture: (request: { tabId: string; captureId: string; terminalId: string; sendAnyway?: true }) => Promise<WriteCaptureResponse>
  readonly discardCaptureFiles: (tabId: string, captureId: string) => Promise<unknown>
  readonly closeSent: (tabId: string, captureId: string) => Promise<unknown>
  readonly executePrompt: (promptId: string, variables: PromptVariables, terminalId: string) => Promise<PromptResult>
}

/** The template of each action (`prompts/templates/browser-*.md`). */
export function templateOf(action: SendAction): string {
  return `browser-${action}`
}

/**
 * Send the held capture with `request.action`.
 *
 * @param deps - {@link SendDeps}
 * @param request - {@link SendRequest}
 * @returns {@link SendOutcome}; never rejects
 */
export async function sendCapture(deps: SendDeps, request: SendRequest): Promise<SendOutcome> {
  const { tabId, captureId, terminalId } = request
  if (terminalId === null) return { kind: 'guard', guard: { kind: 'noTerminal', process: null } }
  let written: WriteCaptureResponse
  try {
    written = await deps.writeCapture({ tabId, captureId, terminalId, ...(request.sendAnyway === true ? { sendAnyway: true } : {}) })
  } catch {
    return { kind: 'failed', reason: "Erfana couldn't save the capture files" }
  }
  if ('guard' in written) return { kind: 'guard', guard: written.guard }
  if ('error' in written) return { kind: 'failed', reason: written.error }
  const variables: PromptVariables = {
    selectedText: '',
    filePath: '',
    fullDocument: '',
    userInput: request.instruction,
    contextRef: `@${written.paths.context}`,
    screenshotRef: `@${written.paths.screenshot}`,
    cropRef: `@${written.paths.crop}`
  }
  let result: PromptResult
  try {
    result = await deps.executePrompt(templateOf(request.action), variables, terminalId)
  } catch {
    result = { success: false }
  }
  if (!result.success) {
    await deps.discardCaptureFiles(tabId, captureId).catch(() => undefined)
    return { kind: 'failed', reason: `Erfana couldn't type into ${request.terminalName}` }
  }
  await deps.closeSent(tabId, captureId).catch(() => undefined)
  return { kind: 'sent', contextPath: written.paths.context }
}
