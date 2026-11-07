// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * One browser tab's site-permission requests (spec 025, 025-FR-019; design
 * `site-prompts.html`, permission kind).
 *
 * A request is decided, in order:
 *
 * 1. a saved **Block** for any permission it asks for denies it, with no prompt;
 * 2. a saved **Allow** – or an **Allow once** of this page load – for every
 *    permission it asks for grants it, with no prompt;
 * 3. a prompt closed without an answer (or screen sharing blocked) on this
 *    page load denies it, with no prompt, until the next load;
 * 4. otherwise it queues a prompt in the strip, naming the permissions still
 *    undecided.
 *
 * Answers: **Allow** saves Allow and grants; **Allow once** (camera and
 * microphone only) grants for this page load; **Block** saves Block and
 * denies; **Dismiss** denies for this page load. Screen sharing saves
 * nothing: its Allow grants this one request and its Block counts as a
 * dismissal. A prompt withdrawn – the page navigated, crashed, or the tab
 * closed – denies. After any answer the queued requests are decided again,
 * so a second identical request does not ask twice.
 *
 * {@link TabPermissions.newLoad} runs on every committed main-frame
 * navigation: once-grants and dismissals end with the page that earned them.
 */
import type { SitePermission, StripRow } from '../../../../shared/ipc/browser-tab-schema'
import type { BrowserPermissionStore } from './permissionStore'
import { NEVER_SAVED, permissionAnswers, permissionPromptText } from './sitePermissions'
import type { PromptOutcome, PromptSpec, TabStrip } from './tabStrip'

/** A request the broker decides: who asks, inside which page, for what. */
export interface PermissionAsk {
  readonly requesting: string
  readonly top: string
  readonly permissions: readonly SitePermission[]
}

/** How the prompt names origins: formatted text and display parts (main's `originFormat`). */
export interface OriginDisplay {
  text(origin: string): string
  parts(origin: string): NonNullable<StripRow['requester']>['origin'] | null
}

export interface TabPermissionsDeps {
  readonly strip: TabStrip
  readonly store: BrowserPermissionStore
  readonly display: OriginDisplay
}

type Verdict = 'grant' | 'deny' | 'ask'

interface Waiting {
  readonly ask: PermissionAsk
  readonly rowId: string
  readonly done: (granted: boolean) => void
}

export class TabPermissions {
  /** Keys granted by **Allow once** on this page load. */
  private readonly onceGrants = new Set<string>()
  /** Keys whose prompt was closed without an answer on this page load. */
  private readonly dismissed = new Set<string>()
  private readonly waiting = new Map<string, Waiting>()

  constructor(private readonly deps: TabPermissionsDeps) {}

  /** Decide `ask`, prompting when nothing decides it; `done` is called once. */
  request(ask: PermissionAsk, done: (granted: boolean) => void): void {
    if (ask.permissions.length === 0) {
      done(false)
      return
    }
    const verdict = this.verdict(ask)
    if (verdict !== 'ask') {
      done(verdict === 'grant')
      return
    }
    const undecided = this.undecided(ask)
    // The strip may settle at once (a closed tab), before `ask` returns the id.
    let rowId: string | null = null
    let settled = false
    rowId = this.deps.strip.ask(this.promptSpec(ask, undecided), (outcome) => {
      settled = true
      if (rowId !== null) this.waiting.delete(rowId)
      this.settle({ ...ask, permissions: undecided }, outcome, done)
      this.redecideWaiting()
    })
    if (!settled) this.waiting.set(rowId, { ask, rowId, done })
  }

  /** The synchronous permission check: true only when every permission is already allowed. */
  check(ask: PermissionAsk): boolean {
    return ask.permissions.length > 0 && this.verdict(ask) === 'grant'
  }

  /** A new page committed: once-grants and dismissals of the old page end. */
  newLoad(): void {
    this.onceGrants.clear()
    this.dismissed.clear()
  }

  private settle(ask: PermissionAsk, outcome: PromptOutcome, done: (granted: boolean) => void): void {
    if ('withdrawn' in outcome) {
      done(false)
      return
    }
    const screen = ask.permissions.some((p) => NEVER_SAVED.has(p))
    switch (outcome.answer) {
      case 'allow':
        if (!screen) void this.deps.store.set(ask.requesting, ask.top, ask.permissions, 'allow')
        done(true)
        return
      case 'allowOnce':
        for (const p of ask.permissions) this.onceGrants.add(key(ask.requesting, ask.top, p))
        done(true)
        return
      case 'block':
        if (screen) this.dismiss(ask)
        else void this.deps.store.set(ask.requesting, ask.top, ask.permissions, 'block')
        done(false)
        return
      default:
        this.dismiss(ask)
        done(false)
    }
  }

  private dismiss(ask: PermissionAsk): void {
    for (const p of ask.permissions) this.dismissed.add(key(ask.requesting, ask.top, p))
  }

  /** Queued requests an answer now decides leave the queue with that decision. */
  private redecideWaiting(): void {
    for (const entry of [...this.waiting.values()]) {
      const verdict = this.verdict(entry.ask)
      if (verdict === 'ask') continue
      this.waiting.delete(entry.rowId)
      this.deps.strip.remove(entry.rowId)
      entry.done(verdict === 'grant')
    }
  }

  private verdict(ask: PermissionAsk): Verdict {
    const { store } = this.deps
    if (ask.permissions.some((p) => store.get(ask.requesting, ask.top, p) === 'block')) return 'deny'
    if (this.undecided(ask).length === 0) return 'grant'
    if (ask.permissions.some((p) => this.dismissed.has(key(ask.requesting, ask.top, p)))) return 'deny'
    return 'ask'
  }

  /** The permissions of `ask` that neither a saved Allow nor an Allow once covers. */
  private undecided(ask: PermissionAsk): SitePermission[] {
    return ask.permissions.filter(
      (p) =>
        NEVER_SAVED.has(p) ||
        (this.deps.store.get(ask.requesting, ask.top, p) !== 'allow' &&
          !this.onceGrants.has(key(ask.requesting, ask.top, p)))
    )
  }

  private promptSpec(ask: PermissionAsk, permissions: readonly SitePermission[]): PromptSpec {
    const { display } = this.deps
    const inside = ask.requesting === ask.top ? null : ask.top
    const spec: PromptSpec = {
      kind: 'permission',
      text: permissionPromptText(display.text(ask.requesting), inside === null ? null : display.text(inside), permissions),
      answers: permissionAnswers(permissions),
      permissions: [...permissions],
      remembered: permissions.some((p) => NEVER_SAVED.has(p)) ? 'never' : this.deps.store.persistence
    }
    const origin = display.parts(ask.requesting)
    if (origin !== null) {
      spec.requester = { origin, inside: inside === null ? null : display.parts(inside) }
    }
    return spec
  }
}

function key(requesting: string, top: string, permission: SitePermission): string {
  return JSON.stringify([requesting, top, permission])
}
