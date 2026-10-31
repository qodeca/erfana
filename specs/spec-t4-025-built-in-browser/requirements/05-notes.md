# Notes

## Constraints

| ID | Constraint | Impact | Mitigation |
|----|-----------|--------|------------|
| 025-CA-001 | Google refuses sign-in in embedded browsers | Google sign-in may fail | Best effort only (025-FR-024); documented (025-FR-044) |
| 025-CA-002 | Electron has no password manager or Chrome extension store | No password saving, no extensions | Out of scope; cookies keep logins |
| 025-CA-003 | React source data exists only in dev builds and relies on unstable internals | Hints may break on a React update | Quiet fallback (025-FR-037) |
| 025-CA-004 | The browser engine updates only with Erfana releases | Unpatched engine if releases lag | 14-day release duty (025-NFR-002, 025-FR-041) |
| 025-CA-005 | Turning cookie encryption off later makes saved cookies unreadable | One-way door | Turn it on once, with this feature (025-FR-017) |

### 025-CA-001: Google sign-in in embedded browsers

**Type:** Technical

**Description:** Google treats apps that embed a browser engine and can inject scripts or read cookies as "embedded user-agents" and often refuses sign-in in them. A user-agent override works for some accounts only and may conflict with Google's terms.

**Impact:** Sites that only offer "Sign in with Google" may not be usable in the browser.

**Mitigation:** 025-FR-024 tries a clean user-agent string; the user guide states the limit (025-FR-044). The owner accepted shipping without Google sign-in.

**Traces to:** 025-FR-024, 025-FR-044

### 025-CA-002: No password manager or extensions in Electron

**Type:** Technical

**Description:** Electron ships Chromium without Chrome's password manager and supports only part of the extension system.

**Impact:** Passwords typed into sites' own forms are not saved; React DevTools and password-manager extensions are unavailable.

**Mitigation:** Cookies keep sessions (025-FR-015); basic-auth credentials are saved (025-FR-022); DevTools covers inspection (025-FR-013).

**Traces to:** 025-FR-013, 025-FR-015, 025-FR-022

### 025-CA-003: React source hints

**Type:** Technical

**Description:** React 19 removed the fiber `_debugSource` field; source locations now come from `_debugStack` and source maps. These are internals, not a stable API, and production builds strip them.

**Impact:** File and line hints can disappear after a React update and never exist for production builds.

**Mitigation:** Fall back to the component name, then to "source not found", and never block the send (025-FR-037). The owner chose to build without a proof-of-concept spike first.

**Traces to:** 025-FR-037, 025-NFR-003

### 025-CA-004: Engine security updates

**Type:** Business

**Description:** Chrome patches itself; Erfana's Chromium changes only when Erfana ships a newer Electron.

**Impact:** A slow release leaves users browsing arbitrary sites with publicly known holes.

**Mitigation:** The owner commits to an Erfana release within 14 days of each Electron security release, triggered by a separate Dependabot pull request.

**Traces to:** 025-NFR-002, 025-FR-041

### 025-CA-005: Cookie encryption is a one-way door

**Type:** Technical

**Description:** Electron's documentation states that disabling cookie encryption after enabling it leaves existing encrypted cookies unreadable.

**Impact:** Reverting 025-FR-017 would sign every user out of every site in every project.

**Mitigation:** Decide once; turn it on with the first browser release.

**Traces to:** 025-FR-017

---

## Assumptions

| ID | Assumption | Risk if invalid |
|----|-----------|-----------------|
| 025-CA-006 | The agent opens image and Markdown files from a path given in the prompt (true for Claude Code) | Other agents ignore the screenshot; precision drops |
| 025-CA-007 | The Qodeca team's apps that need sign-in mostly offer non-Google sign-in or basic auth | The browser is unusable for those apps |
| 025-CA-008 | The agent's own permission prompts are the main gate against prompt injection from page content | An agent run without permission checks can be steered by a hostile page |

---

## Accepted risks

Owner decisions taken knowingly in the 2026-10-31 interview:

| Risk | Decision | Where |
|------|----------|-------|
| Prompt injection from page content, with prompts submitted at once | Accepted; page content is labelled untrusted and the risk is documented | 025-FR-032, 025-FR-036, 025-FR-044 |
| Client data and form values sent as-is to the agent's AI provider | Accepted; documented | 025-FR-036, 025-FR-044 |
| `git clean -fdx` deletes the project's profile and captures | Accepted; documented | 025-FR-016, 025-FR-044 |
| Memory use grows with open tabs | Accepted; no unloading | 025-FR-007 |
| No feature flag or off-switch; a security issue is handled by a fast release only | Accepted | 025-FR-040, 025-NFR-002 |
| Full URLs in log files | Accepted; recorded exception to `redactUserInput` | 025-FR-042 |
| The builder grades the precision test (an independent grader was offered and declined) | Accepted | 025-NFR-003 |

---

## Dependencies

### Internal dependencies

| Dependency | Type | Status |
|------------|------|--------|
| `executePromptTemplate` and the prompt registry (`src/renderer/src/utils/panelUtils.ts`) | Required | Available |
| Terminal link handler (`createTerminalLinkHandler`, `terminalPanel.logic.ts`) | Required | Available – changes behaviour |
| Editor-area tab and panel system (`DockLayout`) | Required | Available |
| HTML Preview `WebContentsView` patterns and comment picker (spec 024) | Reference | Available |
| `capturePage` usage in `src/main/services/preview/` | Reference | Available |
| Electron fuses configuration | Required | Available – `EnableCookieEncryption` currently off |
| Design system (`docs/design-system/`) and `npm run design -- --check` | Required | Available |

### External dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Electron | 44 (current), kept current per 025-NFR-002 | `WebContentsView`, sessions, `capturePage`, permissions, certificates, DevTools |
| React (in reviewed apps) | 18 and 19 | Component and source hints (025-FR-037) |
| DuckDuckGo | – | Address-bar search fallback |

---

## Open to-dos before UI code

- Write the designs in `docs/designs/browser/` and link them in this spec's registry entry (`documents.designs`); until then 025-AC-043 cannot pass (025-FR-043).

## Open design questions for the solution design

These do not change what is built; they are left to the solution architect and recorded in the architecture note:

- How the pick overlay reaches cross-origin frames (`nodeIntegrationInSubFrames` with an isolated preload, as ADR 0005 does for comments, or a debugger-protocol approach) while keeping 025-NFR-001.
- How the page is frozen for 025-FR-028 (debugger pause or another mechanism).
- Whether the context-file prompt templates share the existing apply-to-document footer or need a web variant.

---

## References

- Grill-me interview, 2026-10-31 (this session) – source of every owner decision
- [VS Code – Integrated browser](https://code.visualstudio.com/docs/debugtest/integrated-browser)
- [VS Code – Manage context for AI](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- [Cursor forum – cannot select iframe elements](https://forum.cursor.com/t/browser-cannot-select-iframe-elements/141722)
- [Cursor forum – insert selection at cursor](https://forum.cursor.com/t/insert-browser-tab-element-selection-at-cursor-in-composer-not-always-at-end/167268)
- [Dandelion wiki – Google sign-in in Electron browsers](https://github.com/ChristianRelf/DandelionDEPRICATED/wiki/Troubleshooting)
- [firebase-js-sdk #2478 – user-agent workaround](https://github.com/firebase/firebase-js-sdk/issues/2478)
- [React issue #29092 – `_debugSource` removal](https://www.GitHub.com/facebook/react/issues/29092)
- `docs/adrs/0005-sub-frame-preload-one-receive-channel.md`
- `specs/spec-t3-024-unified-comments/`
