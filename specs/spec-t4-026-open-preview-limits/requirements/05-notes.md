# Notes

## Constraints

| ID | Constraint | Impact | Mitigation |
|----|-----------|--------|------------|
| 026-CA-001 | One release for everything | The preview change waits for the tree and watcher work | Accepted by the owner (D27, D28: no deadline) |
| 026-CA-002 | No setting, no kill switch | A regression can only be undone by a patch release | Hostile suite and independent review before release (026-NFR-001) |
| 026-CA-003 | WebRTC blocking depends on Chromium | 026-FR-006 may not be achievable | Spike first; ship without it if it fails (D10) |
| 026-CA-004 | Name-based deny lists are bypassed often | A missed form leaks a secret | Normalise before matching (026-FR-004); test every known form |

### 026-CA-001: One release for everything

**Type:** Business

**Description:** The owner chose to ship every part of this spec – preview rules, outside files, frames, the live-preview limit, SVG, the removed setting, and the tree and watcher half of #254 – in one release (D27), with no date (D28).

**Impact:** The fix for the main pain (agent output) waits for the largest part, the tree and watcher.

**Mitigation:** None needed; the release waits for the security review and the cross-platform tests.

**Traces to:** all FRs

---

### 026-CA-002: No setting, no kill switch

**Type:** Business

**Description:** The HTML preview setting is removed (D19), and no hidden switch replaces it. #254 already ruled out a setting for the wider preview.

**Impact:** If a Chromium flaw or a block-list bypass appears after release, users cannot turn previews off; a patch release is the only fix.

**Mitigation:** 026-NFR-001 before release; Electron security releases followed as today.

**Traces to:** 026-FR-022, 026-NFR-001

---

### 026-CA-003: WebRTC blocking depends on Chromium

**Type:** Technical

**Description:** Electron's `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')`, used today, limits which addresses WebRTC exposes but does not stop a page from reaching a TURN server over TCP 443 (accepted risk 3 in `docs/security.md`). Chromium's `Connection-Allowlist` response header (with `webrtc=block`, or by default when present) blocks peer connections in the renderer and the network service, and is generally available from Chrome 152; Electron 44.9.3 bundles Chromium 152.0.7977.167. The policy applies per document and worker, so every response – protocol responses, approved web frames, workers – must carry it. Part of this evidence is secondary (search summaries), so it is not yet confirmed.

**Impact:** 026-FR-006 is a Should until a spike confirms it.

**Mitigation:** A spike tests the header on the custom protocol, in frames (including approved web frames, whose responses Erfana does not author) and in workers, on all three platforms. If it fails, D10 applies.

**Traces to:** 026-FR-006, 026-AC-008

---

### 026-CA-004: Name-based deny lists are bypassed often

**Type:** Technical

**Description:** Vite's `server.fs.deny`, the closest prior art, was bypassed by letter case (CVE-2024-23331), `/.` segments (CVE-2025-46565), `#` in the request target (CVE-2025-32395), a trailing backslash (CVE-2025-62522), symlinks (CVE-2025-58751), and NTFS streams plus 8.3 short names (CVE-2026-53571). VS Code and JetBrains do not use name deny lists in previews; they allow only chosen roots.

**Impact:** 026-FR-003 is only as strong as its normalisation.

**Mitigation:** 026-FR-004 lists every known form; 026-AC-006 and 026-AC-033 test each on every platform; an independent reviewer checks the matcher.

**Traces to:** 026-FR-003, 026-FR-004, 026-NFR-001

---

## Assumptions

| ID | Assumption | Risk if invalid |
|----|-----------|-----------------|
| 026-CA-005 | Main users run agents on their own or trusted code (D29) | A stranger's repository can read all non-secret project files and send them to an approved host; documented, not prevented |
| 026-CA-006 | Hard links to secret files are rare: git cannot store them, so only a local program can create one (D42) | A hard link with a harmless name exposes a secret; documented as an accepted risk |
| 026-CA-007 | A reported 15 GiB of physical memory (machines sold as 16 GB) is a fair line between 10 and 5 live previews (D35) | Memory pressure on 16 GB machines with many previews; the number can change in a patch |
| 026-CA-008 | Agent scratchpads sit below a temp root, not directly in it | If an agent writes directly to `/tmp`, its report's own subfolders do not load (026-FR-009) |
| 026-CA-009 | Users choose **Preview** for a page in a secrets folder rarely enough that a message on every open is acceptable (D40, D43) | Repeated messages for a user who keeps reports in `.git/`; the choice could be remembered in a later change |

---

## Owner decisions

From the grill-me interview on 2026-11-03 and the spec interview that followed. R-numbers name the rules reviewed; D-numbers name the decisions.

| ID | Decision | Requirement |
|----|----------|-------------|
| D1–D3 | Outside HTML previews after a per-folder confirm; it covers the folder and its subfolders, in memory until quit | 026-FR-008, 026-FR-009, 026-FR-010 |
| D4 | Outside pages have their own in-memory web allowlist | 026-FR-011 |
| D5 | Entry points for outside files: terminal links, links in a page, links in Markdown | 026-FR-007, 026-FR-012, 026-FR-013 |
| D6, D7 | Outside Markdown and images open with no prompt; outside files are editable | 026-FR-014, 026-FR-015 |
| D8 (revised) | Every project HTML previews (#254), but a secret block list stays unreadable | 026-FR-001, 026-FR-002, 026-FR-003 |
| D9, D10 | Try to block WebRTC; if it cannot be done, ship and document | 026-FR-006 |
| D11 | Remote subresource allowlist unchanged (R5) | – |
| D12, D13 | Web frames through the allowlist; an approved frame loads all its resources | 026-FR-017, 026-FR-018 |
| D14–D17 | Frame limits, IPv6, link prompts and downloads, symlinked files, page storage and size limits unchanged (R6, R8–R11, R13) | – |
| D18, D35 | 10 live previews, 5 under 15 GiB reported memory (machines sold as 16 GB get 10) | 026-FR-021 |
| D19, D20 | On/off setting removed, no notice | 026-FR-022 |
| D21–D23, D26 | Build steps, Markdown cleaning, Markdown images and file viewers unchanged (R14–R16, R18) | – |
| D24, D25 | SVG opens live first; Open as image keeps the viewer | 026-FR-023, 026-FR-024 |
| D27, D28 | One release, no deadline | 026-CA-001 |
| D29 | Main users: developers on their own or trusted code | 026-CA-005 |
| D30 | Block list applies in approved folders too | 026-FR-003 |
| D31 | Six-report test set on three platforms | 026-NFR-003 |
| D32 | Default tie-breaker: ease wins, except secrets and leaving an approved folder | – |
| D33 | Bypass tests plus an independent security reviewer | 026-NFR-001 |
| D34 | Repository-approved hosts work as frames at once | 026-FR-020 |
| D36 | Wide folders: approval covers that level only | 026-FR-009 |
| D37 | Only one-way door: data a page already sent out | – |
| D38 | No project-trust step | Out of scope |
| D39 | Risk warning in docs, not README | 026-FR-029 |
| D40 | HTML in a block-listed folder asks Preview or Source | 026-FR-005 |
| D41 | Block list extended with Vite's defaults | 026-FR-003 |
| D42 | Hard links not checked | 026-CA-006 |
| D43 | After **Preview** for a page in a secrets folder, the block list still applies to what it loads | 026-FR-005 |
| D44 | A link from a page or Markdown preview to HTML in a secrets folder shows the same Preview-or-Source message | 026-FR-003, 026-FR-005, 026-FR-012 |
| D45 | Outside HTML in a secrets folder: the secrets message first, then the folder confirm | 026-FR-005 |
| – | Project open at most 10% slower | 026-NFR-002 |
| – | Tier T4 | – |

Routine calls made during writing, not owner decisions: the list of wide folders, the native message box for the folder confirm (the same kind as the external-link prompt), the failure-badge labels, and the 5-run median method in 026-NFR-002.

---

## Relationship to other work

- **#254** – this spec replaces its preview rules where they differ (`.env` and `.git` stay unreadable; outside folders open behind a confirm) and carries its tree and watcher half unchanged. #254 should be updated to point here.
- **#86, #81** – revoking approved hosts in the app and scoping approvals by resource kind stay in the backlog (D11). With 026-FR-017, an approved origin can also be a frame, which widens what #81 would scope.
- **Spec 025 (built-in browser)** – uses the same folder rule for local `file://` pages. If it ships first, its **Open in browser tab** offers a second way to see outside HTML; 026-FR-008 stays the in-preview path.

## Dependencies

### Internal dependencies

| Dependency | Type | Status |
|------------|------|--------|
| HTML preview protocol handler, CSP builder and request filter (`src/main/services/preview/`) | Required | Available |
| Preview eligibility check (`preview:checkEligibility`) | Required | Available; changes |
| Terminal file links (`useTerminalFileLinks`) | Required | Available; changes |
| Markdown image reader (`markdown-image:read`) | Required | Available; changes for outside Markdown |
| Project tree and file watcher | Required | Available; changes |

### External dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Electron | 44.9.3 (Chromium 152.0.7977.167) | Preview sandbox; `Connection-Allowlist` for WebRTC |

---

## References

- Electron `setWebRTCIPHandlingPolicy`: https://www.electronjs.org/docs/latest/api/web-contents
- Chrome Connection-Allowlist announcement (2026-09-23): https://developer.chrome.com/blog/connection-allowlist-announcement
- WPT tests for Connection-Allowlist: https://github.com/web-platform-tests/wpt/pull/59539
- Vite `server.fs.deny` defaults: https://vite.dev/config/server-options
- Vite advisory GHSA-fx2h-pf6j-xcff (NTFS streams, 8.3 names): https://github.com/advisories/GHSA-fx2h-pf6j-xcff
- CVE-2025-62522 (trailing backslash): https://osv.dev/CVE-2025-62522
- VS Code webview `localResourceRoots`: https://code.visualstudio.com/api/extension-guides/webview
- VS Code Live Preview: https://github.com/microsoft/vscode-livepreview
- Erfana: [docs/security.md § HTML preview](../../../docs/security.md#html-preview), [docs/html-preview/README.md](../../../docs/html-preview/README.md), issue #254

Research checked on 2026-11-03; some CVE details came from secondary sources and are marked as such in the research brief.
