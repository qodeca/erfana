# ADR 0006: Overlay core in the sealed preload

- **Status**: accepted (owner decision Q4, 2026-10-29) – security-auditor review of the change pending (spec 024 § 8 C21)
- **Date**: 2026-10-29
- **Deciders**: Marcin Obel, Claude Code (spec 024 architecture note and expert panel)
- **Related**: amends [ADR 0005](./0005-sub-frame-preload-one-receive-channel.md) decision 6 only · [spec 024 architecture note](../../specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md) § 2 (overlay decision C), § 6 commit 9, § 7 Q4, § 8 C15, C16, C21 · [024-NFR-005](../../specs/spec-t3-024-unified-comments/requirements/02-requirements.md) items 1 and 3 · [`src/shared/comments/overlayCore/`](../../src/shared/comments/overlayCore/pinLayout.ts) · [`src/preload/previewPageComments/`](../../src/preload/previewPageComments/index.ts)

## Context

Spec 024 brings comments to the Markdown preview, and later to other text previews, with the same feel as HTML Preview comments: pins that step and stack the same way, the same click-versus-drag rule, the same comment-mode behaviour. The HTML overlay must stay in the preview-page preload – it runs inside the untrusted page, in a closed shadow root, and in every frame – while the other previews draw from a renderer-hosted overlay. Two hosts, one behaviour.

The rules both hosts must agree on are small and numeric: the pin's 24 px box, the 4 px tip offset and edge inset, the 22 px stack step and the 8-step cap; "a move of 4 px or more, or a selection holding words, selects – anything else picks"; and what turning comment mode on and off, and Esc, do. Kept as two copies, they drift silently – the drift `previewPageComments/contract.test.ts` already guards against for the constants the preload repeats from main.

ADR 0005 decision 6 forbids the obvious fix. The preview-page preload may import only `ipcRenderer` from `electron` and its own `./` siblings, so a shared module cannot reach it. The build adds a second constraint: two preload entries must never share a module (#73), because a shared chunk is a `require()` a sandboxed preload cannot satisfy.

Three options were weighed in the architecture note (§ 2): one overlay loaded in both places (it would put renderer and Markdown code inside the untrusted page, and React cannot run there), two independent overlays (they drift), or **two hosts sharing a small pure core**.

## Decision

The preview-page preload may import **exactly one folder outside its own entry: `src/shared/comments/overlayCore/`**, and only the modules directly in it. Everything in that folder is pure: no imports at all, no globals, no DOM, nothing run on load, no module state. Today it holds:

- `pinLayout.ts` – the pin constants and `placePin` (plus the `clipToViewport` and `overlaps` it runs on). The preload's `pins.ts`, `geometry.ts` and `constants.ts` now use these instead of their own copies.
- `modeState.ts` – `reduceCommentMode`, the comment-mode state machine (`set` from the window; Esc while on leaves the mode, tells the window and keeps the key from the page; Esc while off is the page's). The preload's controller follows its steps.
- `gesture.ts` – `classifyGesture`, the select-or-pick rule. Not wired into the preload yet: v0.23.1 picks on a drag, and the selection commit of spec 024 turns the rule on in both previews at once.

This amends **ADR 0005 decision 6 only**, and only its import allow-list.

ADR 0005 **decision 2 is untouched**: the one receive channel still carries no comment text, author names or emails. Spec 024's selection comments add selection offsets to `commentState` – character offsets within the target's text, numbers only, never strings (§ 8 C16); main checks the selected words against its own parse of the file on disk. The overlay core never receives or produces a string from a comment either: its inputs are numbers and booleans.

The page-reachable surface does not change: no API, channel, listener or message field is added. `src/preload/previewPage.surface.pin.test.ts` and its snapshot pass unchanged.

## Consequences

**What the page can and cannot do.** Nothing new. The core runs in the preload's isolated world like the rest of the overlay, is bundled into the same single `previewPage.js`, and can only compute: it cannot reach the DOM, IPC, Node or Electron, and holds no state between calls. A hostile page cannot reach it, and it has nothing the page could use.

**The cost: a wider review surface.** A change to any file in `overlayCore` is a change to code running inside the sealed page, even when it is made for the Markdown preview. The guards below make that visible: a file there that gains an import, a host global or a load-time effect fails a unit test before review.

**Guards**

| Guard | What it fails on | Where |
|---|---|---|
| Contract scan on the syntax tree | Any module the overlay names – import, re-export, `require()`, `import()` – that does not resolve to a file directly in `previewPageComments/` or directly in `overlayCore/` (resolved paths, so `..`, aliases, subfolders and packages fail); `electron` anywhere but `index.ts`, or for anything but `ipcRenderer`. ADR 0005's text bans (`contextBridge`, `webFrame`, `postMessage`, `invoke`, `sendSync`, a second listener, `preventDefault` outside `swallow`, markup and `<style>` writes) now scan `overlayCore` too | `src/preload/previewPage.contract.test.ts` (tests named `024-AC-028 …`) |
| Pure core | A file in `overlayCore` that names any module; touches a DOM, Node or Electron global (`window`, `document`, `globalThis`, `self`, `navigator`, `process`, `require`, `ipcRenderer`, timers, `fetch`, `Date`, DOM types – checked with the type checker against the ES2022 library alone, so only names bound in the file and `Math` pass; `Math.random` fails); runs code on load or keeps a module-level `let`; or a subfolder appears. Each rule is also proved against a bad sample, so it cannot pass by finding nothing | `src/preload/overlayCore.contract.test.ts` (tests named `024-AC-028 …`), scans in `src/preload/__tests__/sourceScan.ts` |
| Build guard | Any preload output other than the `previewPage` entry that bundles a module from `src/shared/comments/overlayCore/` – including one only that entry imports, which the older shared-chunk check let Rollup inline silently | `assertSelfContainedPreloads` in `electron.vite.config.ts` |
| Same rules, one copy | The core's numbers and transitions drifting from v0.23.1 | `src/shared/comments/overlayCore/*.test.ts` (tests named `024-AC-001 …`); the preload's own tests and `overlay.conformance.test.ts`, unchanged |

The build guard is not the security control; the contract scan and the pure-core test are.

**Review.** The `security-auditor` reviews this change (spec 024 commit 9) when it lands, and again as part of the full spec 024 pull request (§ 8 C21). Widening the allow-list further – a second folder, a subfolder, or any import inside `overlayCore` – needs a new ADR and the same review.

## Alternatives considered

### One overlay implementation loaded in both places

- **Pros**: cannot drift.
- **Cons**: runs renderer and Markdown code inside the untrusted page; breaks the no-markup rule; React cannot run in the preload. The hosts' needs also differ (closed shadow root and drawn boxes versus `CSS.highlights`, hidden pins versus real buttons, a label versus a mode tab).
- **Verdict**: rejected – it widens the sealed box far more than one pure folder.

### Two independent overlays, nothing shared

- **Pros**: the preload contract stays as it is.
- **Cons**: pin steps, the stack cap and the click-versus-drag threshold drift silently between previews.
- **Verdict**: rejected – the drift is the defect spec 024 sets out to remove.

### Copy the core into the preload and pin the copies with a test

- **Pros**: no change to decision 6; the pattern `previewPageComments/contract.test.ts` already uses for main's constants.
- **Cons**: works for constants, not for functions: two copies of `placePin` or the mode machine can agree on every pinned sample and still differ elsewhere.
- **Verdict**: rejected – one copy is the only reliable way to keep behaviour identical.

## References

- `src/shared/comments/overlayCore/` – `pinLayout.ts`, `modeState.ts`, `gesture.ts` and their tests
- `src/preload/previewPage.contract.test.ts` – SEC-01, SEC-02, SEC-22 and the `024-AC-028` import rule on the syntax tree
- `src/preload/overlayCore.contract.test.ts` – the pure-core rules, each proved against a bad sample
- `src/preload/previewPage.surface.pin.test.ts` – the page-reachable surface, unchanged
- `src/preload/previewPageComments/overlay.conformance.test.ts` – the v0.23.1 overlay behaviour, unchanged
- `electron.vite.config.ts` – `assertSelfContainedPreloads`
