# Notes

## Constraints

| ID | Constraint | Impact | Mitigation |
|----|-----------|--------|------------|
| 025-CA-001 | Google refuses sign-in in embedded browsers | Google sign-in may fail | Best effort only (025-FR-024); documented (025-FR-044) |
| 025-CA-002 | Electron has no password manager or Chrome extension store | No password saving, no extensions | Out of scope; cookies keep logins |
| 025-CA-003 | React source data exists only in dev builds and relies on unstable internals | Hints may break on a React update | Quiet fallback (025-FR-037) |
| 025-CA-004 | The browser engine updates only with Erfana releases | Unpatched engine if releases lag | 14-day release duty (025-NFR-002, 025-FR-041) |
| 025-CA-005 | Turning cookie encryption on is one-way, applies to the whole app, and keeps the key outside the project | Every user pays a start-up cost; a profile copied to another machine or account starts signed out; dev and unpackaged runs do not encrypt | ADR 0010; 025-NFR-010 budget; packaged test lane; user-guide note (025-FR-017) |
| 025-CA-009 | Erfana keeps the `GrantFileProtocolExtraPrivileges` fuse on because its window loads from `file://` | Raw `file://` pages could read the disk | Local files confined (025-FR-005, rule 1), decided in ADR 0012 before any local file loads |

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

**Mitigation:** Read framework-neutral source attributes first, then React hints, within a 750 ms limit; fall back to the component name, then to "source not found", and never block the send (025-FR-037). The owner chose to build without a proof-of-concept spike first, and reconfirmed it on 2026-11-01.

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

**Mitigation:** Decide once; turn it on with the first browser release. ADR 0010 supersedes the decision recorded in `scripts/fuses.js` (lines 705–709). The fuse applies to the whole app, so its start-up cost has a budget (025-NFR-010); unpackaged and dev runs do not apply fuses, so the encryption checks run on packaged builds only; the key lives in the operating system, so a profile copied to another machine or account starts signed out (025-FR-015).

**Traces to:** 025-FR-017, 025-NFR-010

### 025-CA-009: The file fuse stays on

**Type:** Technical

**Description:** `scripts/fuses.js` sets `GrantFileProtocolExtraPrivileges: true` because Erfana's own window loads from `file://`. Fuses apply to the whole process, so a raw `file://` page in a browser tab could `fetch` other local files, register service workers and reach child `file://` frames.

**Impact:** Without confinement, an HTML file from a cloned repository could read files such as SSH keys and send them out.

**Mitigation:** No browser tab loads a local file until the confinement of 025-FR-005 rule 1 holds; ADR 0012 chooses the mechanism (a browser-session protocol handler for `file:`, a dedicated local scheme, or turning the fuse off after the app window moves to a custom protocol).

**Traces to:** 025-FR-005, 025-NFR-001

---

## Assumptions

| ID | Assumption | Risk if invalid |
|----|-----------|-----------------|
| 025-CA-006 | Agents attach files referenced as `@path` (true for Claude Code); other agents read a plain path | An agent that skips the screenshot loses precision |
| 025-CA-007 | The Qodeca team's apps that need sign-in mostly offer non-Google sign-in or basic auth | The browser is unusable for those apps |
| 025-CA-008 | The agent's own permission prompts are the main gate against prompt injection from page content; Erfana narrows what injected content can reach (the screenshot is marked untrusted, source paths are confirmed inside the project, the template forbids running commands from page content, the shell guard refuses a bare shell – 025-FR-032, 025-FR-037, 025-FR-061) | An agent run without permission checks can be steered by a hostile page |

---

## Accepted risks

Owner decisions taken knowingly in the 2026-10-31 interview:

| Risk | Decision | Where |
|------|----------|-------|
| Prompt injection from page content, with prompts submitted at once | Accepted; page content is labelled untrusted and the risk is documented | 025-FR-032, 025-FR-036, 025-FR-044 |
| Client data, form values (including passwords and card numbers typed on the page) and tokens in URLs sent as-is to the agent's AI provider | Accepted by the owner (reconfirmed 2026-11-01); documented | 025-FR-036, 025-FR-044 |
| The project folder holds the whole profile, including saved credentials, permissions and certificate exceptions, so the agent, project scripts, cloud sync, archives and Docker build contexts can read or change it | Accepted by the owner (2026-11-01); documented | 025-FR-015, 025-FR-044 |
| Only cookies are encrypted at rest; local storage, IndexedDB and the cache are plain text | Accepted; documented | 025-FR-017, 025-FR-044 |
| Prompts are submitted at once, with no preview and no insert-only variant; the shell guard does not detect a busy agent or an agent showing a permission question | Accepted by the owner (2026-11-01); documented | 025-FR-032, 025-FR-061, 025-FR-044 |
| `git clean -fdx` deletes the project's profile and captures | Accepted; documented | 025-FR-016, 025-FR-044 |
| Memory use grows with open tabs | Accepted; no unloading | 025-FR-007 |
| No feature flag or off-switch; a security issue is handled by a release within 14 days | Accepted (reconfirmed 2026-11-01) | 025-FR-040, 025-NFR-002 |
| Full URLs in log files | Accepted (reconfirmed 2026-11-01); recorded exception to `redactUserInput` | 025-FR-042 |
| The builder grades the precision test (an independent grader was offered and declined) | Accepted | 025-NFR-003 |

---

## Data inventory

| Data | Classification | Location | At-rest protection | Retention | Deletion path |
|---|---|---|---|---|---|
| Context file, screenshot, crop | Client data, may hold personal data and secrets | `.erfana/browser/captures/` | None (plain files) | 7 days (025-FR-039) | Expiry, **Clear browsing data › Captures**, Forget |
| In-memory capture | Same | Main-process memory | – | Until send or discard | Discarded on close, crash or navigation |
| Cookies | Credentials | Profile | OS key store (025-FR-017) | Site-set expiry | Clear, Forget |
| Local storage, session storage, IndexedDB, cache | Client data, may hold tokens | Profile | None | Until cleared | Clear, Forget |
| Saved sign-in credentials | Credentials | Profile | OS key store; not stored on Linux `basic_text` | Until cleared | Clear |
| Site permissions, certificate and pop-up exceptions | Trust decisions | Profile | None | Certificate exceptions 7 days; others until cleared | Clear |
| Address history | Browsing data | Profile | None | Last 100 entries | Clear (cookies and site data) |
| Local addresses seen in terminal output | Browsing data | Main-process memory only | – | Until Erfana quits | Not stored on disk |
| Log entries | Operational, full URLs | Erfana logs folder | None | Erfana's log rotation | Delete logs |
| Prompt and capture at the provider | Client data | The AI provider | The provider's | The provider's terms | The provider's tools |
| Agent transcripts | Client data | The agent's own folder (for Claude Code, `~/.claude/projects/`) | None | The agent's setting | The agent's tools |
| Crash dumps | – | Not collected: Erfana uploads no crash reports. A future crash-report feature must scrub browser memory and ask for consent. | – | – | – |

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
| DuckDuckGo | – | Address-bar search fallback; receives the search text |
| The agent's AI provider (through the agent) | – | Receives the prompt, the context file and the screenshot; chosen by the user |
| Sites visited | – | Receive the browser's requests and cookies |

---

## Open to-dos before UI code

- Review address-bar and tab-title spoofing for security; the 2026-11-01 expert panel did not cover it.

## Design additions taken into the spec

The design note's Additions table (`docs/designs/browser/README.md` § Additions beyond the spec) first filed three rows as routine calls. The 2026-11-01 alignment pass (v0.11.0, `.local/panel/align-025/merged.md`, not committed) found that each changes what a Must requirement does, so each is now a spec change:

| Design row | What it adds | Where in the spec |
|---|---|---|
| A-6 | **← Actions** returns from the instruction dialog to the menu on the held capture | 025-FR-031, 025-FR-050, 025-AC-064 |
| A-9 | The pick notes ("Move the mouse over the page to pick an element", "Top of the page", "Back at the element you started from") and the blocked pick on an empty tab and on Erfana's own pages ("Load a page to pick an element") | 025-FR-025, 025-FR-026, 025-FR-027, 025-AC-025 |
| A-27 | An input guard of about 500 ms, with a blocked look and a fresh-press rule, on **Proceed anyway** | 025-FR-021, 025-AC-021 |

## Required decisions before implementation

These decide whether requirements can be met, so each needs an accepted ADR before the code it governs merges. The owner chose to build without a spike first (2026-11-01).

| ADR | Decision | Governs |
|---|---|---|
| 0007 | Pick overlay: engine-drawn (DevTools-protocol `Overlay` and `DOM` with auto-attach to every frame target) or an isolated preload in every frame; the frame kinds each supports | 025-FR-026, 025-FR-029, 025-NFR-001 |
| 0008 | Freeze mechanism and what it stops (`Debugger.pause`, script-execution disabling with a virtual-time pause, or the lifecycle `frozen` state); capture-then-freeze ordering | 025-FR-028, 025-FR-053 |
| 0009 | The profile and every trust decision live in the project folder (owner decision, 2026-11-01) and the guards that protect it | 025-FR-015, 025-FR-016 |
| 0010 | Turning on `EnableCookieEncryption` (supersedes `scripts/fuses.js` lines 705–709) | 025-FR-017, 025-NFR-010 |
| 0011 | Erfana surfaces over the page view (still image, Erfana-owned layer, top strip) and main-process key routing | 025-FR-054, 025-FR-030, 025-FR-031 |
| 0012 | Local-file confinement mechanism | 025-FR-005 |

Whether the context-file prompt templates share the existing apply-to-document footer or need a web variant is left to the solution design.

## Follow-up candidates

- Several elements in one prompt (owner: not in v1, 2026-11-01).
- Pick the last element again after a reload (owner: not in v1, 2026-11-01).

---

## References

- Grill-me interview, 2026-10-31 (this session) – source of every owner decision
- Expert-panel review of pull request #446, 2026-11-01 – five reviewers; source of v0.9.0 and of the owner decisions dated 2026-11-01 (local file `.local/panel/spec-t4-025-built-in-browser-improved.md`, not committed)
- [VS Code – Integrated browser](https://code.visualstudio.com/docs/debugtest/integrated-browser)
- [VS Code – Manage context for AI](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- [Cursor forum – cannot select iframe elements](https://forum.cursor.com/t/browser-cannot-select-iframe-elements/141722)
- [Cursor forum – insert selection at cursor](https://forum.cursor.com/t/insert-browser-tab-element-selection-at-cursor-in-composer-not-always-at-end/167268)
- [Dandelion wiki – Google sign-in in Electron browsers](https://github.com/ChristianRelf/DandelionDEPRICATED/wiki/Troubleshooting)
- [firebase-js-sdk #2478 – user-agent workaround](https://github.com/firebase/firebase-js-sdk/issues/2478)
- [React issue #29092 – `_debugSource` removal](https://www.GitHub.com/facebook/react/issues/29092)
- `docs/adrs/0005-sub-frame-preload-one-receive-channel.md`
- `specs/spec-t3-024-unified-comments/`
