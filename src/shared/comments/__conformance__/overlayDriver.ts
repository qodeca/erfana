// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The driver the shared overlay behaviour suite runs against (spec 024,
 * 024-FR-001; architecture note
 * specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md § 2).
 *
 * One comment overlay behaviour, two hosts: the HTML overlay in the sealed page
 * preload and the renderer overlay of the Markdown (and `.txt`) previews. Each
 * host implements this driver over its own fixture and runs `overlay.suite.ts`.
 * The driver speaks in the suite's abstract target ids and CSS-pixel points
 * only, never in DOM nodes, tokens or channels, so a host can map them however
 * its page is built.
 *
 * Test-only and type-only apart from the fixture geometry: no imports.
 */

/** The fixture's targets: what a host lays out before the suite runs. */
export type OverlayTargetId = 'container' | 'first' | 'inner' | 'second' | 'long'

/** A target's border box, in the host's viewport CSS pixels. */
export interface OverlayTargetBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The fixture every host lays out. `container` holds `first`, `second` and
 * `long`; `first` holds `inner`. Each target holds some text (a word at least),
 * so a host can make a non-collapsed selection inside it. Boxes do not
 * overlap except by nesting, and every box is larger than the tiny-element
 * ring threshold, so an outline is drawn on the box itself.
 */
export const OVERLAY_FIXTURE: Readonly<Record<OverlayTargetId, { readonly parent: OverlayTargetId | null; readonly box: OverlayTargetBox }>> = {
  container: { parent: null, box: { left: 0, top: 0, width: 600, height: 400 } },
  first: { parent: 'container', box: { left: 20, top: 20, width: 260, height: 120 } },
  inner: { parent: 'first', box: { left: 40, top: 60, width: 100, height: 30 } },
  second: { parent: 'container', box: { left: 20, top: 200, width: 260, height: 120 } },
  long: { parent: 'container', box: { left: 320, top: 20, width: 260, height: 120 } }
}

/** A point given as an offset from a target's box centre. */
export interface GesturePoint {
  readonly target: OverlayTargetId
  readonly dx?: number
  readonly dy?: number
}

/** `point` in the host's viewport CSS pixels. */
export function fixturePointOf({ target, dx = 0, dy = 0 }: GesturePoint): { readonly x: number; readonly y: number } {
  const { left, top, width, height } = OVERLAY_FIXTURE[target].box
  return { x: left + width / 2 + dx, y: top + height / 2 + dy }
}

/** How deep `target` sits in the fixture: 0 for `container`. */
function fixtureDepth(target: OverlayTargetId): number {
  const parent = OVERLAY_FIXTURE[target].parent
  return parent === null ? 0 : fixtureDepth(parent) + 1
}

/**
 * The innermost fixture target whose box holds the viewport point, or `null`.
 * For a host that cannot hit-test a point (jsdom has no layout): it maps the
 * suite's points onto its own elements, flat or nested, by this one rule.
 */
export function fixtureTargetAt(x: number, y: number): OverlayTargetId | null {
  const holding = (Object.keys(OVERLAY_FIXTURE) as OverlayTargetId[]).filter(target => {
    const { left, top, width, height } = OVERLAY_FIXTURE[target].box
    return x >= left && x < left + width && y >= top && y < top + height
  })
  return holding.sort((a, b) => fixtureDepth(b) - fixtureDepth(a))[0] ?? null
}

/** Modifier keys held during a gesture. */
export interface GestureModifiers {
  readonly shift?: boolean
  readonly alt?: boolean
  readonly ctrl?: boolean
  readonly meta?: boolean
}

/**
 * What the overlay asked its host to do. `open` = open the comment window on
 * the target, `menu` = show the element menu, `exit` = leave comment mode.
 * `target` is `null` for a pick that names no target (`exit`), or names one
 * the fixture does not know.
 */
export interface OverlayPick {
  readonly kind: 'open' | 'menu' | 'exit'
  readonly via: 'pointer' | 'keyboard'
  readonly target: OverlayTargetId | null
}

/** A key press as `KeyboardEvent` names it; the driver presses and releases it with focus in the page. */
export interface PickerKeyPress extends GestureModifiers {
  readonly key: string
  readonly code: string
}

/** A layer Esc can close, top first: the element menu, the comment window, comment mode, Find. */
export type OverlayLayer = 'menu' | 'window' | 'mode' | 'find'

/** The layers a host may not own (it then leaves the method out and the suite skips, naming why). */
export type HostedLayer = Exclude<OverlayLayer, 'mode'>

/** A part of the overlay a host may leave out, with the reason it gives in `notOwned`. */
export type OptionalPart = HostedLayer | 'modeIndicator' | 'floatingLabel' | 'pickFocus'

/**
 * One host's overlay, on the fixture, ready for one test. Gestures are trusted
 * user input, delivered as the browser would deliver them (pointer events,
 * mouse events, `click` with its `detail`, `dblclick`, `contextmenu`), each
 * preceded by a pointer move to its first point. Every gesture starts a fresh
 * rate-limit window, so a test never trips the host's pick limiter by accident.
 */
export interface OverlayDriver {
  /** The host's name, for messages. */
  readonly host: string
  /**
   * Whether the host draws a floating label at the outline (differences table
   * D-05: the HTML overlay does; the Markdown host does not – its mode tab
   * names the target). Without one, `labels` and `labelText` are the mode
   * tab's words, and the label-format case skips with `notOwned.floatingLabel`.
   */
  readonly floatingLabel: boolean
  /**
   * What the label reads for each target in this host: the floating label's
   * `name size` (e.g. `button#buy.cta 100×30`), or – with no floating label –
   * the mode tab's words while that target is outlined.
   */
  readonly labels: Readonly<Record<OverlayTargetId, string>>
  /** The mode indicator's words while comment mode is on and nothing is outlined (A-03: each host's own text). */
  readonly modeIndicatorIdle: string
  /**
   * Who a right-click outside comment mode belongs to (differences table
   * D-11): `page` – the HTML page owns it; `menu` – the overlay asks for the
   * Markdown Preview's own menu, comment items first, and the page never sees it.
   */
  readonly rightClickOutsideMode: 'page' | 'menu'
  /** The word each target's end sentence uses (D-04: "section" in HTML, the kind noun in Markdown). */
  readonly kinds: Readonly<Record<OverlayTargetId, string>>
  /** Why each part the host does not own is not here; read by the suite when it skips. */
  readonly notOwned?: Readonly<Partial<Record<OptionalPart, string>>>

  /** Turn comment mode on, the way the host's toolbar or shortcut does. */
  modeOn(): void
  /** Turn comment mode off, the way the host's toolbar or shortcut does. */
  modeOff(): void
  /** Turn comment mode on from the keyboard, with no mouse: settled once the picker has started. */
  modeOnByKeys(): void | Promise<void>
  /** Whether comment mode is on, as the overlay itself sees it. */
  isModeOn(): boolean
  /** The comment-mode indicator's words while it is shown, else `null`. Optional: see `notOwned.modeIndicator`. */
  modeIndicatorText?(): string | null

  /** The mode tab has moved away from the top edge (A-03, I-19). */
  modeTabMovedAway(): boolean

  /** The targets the host laid out (the whole fixture). */
  targets(): readonly OverlayTargetId[]

  /** Move the pointer to `point` (no button). */
  hover(point: GesturePoint): void
  /** One primary click. */
  click(target: OverlayTargetId, modifiers?: GestureModifiers): void
  /** A primary double click: two clicks (`detail` 1, 2) and a `dblclick`. */
  doubleClick(target: OverlayTargetId): void
  /** A primary triple click: three clicks (`detail` 1, 2, 3) and a `dblclick` after the second. */
  tripleClick(target: OverlayTargetId): void
  /**
   * Press at `from`, move to `to` in small steps, release there. The `click`
   * that follows goes where the browser sends it: to the nearest element that
   * holds both the press and the release target.
   */
  drag(from: GesturePoint, to: GesturePoint): void
  /** Make a non-collapsed text selection inside `target` (as a finished mouse or keyboard selection leaves it). */
  selectText(target: OverlayTargetId): void
  /** The text currently selected in the page, `''` when none. */
  selectedText(): string
  /** A secondary-button press: down, up, `contextmenu`, `auxclick`. */
  rightClick(target: OverlayTargetId): void
  /** A middle-button press: down, up, `auxclick`. */
  middleClick(target: OverlayTargetId): void
  /** Press and release Esc with focus in the page. */
  pressEscape(): void
  /** Press Enter with focus in the page. */
  pressEnter(): void
  /** Press Alt+Up with focus in the page: the picker climbs one level. */
  levelUpByKeys(): void
  /** Press and release one key with focus in the page. */
  pressKey(press: PickerKeyPress): void
  /** The last sentence the picker said at a level end, else `null`. */
  saidAtEnd(): string | null
  /** End a pick with nothing written: the menu or window it opened is gone (HTML: both are outside the page). */
  cancelPick(): void | Promise<void>
  /** Move the pick by keys, so real focus sits on the target. Optional: see `notOwned.pickFocus`. */
  pickByKeys?(): void
  /** Focus is on something that can hold it inside the preview, never `<body>` or a target that lost its `tabindex`. */
  focusHeldInPreview?(): boolean

  /** A key asked for the menu outside comment mode, with no pointer (HTML: the pick main checks; K-1). */
  keyboardMenuAsked(): boolean
  /** Every pick so far, oldest first. */
  picks(): readonly OverlayPick[]
  /** The target the last pointer or keyboard pick named, or `null`. */
  pickedTarget(): OverlayTargetId | null
  /** The target the overlay's outline is on now, or `null` when no outline is drawn. */
  outlinedTarget(): OverlayTargetId | null
  /** Whether the outline is drawn in its selected (picked) state. */
  outlineSelected(): boolean
  /**
   * Hover `target` (in comment mode) and return the label it shows, `name size`
   * – or the mode tab's words for a host with no floating label; `null` when
   * none is drawn.
   */
  labelText(target: OverlayTargetId): string | null
  /** The event types the page's own listeners saw during the last gesture or key press, in order. */
  pageSaw(): readonly string[]

  /** The top layer Esc would close now, or `null`. */
  openLayer(): OverlayLayer | null
  /** Open a layer the host owns (`menu` and `window` on `target`), settled when it is shown. Optional: see `notOwned`. */
  open?(layer: HostedLayer, target?: OverlayTargetId): void | Promise<void>

  /** Remove everything the driver added. */
  dispose(): void | Promise<void>
}

/** The Comment button as drawn: where it is, and whether it went below the line. */
export interface DrawnCommentButton {
  readonly top: number
  readonly below: boolean
}

/** {@link OverlayDriver} plus what `selection.suite.ts` needs: a selection drawn on a line the suite chooses. */
export interface SelectionDriver extends OverlayDriver {
  /** Words selected in `target`, drawn on one line at `line`, as a finished selection leaves them. */
  selectWords(target: OverlayTargetId, line: OverlayTargetBox): void
  /** The same by a mouse: press, words selected, release, and the `click` that ends it. */
  dragSelect(target: OverlayTargetId, line: OverlayTargetBox): void
  /** Settled once the button's wait after a mouse selection has passed. */
  waitForButton(): Promise<void>
  /** The selection's line is now at `line`, and the preview says it scrolled. */
  scrollSelection(line: OverlayTargetBox): void
  /** A page script clears the selection, with no input; settled well past any wait the host keeps. */
  clearSelectionByScript(): Promise<void>
  /** The Comment button, while it is drawn. Reading it forces no redraw. */
  commentButton(): DrawnCommentButton | null
  /** Whether the last keyboard pick carried selected words. */
  lastPickHadWords(): Promise<boolean>
  /** Whether the menu the last right-click asked for is about the selected words. */
  menuAboutWords(): Promise<boolean>
}

/**
 * Where focus sits in the panel, off the page: the mode toggle, the drawer, the
 * Find field, or dockview's group element (where a tab switch leaves it).
 */
export type ModeLeavePlace = 'toggle' | 'drawer' | 'find' | 'group'

/** One preview's whole panel, for leaving comment mode. Driven by keys only, after turning the mode on as a mouse does. */
export interface ModeLeaveDriver {
  /** Turn comment mode on with a mouse click on the toggle: focus stays there and the page has none. */
  modeOn(): Promise<void>
  /** Whether comment mode is on, as the toolbar shows it. */
  isModeOn(): boolean
  /** Put focus on `place` (opening the drawer or Find first when it is one of those). */
  focusOn(place: ModeLeavePlace): Promise<void>
  /** Press Esc at `place`, settled; true when the key was left unclaimed (`preventDefault` not called). */
  pressEscape(place: ModeLeavePlace, modifiers?: GestureModifiers): Promise<boolean>
  /** Press Esc with focus in another panel, such as the terminal. */
  pressEscapeOutside(): Promise<void>
  /** Whether the Find bar is open. */
  findOpen(): boolean
  /** Where focus is now, or `null` for anywhere else. */
  focused(): ModeLeavePlace | null
  /** dockview hides or shows this tab. */
  setTabShown(shown: boolean): Promise<void>
  /** Remove everything the driver added. */
  dispose(): void | Promise<void>
}

/**
 * {@link ModeLeaveDriver} plus the panel's other keys: the step keys, the mode
 * shortcut and Esc from the preview itself, with no mouse.
 */
export interface PanelKeyDriver extends ModeLeaveDriver {
  /** The file has one open comment (call before anything else). */
  withComment(): Promise<void>
  /** Press Alt+F9 at `place`, settled. */
  pressStep(place: ModeLeavePlace): Promise<void>
  /** Press the mode shortcut at `place`, settled. */
  pressModeKey(place: ModeLeavePlace): Promise<void>
  /** Esc with keyboard focus in the preview, in comment mode, settled. */
  pressEscapeInPreview(): Promise<void>
  /** The keyboard reached the preview and the picker can act there. */
  keysInPreview(): boolean
  /** A comment window is open. */
  windowOpen(): boolean
  /** The last sentence the panel said politely; it lands a frame after the key. */
  said(): string
}

/** Who the reader is to the comment window: nobody yet, a name in Settings with the notice unseen, or all set. */
export type WindowRulesIdentity = 'none' | 'notice-unseen' | 'ready'

/** What one test opens: a thread on a writable file (a teammate's). */
export interface WindowRulesSetup {
  readonly identity: WindowRulesIdentity
  /** An editor in this window holds the file (`dirty`), and the file also changed on disk (`conflict`). */
  readonly editor?: 'clean' | 'dirty' | 'conflict'
  /** Main refuses every write as unsaved, though this window's tabs are clean. */
  readonly refusedUnsaved?: boolean
  /** The threads of the file, in order; the first is the one shown. One open thread by default. */
  readonly threads?: readonly WindowRulesThread[]
  /** The file cannot be written. */
  readonly readOnly?: boolean
  /** The file is at its comment limit: replies and resolves work, a new comment does not (F-04). */
  readonly full?: boolean
  /** Where the window opened: on its target in the preview (icon, underline, pick), or anywhere else (a drawer row, a step key). */
  readonly opened?: 'target' | 'elsewhere'
  /** The window came from a click in the page with comment mode off: one more key must not write (S-03 – S-05). */
  readonly outsideMode?: boolean
}

/** One thread of the fixture: plain open, Changed (S-03), or Not found (S-05). */
export type WindowRulesThread = 'open' | 'changed' | 'not-found'

/** What holds focus in the window. `window` is the frame itself, which draws no ring. */
export type WindowFocus = 'title' | 'resolve' | 'resolve-next' | 'window' | 'other'

/**
 * The comment window as a host mounts it, for the rules both previews share.
 * Driven by keys only: a person with no mouse can do everything here.
 */
export interface WindowRulesDriver {
  /** The host's name, for messages. */
  readonly host: string
  /** Whether main refuses a write for another window's unsaved edits (HTML asks about its own window only: D-61). */
  readonly seesOtherWindows: boolean
  /** The file's name as the banner's Save button says it. */
  readonly fileName: string
  /** Open the window on one open thread, settled when its first focus has landed. */
  open(setup: WindowRulesSetup): Promise<void>
  /** The view the window shows now. */
  view(): string
  /** Type into the reply field and send with the Save shortcut. */
  replyByKeys(text: string): Promise<void>
  /** Press Resolve with the keyboard. */
  resolveByKeys(): Promise<void>
  /** Answer the identity step with the keyboard: the name, then Continue. */
  continueByKeys(name: string): Promise<void>
  /** Press Esc. */
  pressEscape(): Promise<void>
  /** The writes that reached main, by operation. */
  writes(): readonly string[]
  /** What the reply field holds, `null` when no reply box is shown. */
  replyText(): string | null
  /** The names of the buttons in the window's unsaved or refusal banner. */
  bannerButtons(): readonly string[]
  /** The banner's words. */
  bannerText(): string
  /** Press the banner's button that saves the file, with the keyboard. */
  saveFromBannerByKeys(): Promise<void>
  /** Editor saved calls so far. */
  editorSaves(): number
  /** The focused element is inside the comment window, never `<body>`. */
  focusInWindow(): boolean
  /** What holds focus in the window now. */
  focused(): WindowFocus
  /** Step to the next comment with the keyboard (Alt+F9). */
  stepByKeys(): Promise<void>
  /** The shown thread is removed outside Erfana while the window is open (W-04). */
  removeShown(): Promise<void>
  /** The window's actions in order: the foot's buttons, then More actions' items, opened by keys. */
  actions(): Promise<readonly string[]>
  /** Open a message's `…` menu and choose Copy text, by keys alone: the menu's items, and what reached the clipboard. */
  copyTextByKeys(): Promise<{ readonly items: readonly string[]; readonly copied: readonly string[] }>
  /** Remove everything the driver added. */
  dispose(): void | Promise<void>
}

/** Where a comment's target is: in plain view, inside a closed section, or kept from showing any other way. */
export type RevealTarget = 'plain' | 'folded' | 'hidden'

/** "Show in preview" in one host, on a fixture holding one target of each {@link RevealTarget}. */
export interface RevealDriver {
  /** "Show in preview" on the comment on `target`, settled. */
  show(target: RevealTarget): Promise<void>
  /** The target last scrolled to, or `null`. */
  scrolledTo(): RevealTarget | null
  /** The target wearing the flash now, or `null`. */
  flashed(): RevealTarget | null
  /** The closed section around `folded` is open now. */
  sectionOpen(): boolean
  /** Settled once the flash's time has passed. */
  flashEnds(): Promise<void>
  /** Remove everything the driver added. */
  dispose(): void | Promise<void>
}

/** What had focus when the window opened (`gone-*`: and it left the document while the window was open). */
export type FocusOpener = 'drawer-row' | 'gone-row' | 'target' | 'gone-target' | 'toolbar' | 'nothing'

/** Why the window closed. `go-to-tab` is the one close that moves focus on by itself. */
export type FocusClose = 'escape' | 'close-button' | 'saved' | 'thread-gone' | 'go-to-tab'

/** Where focus ended up after the close. `body` is the failure this table exists to catch. */
export type FocusHome = 'opener' | 'drawer' | 'preview' | 'editor' | 'body'

/**
 * The comment window over a stage with a toolbar, a drawer, a preview and an
 * editor, for the focus-return table. Driven by keys only.
 */
export interface FocusTableDriver {
  /** Open the window from `opener`, on what `close` needs, settled when its first focus has landed. */
  open(opener: FocusOpener, close: FocusClose): Promise<void>
  /** Close the window for `close`, settled when it is gone. */
  close(close: FocusClose): Promise<void>
  /** Where focus is now; the page taking native focus back counts as `preview`. */
  home(): FocusHome
  /** Remove everything the driver added. */
  dispose(): void | Promise<void>
}
