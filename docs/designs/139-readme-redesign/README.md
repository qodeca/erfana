<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# README and GitHub presentation redesign (#139)

> Status: **Implemented** – built by the #139 build PR; see [§ Implementation notes](#implementation-notes).
> Issue: [#139](https://github.com/qodeca/erfana/issues/139) · depends on [#138](https://github.com/qodeca/erfana/issues/138) (user guide, demo fixture, capture script) · campaign `release-0.21.0`.
> Approval: by a reviewer agent on a different model, not by the owner (owner decision, campaign `decisions.md`, 2026-09-25).

## Purpose

A visitor to `github.com/qodeca/erfana` should learn in a few seconds **what Erfana is, what it looks like and how to get it**. Today the page opens with a sentence, four badges and a feature table, has no logo, banner, screenshot or demo, and spends more than half its length on licence, company, signing and build detail.

The redesign is for **new users first** (owner decision). The top of the page sells the app – banner, one-line pitch, Download, demo – and everything a contributor or a lawyer needs moves lower or into linked documents, **with no fact lost** (every current fact is mapped in [§ Fact audit](#fact-audit)).

This document covers, in order: the research it rests on, the fact audit, the page design (structure, banner, demo, badges, relocated sections, repository metadata), the UX design questions, states, open decisions, the requirements this work places on #138, and the implementation plan.

### Binding inputs

- Issue #139 body: owner decisions and acceptance criteria (AC-1 … AC-9 below).
- `.xezar/campaigns/20260925-release-0.21.0/decisions.md`: the owner's interview picks.
- `CLAUDE.md`: never claim built-in AI (Erfana hosts CLI agents); the context meter is Claude Code-specific; REUSE annotations on new files; the design system (`design/`) is the rule of record for anything visual.
- `TRADEMARKS.md`: "Erfana" and the Erfana logo are Qodeca trademarks; third-party names are used nominatively only.
- `BACKWARD_COMPATIBILITY.md`: release verification must keep working – the README must not publish key values that drift from `docs/release-pubkey.txt` (`checks.yml` Guard 5 reads `README.md`).

### Acceptance criteria (from #139, IDs assigned here)

| ID | Criterion | Proven by (plan step) |
|---|---|---|
| AC-1 | First screen of the rendered README (GitHub, desktop width) shows banner, one-line pitch, demo or screenshot, Download button | Step 9 – measured layout check at 1440×900 |
| AC-2 | Banner renders correctly in GitHub light and dark themes (QA screenshots of both) | Step 9 – screenshots in both themes |
| AC-3 | Demo loop 10–20 s, scrubbed, small enough to load fast (size stated in the PR) | Step 5 – duration and size measured; frame contact sheet reviewed |
| AC-4 | Every fact from the current README survives, in the README or a linked doc | Step 8 – the [fact audit](#fact-audit) re-run as a checklist |
| AC-5 | Badges are the useful few, and all resolve | Step 8 – each badge URL fetched |
| AC-6 | All links resolve (link check passes); the user guide is linked | Step 8 – link check over the changed Markdown |
| AC-7 | Wording never claims built-in AI; the context meter is Claude Code-specific | Step 8 – wording check |
| AC-8 | New images carry REUSE annotations, `License compliance` stays green | Step 7 – `REUSE.toml` block; CI `License compliance` |
| AC-9 | All required checks green | Step 10 – gates and CI |

## Research

Sources were read on **2026-09-25** unless a row says otherwise (four rows relay the #138 second-opinion research, read 2026-09-24). The raw README copies used for the survey are kept in the task's working directory, not committed. Claims marked *unverified* were not confirmed against a GitHub source and are checked again during implementation (plan step 1 and step 9).

### How the best desktop and developer-tool READMEs open

| Project (raw README read 2026-09-25) | First screen | Badges | What it teaches Erfana |
|---|---|---|---|
| Zed – https://raw.githubusercontent.com/zed-industries/zed/HEAD/README.md | `# Zed`, 2 badges, one-sentence pitch, plain download link; no image | 2 | A short page (~300 words) that pushes depth to docs; licence and company at the bottom |
| Warp – https://raw.githubusercontent.com/warpdotdev/Warp/HEAD/README.md | Full-width product image (`<img width="1024">`), a centred `·`-separated link row | 0 | A link row beats a badge row for navigation; a sponsor callout above the pitch is noise |
| Tauri – https://raw.githubusercontent.com/tauri-apps/tauri/HEAD/README.md | Splash image, then 8 badges | 8 | Anti-pattern: a badge wall directly under the hero |
| Zen Browser – https://raw.githubusercontent.com/zen-browser/desktop/HEAD/README.md | Logo, 3 badges, one-line pitch, "Download • Website • Docs • Release notes" | 3 | Download as the first link of the row |
| MarkText – https://raw.githubusercontent.com/marktext/marktext/HEAD/README.md | Centred logo and tagline, `<sub>` platform line, sponsor table before the screenshot | 5 | `<sub>` under the pitch for platforms works; sponsors above the product do not |
| Logseq – https://raw.githubusercontent.com/logseq/logseq/HEAD/README.md | Centred logo, tagline, **one large shields `for-the-badge` "Download" button**, 8 more badges | 9 | The shields `for-the-badge` style is a proven Download button; 8 extra badges dilute it |
| AppFlowy – https://raw.githubusercontent.com/AppFlowy-IO/AppFlowy/HEAD/README.md | Centred title and pitch, then 8 stacked screenshots | 4 | Anti-pattern: a screenshot stack pushes install several screens down |
| Hoppscotch – https://raw.githubusercontent.com/hoppscotch/hoppscotch/HEAD/README.md | Logo, pitch, 4 badges, **light/dark banner via `<picture>`** | 4 | `<picture>` + `prefers-color-scheme` for the hero |
| Tabby – https://raw.githubusercontent.com/Eugeny/tabby/HEAD/README.md | Banner, 4 `for-the-badge` badges, an ad, ~3,100 words | 4 | Anti-pattern: a very long README with promotion above the pitch |
| Wave Terminal – https://raw.githubusercontent.com/wavetermdev/waveterm/HEAD/README.md | **Light/dark logo via `<picture>`**, pitch, one WebP screenshot | 1 | A terminal-first desktop app with one product visual and one badge |
| Lapce – https://raw.githubusercontent.com/lapce/lapce/HEAD/README.md | Logo inside a centred `<h1>`, `<h4>` tagline, 3 badges, one screenshot | 3 | An image inside `<h1>` keeps a real heading whose name is the alt text |
| Aider – https://raw.githubusercontent.com/Aider-AI/aider/HEAD/README.md | Centred logo, pitch as `<h1>`, **animated screencast** above the fold | 5 | Motion near the top for a tool whose value is a loop |
| opencode – https://raw.githubusercontent.com/sst/opencode/HEAD/README.md | **Light/dark logo via `<picture>`**, "The open source AI coding agent.", 3 badges, screenshot | 3 | A category-framed pitch of under 12 words |
| Glow – https://raw.githubusercontent.com/charmbracelet/glow/HEAD/README.md | Pitch, an animated GIF banner, a demo image at `width="800"` | 4 | Warns by example: a GIF banner is heavy; keep motion to one asset |
| Cline – https://raw.githubusercontent.com/cline/cline/HEAD/README.md | Centred icon, pitch, a table of surfaces with install links | 0 | Download/install per platform can be one short block |
| Excalidraw – https://raw.githubusercontent.com/excalidraw/excalidraw/HEAD/README.md | **Light/dark cover via `<picture>`**, link row, two-line pitch, 6 badges | 6 | Cover art in both themes |
| Obsidian releases – https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/README.md | No branding; a release-hosting repo | 0 | Not useful as a model (recorded so the omission is visible) |
| awesome-readme – https://github.com/matiassingers/awesome-readme (raw: https://raw.githubusercontent.com/matiassingers/awesome-readme/master/readme.md) | 99 examples; the intro names "images, screenshots, GIFs, text formatting" | – | Most praised: badges (59 mentions), logo (55), clear description (43), demo (40), install (36); recommends Gifski and charmbracelet/vhs for small, scripted demos |

**Patterns that recur in the best ones**

1. A centred hero block: logo or banner → name → one-line pitch → link row → one visual.
2. A pitch of twelve words or fewer, framed as a category ("The open source AI coding agent.", "Lightning-fast And Powerful Code Editor").
3. Light and dark artwork through `<picture>` and `prefers-color-scheme` (Hoppscotch, Wave, opencode, Excalidraw).
4. **One** product visual above the fold; motion only where the value is a loop (Aider, Glow).
5. A text link row (`·`-separated) for navigation instead of badges.
6. Download as a plain link or a single large button (Logseq's shields `for-the-badge` button); nobody examined uses a custom image button.
7. Zero to five badges; the most admired pages use two or three.
8. Install within the first two sections.
9. Features as a short list, each item linking deeper.
10. Licence, company and sponsorship at the bottom, short, linking out.
11. The README is a front door, about 300–700 words, not a manual.

**Anti-patterns to avoid**: badge walls (Tauri, Logseq), screenshot stacks (AppFlowy), promotion or sponsors before the product (MarkText, Tabby, Warp), maintainer or legal detail in the README (Zed's licensing section, Tauri's FOSSA widget), oversized GIFs (Glow), very long pages (Tabby, ~3,100 words).

### What GitHub renders, and the limits that bind the design

GitHub's production HTML sanitizer is not public; the closest public version is html-pipeline's filter, used here as an approximation.

| Topic | Fact | Source (read 2026-09-25) |
|---|---|---|
| Allowed HTML | `picture`, `source`, `img`, `p`/`div`/`h1`–`h6` with `align`, `a`, `details`/`summary`, `kbd`, `sub`/`sup`, tables, `figure`; attributes `align`, `width`, `height`, `media`, `alt`, `title`; `img src`, `img loading`, `source srcset`. **Not allowed**: `video`, `iframe`, `script`, `style`, `class`, `style=` | https://github.com/gjtorikian/html-pipeline/blob/main/lib/html_pipeline/sanitization_filter.rb ; https://github.com/github/markup/blob/master/README.md |
| `<picture>` | "The `<picture>` HTML element is supported." | https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax |
| Theme-specific images | `<picture>` with `<source media="(prefers-color-scheme: dark)">`, a light `<source>`, and a fallback `<img>` shown when the browser does not support `prefers-color-scheme` | https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/quickstart-for-writing-on-github ; https://github.blog/changelog/2022-05-19-specify-theme-context-for-images-in-markdown-beta/ |
| `#gh-dark-mode-only` fragments | Older method (2021); no longer in the current docs – treat as undocumented legacy, do not use | https://github.blog/changelog/2021-11-24-specify-theme-context-for-images-in-markdown/ |
| Relative image paths | Rewritten for the branch being viewed; recommended for images in your own repository | basic-writing-and-formatting-syntax (above) |
| README size | Content beyond 500 KiB is truncated | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes |
| File size | Git warns above 50 MiB, GitHub blocks above 100 MiB | https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github |
| Image proxy | External images go through Camo; open-source Camo's default cap is 5 MiB and its type list includes gif, png, jpeg, webp, svg but not apng or avif (*unverified* that production uses the same limits) | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls ; https://github.com/atmos/camo |
| Video | GitHub does not support externally hosted video; `<video>` is not allowed; a video plays only as an uploaded `user-attachments` URL, which cannot be regenerated by a committed script | https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files ; https://github.com/orgs/community/discussions/19403 |
| Animated WebP | Not in GitHub's documented supported-media list (PNG, GIF, JPEG, SVG; video `.mp4`/`.mov`/`.webm`); plays wherever the viewer's browser supports it (*unverified* on github.com – plan step 1 proves it). Google's WebP FAQ lists animation support for Chrome 32+, Edge 18+, Firefox 65+, Opera 19+ and does not list Safari for animation (read 2026-09-24 by the #138 research) | attaching-files (above) ; https://developers.google.com/speed/webp/faq |
| Against animated GIF | Google's developer style guide: "don't use animated GIF… use a more resource-efficient format (such as MP4)"; GitHub's docs style guide: "Do not use animated GIFs in the docs" (a rule for docs.github.com, not READMEs); web.dev: GIF is limited to 256 colours and much larger than `<video>`; gif.ski itself suggests a modern video codec where possible. Read 2026-09-24 by the #138 second-opinion research (task `9cabe946`), relayed by the leader as advisory input | https://developers.google.com/style/images ; https://raw.githubusercontent.com/github/docs/main/content/contributing/style-guide-and-content-model/style-guide.md ; https://web.dev/articles/choose-the-right-image-format ; https://gif.ski/ |
| SVG in `<img>` | No scripts, no external resources (so no web fonts) – text must be outlined or the asset rasterised (*unverified*, standard browser behaviour); a `prefers-color-scheme` query inside the SVG follows the OS, not GitHub's theme setting (*unverified*) | – |
| Social preview | PNG, JPG or GIF under 1 MB, at least 640×320, **1280×640 for best display**; solid background recommended; set only in Settings → Social preview (GraphQL `openGraphImageUrl` is read-only) | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview ; https://docs.github.com/en/graphql/reference/objects#repository |
| Topics | Lowercase letters, numbers, hyphens; ≤ 50 characters; ≤ 20 topics | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics |
| Description | No documented maximum in the REST description (the often-quoted 350 characters is *unverified*) | https://github.com/github/rest-api-description |
| README column width | About 830–900 px on the repository home page, up to about 1012 px on the file view; images scale down (*unverified* – measured in plan step 9) | – |
| Alerts | `> [!NOTE]` etc. supported; not nestable; one or two per page | basic-writing-and-formatting-syntax § Alerts ; https://github.blog/changelog/2023-12-14-new-markdown-extension-alerts-provide-distinctive-styling-for-significant-content/ |
| Link checkers | lychee (Rust, `.lycheeignore`) – https://github.com/lycheeverse/lychee ; markdown-link-check (Node) – https://github.com/tcort/markdown-link-check | as listed |

### Local facts verified for this design

- The app icon is `resources/icon.png`, 512×512 RGBA: a lime rounded square with a black "E" (read with `file` and viewed).
- Brand tokens in `src/renderer/src/styles/design-tokens.css`: `--color-brand-lime` `#E3E829`, `--color-brand-violet` `#A0A8FF`, `--color-brand-black` `#161312`, `--color-brand-white` `#F8FAF8`, `--color-brand-indigo` `#3F3FBA`, the gray scale, `--font-mono` (Cascadia Mono first), `--border-radius: 0`.
- The bundled Cascadia Mono Regular and Bold (SIL OFL) are in `design/fonts/`.
- The app is dark-only (`docs/ui-style-guide.md`: "Do not add `prefers-color-scheme` queries"). That rule is about the app; the README banner is a GitHub page asset and needs both themes (see [Open decisions](#open-decisions), item 4, for how the deviation is recorded).
- The latest release, `v0.20.0`, ships `erfana-0.20.0-arm64.dmg`, `erfana-0.20.0-setup.exe`, `SHA256SUMS` and `SHA256SUMS.minisig` (`gh release view`). `electron-builder.yml` builds macOS for **arm64 only** ("Apple Silicon only"). The Windows target sets no arch (x64 inferred, not verified).
- The already-installed `ffmpeg-static` binary has the `libwebp_anim` and `gif` encoders and the `palettegen`/`paletteuse` filters (checked locally), so encoding the demo needs **no new dependency**. Playwright's Chromium is installed for `@playwright/test`.
- `SECURITY.md` line 62 links `README.md#release-verification`. Nothing else in the repository links a README anchor.
- `checks.yml` Guard 5 compares any `RW…` key line in `README.md` with `docs/release-pubkey.txt`; the README currently publishes no key and must keep it that way.
- Current repository metadata (`gh repo view`): description "An agent-native, open-source Markdown workspace – run Claude Code and other terminal coding agents right beside your editor. macOS & Windows."; homepage `https://qodeca.com`; 18 topics (`electron`, `ide`, `markdown-editor`, `monaco-editor`, `react`, `terminal`, `typescript`, `ai`, `ai-agents`, `claude-code`, `coding-agent`, `desktop-app`, `macos`, `markdown`, `mermaid`, `windows`, `xterm`, `qodeca`); no custom social preview.

## Fact audit

Every fact in the current `README.md` (106 lines, read at `e21cadf3`), with where it ends up. **README** means it stays on the page (possibly shortened); a path means the full text lives there and the README links it. "Present" means the destination already holds it today; "add" means implementation writes it there. `docs/about.md` is new (plan step 6).

| ID | Line | Fact | Ends up in |
|---|---|---|---|
| F-01 | 1 | Name "Erfana" | README – `<h1>` whose content is the banner, alt text "Erfana" |
| F-02 | 3 | Open-source, agent-native Markdown workspace | README – pitch (both words kept, see [Pitch](#pitch)); repository description (proposed value keeps "agent-native") |
| F-03 | 3 | Run a terminal coding agent like Claude Code right beside the editor | README – pitch sub-line |
| F-04 | 5 | CI status badge (`checks.yml`, branch `main`) | README – badge row |
| F-05 | 6 | Latest release badge | README – badge row |
| F-06 | 7 | Licence badge GPL-3.0-only | README – badge row |
| F-07 | 8 | Platforms badge: macOS · Windows | README – platform line under Download (the badge is dropped; the fact stays as text) |
| F-08 | 10 | One window holds editor, live preview, project tree and a terminal running your agent; one feedback loop | README – pitch sub-line and "How it works" |
| F-09 | 12 | Agent runs as a clean top-level `claude` session, or any CLI agent, in the integrated terminal, in the project's context | README – "How it works"; detail present in `docs/features/README.md` item 14 |
| F-10 | 13 | For a Claude Code session, a per-panel meter shows the model, its 200k/1M window and how full it is, live | README – "How it works" (worded as Claude Code-only); present in `docs/features/README.md` item 14 |
| F-11 | 14 | Right-click a selection for prompt templates (Explain, Modify, Ask, Visualize); the prompt goes straight to the agent | README – "How it works"; present in `docs/features/README.md` item 4 |
| F-12 | 15 | Mutation prompts apply the agent's changes back into the document | README – "How it works"; present in `docs/features/README.md` item 4 |
| F-13 | 17 | Free software under GPL-3.0-only | README – License section |
| F-14 | 21 | Terminal: Claude Code or any CLI agent, xterm.js + PTY | README – features list |
| F-15 | 21 | Terminal: WebGL rendering | `docs/terminal/README.md` (present); README list keeps "xterm.js" only |
| F-16 | 21 | Terminal: file links, drag-drop paths | README – features list; present in `docs/features/README.md` item 3 |
| F-17 | 21 | Terminal: cross-platform screenshot and camera capture | README – features list; present in `docs/features/README.md` item 3 |
| F-18 | 22 | Editor: Monaco, live preview with scroll sync | README – features list; present in item 1 |
| F-19 | 22 | Mermaid diagrams, 22 types, zoom/pan/full-screen | README – features list ("Mermaid diagrams"); count and viewer present in items 1 and 4 |
| F-20 | 22 | YAML frontmatter, unified in-file search | `docs/features/README.md` item 1 (present); user guide (#138) |
| F-21 | 23 | Project tree: real-time git status, worker-thread offloaded | README – features list ("live git status"); offloading present in item 2 |
| F-22 | 23 | Drag-drop reorganisation, Markdown filtering, Reveal in Finder/Explorer | `docs/features/README.md` item 2 (present); user guide (#138) |
| F-23 | 24 | Import via LiteParse, 50+ formats, local OCR | README – features list; present in item 8 |
| F-24 | 24 | Office/image import needs LibreOffice/ImageMagick | `docs/features/README.md` item 8 (present); user guide (#138) |
| F-25 | 24 | Print-optimised PDF and Word (DOCX) export with Mermaid diagrams | README – features list; present in items 6 and 7 |
| F-26 | 25 | HTML preview: `.html` runs as a live page in its own tab | README – features list; present in item 15 |
| F-27 | 25 | Same-project frames; links in a new tab or in place with Back/Forward; find; PDF export; open in default browser | `docs/features/README.md` item 15 (present) |
| F-28 | 25 | Per-host permission band asks before any remote request | README – features list (it is a trust promise, so it stays visible); present in item 15 |
| F-29 | 26 | Image viewer: zoom, pan, full-screen; repaints when the file changes on disk | README – features list; present in item 12 |
| F-30 | 26 | Image viewer: PNG / PDF / clipboard export | README – features list; **add** to `docs/features/README.md` item 12 (today only `docs/api-services-features.md` § ImageExportService and `CLAUDE.md` describe it) |
| F-31 | 27 | Media transcription via the OpenAI API or fully offline `whisper.cpp` | README – features list; present in item 13 |
| F-32 | 31 | macOS and Windows | README – platform line under Download, sharpened to "macOS (Apple silicon)" (verified, `electron-builder.yml`) |
| F-33 | 31 | There is no Linux build | README – platform line under Download |
| F-34 | 35 | Download the signed build from Releases | README – Download button and "Get started" |
| F-35 | 36 | Install: macOS opens the `.dmg`; Windows runs the setup `.exe` | README – "Get started" |
| F-36 | 37 | Launch, open a project folder; editor, tree and terminal open in context | README – "Get started" |
| F-37 | 39 | Download link and qodeca.com link | README – Download button; qodeca.com in "Built by Qodeca" |
| F-38 | 41 | Build from source is possible | README – "Contributing and building" line linking `CONTRIBUTING.md` |
| F-39 | 45 | GPL lets you use, study, modify and redistribute | `docs/about.md` (add, verbatim); README License line keeps "free software" |
| F-40 | 45 | "We build a lot of our tooling in the open and wanted Erfana to be useful beyond our own work" | `docs/about.md` (add, verbatim) |
| F-41 | 47 | Contributions under a CLA preserving Qodeca's option of separate commercial terms; does not restrict GPL rights | README – License (one line) ; present in `CONTRIBUTING.md` § Licensing and `CLA.md`; verbatim in `docs/about.md` |
| F-42 | 47 | The code is GPL; the name and branding are not | README – Trademarks (one line); present in `TRADEMARKS.md` |
| F-43 | 51 | Built by Qodeca, a Warsaw-based software team building software since 2014 for fitness, sport and healthcare, where HIPAA, GDPR and PCI DSS are the baseline | README – "Built by Qodeca" keeps one sentence; full text **add** to `docs/about.md` (no other file holds it today) |
| F-44 | 53 | The rigor list: minisign-signed and notarised artifacts, four-layer Whisper trust chain, sandboxed renderers with validated IPC, full CI gate on every push | `docs/about.md` (add, verbatim, each item linking its detail: `docs/security.md` § Release signing, § Local Whisper trust chain, § Context Isolation, `docs/ci.md`) |
| F-45 | 53 | Other open work: `erfana-skills` (Claude Code plugin), `8cli` (AI-first n8n CLI) | `docs/about.md` (add, verbatim with links) |
| F-46 | 55 | qodeca.com · LinkedIn · hi@qodeca.com | README – "Built by Qodeca" line; also in `docs/about.md` |
| F-47 | 59 | Every release on or after `v0.9.5` ships signed artifacts: minisign-signed `SHA256SUMS`, macOS notarisation, Windows Authenticode | README – "Release verification" (kept, same heading – `SECURITY.md` links its anchor); present in `SECURITY.md`, `docs/security.md` § Release signing, `docs/build/release.md` |
| F-48 | 59 | Verify downloads before installing; keys and `minisign` + `sha256sum` recipe in `docs/security.md` and `docs/build/release.md`; keys mirrored in `docs/release-pubkey.txt` | README – "Release verification" (all three links kept, no key values) |
| F-49 | 63 | Questions and help: GitHub Discussions; bugs and features: issue templates; `SUPPORT.md` routes each kind | README – "Support" (kept) |
| F-50 | 67 | Context isolation, no node integration, sandboxed `contextBridge` IPC with input validation on every channel, CSP | README – "Security" keeps one summary line; present in `docs/security.md` (Security Posture Summary lists context isolation, node integration, sandboxing, CSP) – implementation confirms the "validation on every channel" wording exists there and **adds** it if not |
| F-51 | 69 | Report vulnerabilities privately via advisory reporting; `SECURITY.md`; no public issue | README – "Security" (kept) |
| F-52 | 73 | GPL-3.0-only; `LICENSE`, `COPYRIGHT`, `THIRD-PARTY-LICENSES.md` | README – License |
| F-53 | 73 | Per-file licensing follows REUSE (SPDX headers + `REUSE.toml`) | README – License |
| F-54 | 75 | Copyright (c) 2025-2026 Qodeca sp. z o.o. | README – License; present in `COPYRIGHT` |
| F-55 | 79 | "Erfana", "Qodeca" and logos are trademarks of Qodeca sp. z o.o.; forks must be renamed | README – Trademarks; present in `TRADEMARKS.md` |
| F-56 | 79 | Qodeca publishes the official signed builds | README – Trademarks; present in `TRADEMARKS.md` ("only Qodeca distributes the official Erfana builds") |
| F-57 | 81 | "Claude"/"Claude Code" are Anthropic trademarks; not affiliated, sponsored or endorsed; runs the `claude` CLI like any terminal program | README – Trademarks keeps the one-line notice (the demo shows Claude Code, so it stays on the page); full text present in `TRADEMARKS.md` |
| F-58 | 83 | "OpenAI"/"Whisper" are OpenAI trademarks; not affiliated; optionally calls the OpenAI API; downloads and runs `whisper.cpp` on demand | `TRADEMARKS.md` (present, fuller); README Trademarks links "full third-party notice" |
| F-59 | 87 | Contributions welcome; `CONTRIBUTING.md`; Code of Conduct | README – "Contributing and building" |
| F-60 | 87 | Inbound GPL-3.0-only; CLA; opening a PR agrees; Git author identity is the record | README – one line; present in `CONTRIBUTING.md` § Licensing of contributions |
| F-61 | 94 | `npm ci`, not `npm install` | `CONTRIBUTING.md` § Local setup (present) |
| F-62 | 94 | Node.js 24+, pinned in `.nvmrc` | `CONTRIBUTING.md` § Prerequisites (present) |
| F-63 | 95 | Python 3.12 or 3.14.x, not 3.13 (node-pty) | `CONTRIBUTING.md` § Prerequisites (present) |
| F-64 | 96 | `npm run dev` | `CONTRIBUTING.md` § Local setup (present) |
| F-65 | 97–99 | `npm run build`, `npm run build:mac`, `npm run build:win` | `docs/build/README.md` (`build:mac` present; implementation confirms the other two and **adds** a "Package the app" block to `CONTRIBUTING.md` § Local setup if any is missing) |
| F-66 | 102 | Windows: VS 2022 Build Tools, Developer Mode, Win32 long paths; `docs/build/windows.md` | `CONTRIBUTING.md` § Prerequisites (present) |
| F-67 | 104 | Branch off `develop`, not `main`; `main` is released code and lags; PR targets the branch it was cut from; graph-engine work branches off `graph` | `CONTRIBUTING.md` § Local setup (present) |
| F-68 | 106 | Docs index, Architecture, Build, Testing, Changelog links | README – "Contributing and building" link line (kept) |

Nothing is deleted outright. Before the README drops them, these facts need text **added** elsewhere: F-30 (to `docs/features/README.md`); F-39, F-40, F-43, F-44 and F-45 (to the new `docs/about.md`); and F-50 and F-65 only if the step-6 confirmation finds a gap. One fact is new and verified: macOS builds are Apple silicon only.

## Screens

The README is one screen with two regions: the **hero** (everything above "How it works") and the **body**. Target length 500–750 words, down from about 1,130 today (`wc -w`, markup included).

### Page structure

```text
┌──────────────────────────── hero (centred) ────────────────────────────┐
│ <h1> banner (picture: dark / light)                    alt="Erfana"     │
│ Pitch (bold, one line)                                                  │
│ Sub-line: what is in the window, which agents                           │
│ [ DOWNLOAD · macOS · WINDOWS ]  ← shields for-the-badge, links /latest   │
│ <sub>macOS (Apple silicon) · Windows · no Linux build · free, GPL-3.0</sub> │
│ User guide · Changelog · Discussions · Contributing   ← link row        │
│ Demo loop (picture: reduced-motion → still, else animation)             │
│ <sub>caption: real Claude Code session, agent segment sped up</sub>     │
│ badges: Quality Checks · Latest release · License                        │
└─────────────────────────────────────────────────────────────────────────┘
## How it works        – the 4 loop bullets (F-08…F-12)
## Features            – bullet list, bold lead + one line, each links the user guide
## Get started         – 3 steps (F-34…F-36) + "verify your download" link
## Support             – kept (F-49)
## Release verification– 2–3 lines, same heading (anchor kept) (F-47, F-48)
## Security            – 2 lines (F-50, F-51)
## Built by Qodeca     – 2 lines + link to docs/about.md (F-43, F-46)
## License             – 3 lines (F-13, F-41, F-52…F-54)
## Trademarks          – 3 lines + TRADEMARKS.md (F-42, F-55…F-58)
## Contributing and building – 3 lines + links (F-38, F-59, F-60, F-68)
```

**Why this order.** Research patterns 1, 4, 6 and 8: the first screen answers *what* (banner and pitch), *how to get it* (Download) and *what it looks like* (demo). Download sits **above** the demo so it is never pushed below the fold by the demo's height. Badges move out of the hero to a single row directly **under the demo caption** (still near the top, out of the first-screen budget; research anti-pattern "badge walls").

**Headings kept for their anchors**: `Release verification` (linked from `SECURITY.md` line 62), `Security`, `Support`, `License`, `Trademarks`, `Built by Qodeca`. `Platforms`, `Development` and `Why open source, and how it's licensed` go away: their only in-repo link was the platforms badge, which is dropped. `Getting started` becomes `Get started` – no in-repo link targets it; keeping the old spelling is equally fine and is left to the implementer.

### First-screen budget (AC-1)

Measured at a **1440×900 viewport**. On the repository home page GitHub draws the file list above the README, so the literal first screen of `github.com/qodeca/erfana` shows **no** banner; that is GitHub's layout and outside our control, and the PR says so plainly. Two measurements are therefore taken:

- **Pass measurement – the README file view, unscrolled** (`github.com/qodeca/erfana/blob/<branch>/README.md`, the page a "README" link opens). GitHub's own chrome (header, repository tabs, file header) sits above the article; its height is *unverified* here and is read in step 9.
- **Recorded, not pass/fail – the repository home page, scrolled** so the README article's top edge is at the top of the viewport. This is what a visitor sees after one scroll.

Heights inside the article (approximate, before step 9 measures them):

| Block | Displayed height (px, approx.) |
|---|---|
| Banner (`width="800"`, 4:1) | 200 |
| Rule GitHub draws under an `<h1>`, with its padding (*unverified*, seen in step 9) | 10 |
| Pitch + sub-line | 80 |
| Download button + platform line | 70 |
| Link row | 30 |
| Gaps | 60 |
| **Demo top edge at** | **≈ 450 from the article top** |
| Demo (`width="800"`, 16:10) | 500 |

Pass rule, on the unscrolled README file view at 1440×900: banner, pitch and Download button fully inside the viewport, and the demo's top edge at or above **700 px** from the viewport top (at least 200 px of the demo visible). On the scrolled home page the same blocks are recorded with the demo top expected at about 450 px from the article top. The check reads `getBoundingClientRect()` of each element, not a visual guess. If the file view misses the rule, the banner height is the first thing reduced (the adjustable part, see [Risks](#risks)).

### Hero markup (shape, not final copy)

```html
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/readme/banner-light.png">
    <img alt="Erfana" src="docs/assets/readme/banner-light.png" width="800">
  </picture>
</h1>

<p align="center"><strong>The open-source, agent-native Markdown workspace.</strong><br>
Editor, live preview, project tree and a terminal running Claude Code – or any CLI agent – in one window.</p>

<p align="center">
  <a href="https://github.com/qodeca/erfana/releases/latest"><img alt="Download Erfana for macOS or Windows" src="https://img.shields.io/badge/Download-macOS%20%C2%B7%20Windows-E3E829?style=for-the-badge&labelColor=161312"></a><br>
  <sub>macOS (Apple silicon) · Windows · no Linux build · free and open source (GPL-3.0-only)</sub>
</p>

<p align="center"><a href="docs/user-guide/README.md">User guide</a> · <a href="docs/CHANGELOG.md">Changelog</a> · <a href="https://github.com/qodeca/erfana/discussions">Discussions</a> · <a href="CONTRIBUTING.md">Contributing</a></p>

<p align="center">
  <picture>
    <source media="(prefers-reduced-motion: reduce)" srcset="docs/assets/readme/demo-still.png">
    <img alt="…see § Demo loop, alt text…" src="docs/assets/readme/demo.webp" width="800">
  </picture><br>
  <sub>A real Claude Code session in Erfana. The agent's working time is sped up.</sub>
</p>
```

- The Download button is a shields.io `for-the-badge` badge: square corners (matches `--border-radius: 0`), label on `--color-brand-black`, message on `--color-brand-lime` with dark text (13.94:1). It reads in both GitHub themes without a second variant. It links `releases/latest` because asset names carry the version (`erfana-<version>-arm64.dmg`), so there is no stable per-platform asset URL.
- The fallback `<img>` of the banner is the **light** variant (research: a viewer that strips `<picture>` shows the fallback), and it carries the alt text.
- `prefers-reduced-motion` in a `<source media>` gives motion-sensitive readers the still (the `media` attribute is on the allowlist; the behaviour on github.com is checked in plan step 9).

### Pitch

Recommended: **"The open-source, agent-native Markdown workspace."** (five words, category-framed, research pattern 2). It keeps "agent-native", the term `CLAUDE.md` and the current README and repository description use for the project (F-02). The sub-line says what "agent-native" means – what is in the window and "Claude Code – or any CLI agent" – so the pitch never implies Erfana has its own AI.

Alternatives the reviewer may prefer (all pass AC-7 and keep F-02): "An agent-native Markdown workspace for terminal coding agents." / "Agent-native Markdown: your editor and your terminal coding agent, in one window."

Words the README must not use about Erfana itself: "AI-powered", "built-in AI", "AI editor", "AI assistant", "smart", "intelligent", or any phrasing where Erfana, not the hosted agent, does the thinking. The context meter is always introduced as "for a Claude Code session".

### Banner and wordmark

**Source of truth is a design-system card**, not an image editor: `design/product/github-presentation/index.html` (status `proposed`, the same layout as the existing `design/product/html-approval/index.html`), built only from `design/tokens.css` (the synced copy of `design-tokens.css`) and `design/fonts.css`. A script rasterises it (plan step 3). So the banner's colours are the shipping tokens, `npm run lint:css` rejects a hex colour in it, and a token change is one re-run away from a new banner.

Composition, 1600×400 px (4:1), exported at 2× of an 800×200 layout:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  ┌────┐                        ┌──────┬────────────────┬──────────────┐ │
│  │ E  │  Erfana                │ tree │ # Launch plan  │ preview      │ │
│  └────┘                        │ ▪ ▪  │ ▬▬▬▬ ▬▬ ▬▬▬    │ ▬▬▬▬         │ │
│  icon.png  wordmark            │ ▪ ▪  │ ████ selected  │ ┌─┐→┌─┐      │ │
│  (unmodified) Cascadia Mono    ├──────┴────────────────┴──────────────┤ │
│              Bold               │ ❯ ▌                                  │ │
│                                 └──────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

- **Left**: `resources/icon.png`, unmodified (no recolour, crop, outline or effect – `TRADEMARKS.md`), at 88 px layout size, then the wordmark **"Erfana"** in Cascadia Mono Bold at 60 px layout size (`--font-mono`). The name keeps its capital E as written in `TRADEMARKS.md`.
- **Right**: a flat, abstract window – project tree, editor with one line in the selection colour, preview with a two-node flowchart, and a terminal strip with a bare `❯` prompt glyph and a lime block cursor – no command name, so no third-party name or mark appears in the banner or the social preview. It tells the same story as the demo (select → agent → diagram) without a screenshot's detail. Borders 1 px, `border-radius: 0`, no shadow, no gradient.
- **Why Cascadia Mono for every glyph in the image**: it is bundled and OFL-licensed, so the banner renders identically on any machine and ties the brand to the terminal. The system sans (`--font-sans`) would rasterise as SF Pro on the macOS capture machine, whose licence is not ours to redistribute in marketing images.

| Element | Dark variant | Light variant | Contrast (computed) |
|---|---|---|---|
| Background | `--color-brand-black` #161312 | `--color-brand-white` #F8FAF8 | vs GitHub canvas: 1.02:1 (#0d1117) / 1.05:1 (#fff) – the banner edge disappears, so it reads as part of the page |
| Wordmark | `--color-brand-white` | `--color-brand-black` | 17.62:1 both |
| Window frame and pane borders | `--color-border-default` (gray-800) | `--color-gray-200` | decorative |
| Pane text bars | `--color-gray-700` | `--color-gray-300` | decorative |
| Selected line | `--color-brand-violet-muted` | `--color-brand-violet-muted` | decorative |
| Terminal strip | `--color-brand-black` fill in **both** variants (the app's terminal is always dark) | same | – |
| Prompt glyph `❯` | `--color-text-primary` (gray-300) on brand-black | same | 11.51:1 |
| Cursor | `--color-brand-lime` | `--color-brand-lime` (on the dark strip) | 13.94:1 |

Lime is never placed on a light surface: lime on `#F8FAF8` is **1.26:1**. Violet on light is 2.10:1, so violet only appears as a muted fill. Where the light variant needs an accent line, it uses `--color-brand-indigo` (7.61:1 on brand-white).

The ratios in this section were computed by hand for the design. In the card they are **not typed**: each one the card shows is a `contrast` entry in `design/claims.json` written as `<span data-claim="…">` (`design/README.md` § A card is done when), so the design-claims test re-derives them from the tokens on every CI run.

**Solid backgrounds, not transparent**: the fallback `<img>` (light) and any viewer that ignores `<picture>` stay legible, and the edge still vanishes against both GitHub canvases. On GitHub's dimmed dark theme (#22272e) the dark banner shows as a flat rectangle – acceptable and consistent with the flat design; recorded in QA.

**Why a PNG, not an SVG**: an SVG in `<img>` cannot load the web font (research, SVG row), and outlining the text makes the asset uneditable. PNG at 2× keeps text sharp on retina screens. Budget: ≤ 150 KB per variant.

### Social preview

`docs/assets/readme/social-preview.png`, **1280×640** (GitHub's recommended size), rendered from the same card: dark variant, icon and wordmark centred-left, the pitch in Cascadia Mono Regular beneath, the abstract window on the right. Content stays inside a 1200×560 safe area (a 40 px margin, so crops by other sites do not cut the wordmark – common practice, *unverified* for each site). Solid background, no third-party name or mark (no Claude, Anthropic or `claude` text). Budget ≤ 300 KB (GitHub's limit is 1 MB). It is uploaded only through Settings → Social preview, after the README merges and after the owner has seen it (see [Repository metadata](#repository-metadata-applied-after-merge)).

### Demo loop

**Format** (decided – owner's pick "A 10–20 second loop (GIF or WebP)", leader decision 2026-09-25): animated **WebP** if plan step 1 shows it plays on github.com in current Chrome, Safari and Firefox; otherwise **GIF**. WebP is preferred because GIF's 256-colour limit bands the app's UI and costs several times the bytes (research, "Against animated GIF"). Both come from **#138's** capture pipeline: its `encode.mjs` emits animated WebP beside the GIF and MP4 it already produces, and its output allow-list admits `docs/assets/readme/` (R138-9, R138-10). #139 writes no encoder of its own.

**Video, considered and not chosen without the owner.** Style guides favour MP4 over any animated image, and GitHub plays `.mp4`/`.webm`. But in a README a video plays only as a `user-attachments` URL uploaded through the web editor: `<video>` is stripped and a committed `.mp4` does not play. That means the file lives outside the repository, a person must re-upload it after every re-recording (no CLI path was found), it shows as a player rather than a silent loop, and it does not travel with a fork. Its gains are real – a much smaller file, full colour, and a pause control. Because it departs from the owner's "GIF or WebP", it is not used in the hero (see [open decision 5](#open-decisions)). #138's MP4 of the same scenario exists anyway and may be linked from the user guide.

**Size and timing.** Recorded and encoded at **1280×800** – the window's content size, the one size both #138 and #139 use (#138 sets it with `setContentSize(1280, 800)`). 16:10, displayed at `width="800"`, so 1.6× – sharp on most retina screens at a fraction of 2×'s weight. 12 fps, **18 s** loop (AC-3 range 10–20 s). Budget: **target ≤ 3 MiB, hard cap 5 MiB** – a first-load ceiling (about 4 s on a 10 Mbit/s link, see UX item 9). The images are repository-relative, so they are served from the repository, not through the Camo proxy for external images; 5 MiB also happens to be open-source Camo's cap, which is not claimed to apply here. The PR states the measured duration and size.

**Terminal legibility.** Displayed at 800 px the 1280 px window is scaled to 62.5 %. The terminal's font size is fixed at 12 px (`TERMINAL_OPTIONS` in `src/renderer/src/components/Panels/TerminalPanel/terminalPanel.logic.ts`; not a user setting), so terminal text comes out at 7.5 px – too small to read. Two levers, neither of which changes the app:

1. a **capture-only zoom** – the capture script sets the window's Electron zoom factor (about 1.3) after launch, so the 1280×800 content shows the UI larger; costs less visible content per pane;
2. a **wider display** – `width` above 800 up to the README column; costs first-screen height (AC-1 budget).

Plan step 4 picks between them with a short test clip taken **through the final encode**, before the scenario is built on it. Pass: every character of the prompt line and the agent's last lines is readable in a frame from the encoded file shown at its README display width, and the terminal's capital-letter height is at least 7 CSS px at that width (measured on the frame). The same clip is the evidence for R138-3's recorder quality: if Playwright `recordVideo` blurs the text, R138-3's fallback applies.

**Storyboard** (times are in the final, edited loop):

| Shot | Time | On screen | Why |
|---|---|---|---|
| S0 Open a project | 0.0–2.5 s | Erfana's start screen in the capture sandbox; the #138 demo project is opened from inside Erfana (its only recent-projects entry – never the native folder dialog, whose sidebar shows the user's name and home). The tree, a Markdown plan in the editor, the live preview and the terminal appear | "Open a project" (owner's words) |
| S1 Establish | 2.5–4.0 s | **Cut** (the terminal's Claude Code start-up screen is not shown, see R138-4): the same window with Claude Code idle at its prompt in the terminal; the context status bar visible | The whole product in one frame; "run the agent" |
| S2 Select | 4.0–6.5 s | A 5–7-step list in the editor is selected; right-click opens the context menu with the prompt templates; "Visualize" → "Flowchart" is chosen | Shows Markdown-to-prompt, the step no other editor has |
| S3 Hand-off | 6.5–8.0 s | The prompt appears in the terminal and is submitted to Claude Code | Makes clear the agent is Claude Code in the terminal, not Erfana |
| S4 Agent works | 8.0–13.0 s | Claude Code reads and edits the file (real output, **sped up**); no approval prompt stops it (R138-8); the context meter moves | The feedback loop; the only sped-up segment |
| S5 Edit lands | 13.0–16.0 s | A ` ```mermaid ` block appears in the editor; the preview renders the flowchart | "See the edit land" (owner's words) |
| S6 Hold | 16.0–18.0 s | Final state held still, then the loop restarts | A calm cut; gives the eye time to read the diagram |

The three steps the owner named – open a project, run the agent, see the edit land – are S0, S1–S4 and S5. The loop has one cut (S0→S1) and one speed-up (inside S4), nothing else edited.

The caption under the demo says it is a real Claude Code session with the agent's working time sped up, so the loop does not overstate speed. No text is burned into the frames.

**Alt text**: "Erfana demo: a project is opened, a list in a Markdown file is selected and sent to Claude Code in the integrated terminal with the Visualize prompt, and the agent's edit lands as a flowchart in the live preview."

**Scrubbing** (owner decision: real Claude Code, scrubbed). The loop must show no email address, account or organisation name, username or home path, token, API key, plan or usage figures (`/usage`, `/cost`, rate-limit messages), and no client data. The context meter's model name and percentage are session context, not account usage, and may show; its exact token counts only appear on hover, so the recording never hovers the meter. How the capture guarantees this is a requirement on #138 (below); how it is checked is plan step 5 (a one-frame-per-second contact sheet reviewed frame by frame).

**Still** (`demo-still.png`): the S5 frame at 1280×800 as PNG, used for `prefers-reduced-motion` and as the fallback if the demo cannot be recorded.

### Features list

A bullet list, not a table: a two-column table scrolls sideways at 375 px, a list wraps. One bold lead and one line each, linking the matching user-guide section from #138:

- **Integrated terminal** – Claude Code or any CLI agent in an xterm.js terminal, with file links, drag-and-drop paths, and screenshot and camera capture.
- **Markdown editor** – Monaco with live preview, scroll sync and Mermaid diagrams.
- **Project tree** – live git status and drag-and-drop file management.
- **Import and export** – import 50+ formats with local OCR (LiteParse); export to PDF and Word with diagrams.
- **HTML preview** – open a `.html` file as a live page, with a per-host prompt before any remote request.
- **Image viewer** – zoom, pan and full screen, repainting when the file changes; export to PNG, PDF or the clipboard.
- **Media transcription** – audio and video to text through the OpenAI API or fully offline with `whisper.cpp`.

Detail that leaves the README (WebGL, 22 Mermaid types, YAML frontmatter, in-file search, Markdown filtering, Reveal in Finder/Explorer, LibreOffice/ImageMagick, frames, Back/Forward, find, open in browser) is mapped in the fact audit.

### Badges (AC-5)

Three, in one row under the demo caption:

| Badge | Source | Why it stays |
|---|---|---|
| Quality Checks | `https://github.com/qodeca/erfana/actions/workflows/checks.yml/badge.svg?branch=main` (unchanged) | Tells a visitor released code is green |
| Latest release | `https://img.shields.io/github/v/release/qodeca/erfana?sort=semver` (unchanged) | Tells a visitor how current it is |
| License | `https://img.shields.io/badge/License-GPL--3.0--only-blue.svg` → `LICENSE` | Open source at a glance; states the exact SPDX id instead of "GPLv3" |

Dropped: the Platforms badge (the fact moves to the text line under Download, where it is next to the action it qualifies). Not added: stars, downloads, Discord and similar vanity or absent channels.

### The short sections

Each is 2–3 lines and links the full text. Wording is the implementer's, bound by the fact audit.

- **Built by Qodeca** – "Erfana is built by [Qodeca](https://qodeca.com), a Warsaw-based software team building for fitness, sport and healthcare since 2014. [More about Erfana and Qodeca](docs/about.md) · LinkedIn · hi@qodeca.com."
- **License** – GPL-3.0-only with `LICENSE`, `COPYRIGHT`, `THIRD-PARTY-LICENSES.md`; REUSE per-file licensing; the copyright line; one line on the CLA linking `CLA.md` and `docs/about.md`.
- **Trademarks** – the code is GPL, the name and branding are not; forks must be renamed and only Qodeca publishes official builds; "Claude"/"Claude Code" are Anthropic trademarks and Erfana is not affiliated – it runs the `claude` CLI like any terminal program; [full notice, including OpenAI and Whisper](TRADEMARKS.md).
- **Release verification** – signed artifacts since `v0.9.5` (minisign `SHA256SUMS`, notarisation, Authenticode); verify before installing; links to `docs/security.md#release-signing-v095-174`, `docs/build/release.md` and `docs/release-pubkey.txt`. **No key values in the README** (Guard 5).
- **Security** – one line on the hardening with a link to `docs/security.md`; report privately via advisory reporting, never a public issue.

`docs/about.md` (new) holds the full "Why open source, and how it's licensed" and "Built by Qodeca" text **verbatim** from the current README, plus a link back. Moving text verbatim is what makes "no legal fact lost" checkable by diff.

### Repository metadata (applied after merge)

Changing repository settings is outward-facing. **Decided by the owner (2026-09-25): the description, topics and social preview are applied only after the README merges, with the values shown to the owner first.** The implementer proposes the values in the PR; after the merge the leader shows them to the owner and applies them. Nothing below is applied by this design or by the implementation PR itself.

| Setting | Current | Proposed | Command (for the leader, after the merge and the owner has seen the values) |
|---|---|---|---|
| Description | "An agent-native, open-source Markdown workspace – run Claude Code and other terminal coding agents right beside your editor. macOS & Windows." | "An agent-native, open-source Markdown workspace – editor, live preview, project tree and a terminal running Claude Code or any CLI agent. macOS & Windows." | `gh repo edit qodeca/erfana --description "…"` |
| Topics (18 → 19) | as listed above | remove `ai` (on its own it reads as "an AI app"); add `agentic-coding`, `markdown-preview` | `gh repo edit qodeca/erfana --remove-topic ai --add-topic agentic-coding --add-topic markdown-preview` |
| Homepage | `https://qodeca.com` | unchanged | – |
| Social preview | GitHub's generated card | `docs/assets/readme/social-preview.png` | Settings → General → Social preview → Edit (UI only; no API) |

## UX design

Written to the `xezar-ux-design` authoring questions.

1. **Reader and job.** Someone who followed a link (a post, a search, a colleague) and is deciding in under a minute whether Erfana is worth downloading. They just clicked; next they either download, open the user guide, or leave. A second reader – a contributor – arrives already committed and will scroll or open `CONTRIBUTING.md`.
2. **First read.** Name and look (banner), what it is (pitch), how to get it (Download), what it does (demo). All on the first screen (AC-1); nothing requires a click or scroll.
3. **Scanning many.** The body is scanned by headings: "How it works", "Features", "Get started", then the short trust sections. Each feature is one bold lead; the reader stops at the one they care about and follows its link into the user guide.
4. **The distinction that matters most.** Erfana **hosts** an agent; it is not one. Said in words in the sub-line ("a terminal running Claude Code – or any CLI agent"), in the demo (the prompt visibly goes to the terminal), in the caption and in the Trademarks line. Colour and imagery only reinforce it.
5. **States.** See [States](#states).
6. **Deliberately not built.** No docs website, no video, no language switcher (there are no translations), no table of contents (the page is short), no contributor grid, no sponsor block, no per-platform direct-download links (asset names carry the version), no Linux instructions (there is no Linux build – said once, plainly).
7. **Accessibility bar.** Every image has meaningful alt text (banner "Erfana"; demo described; Download button "Download Erfana for macOS or Windows"). Meaning never sits in an image alone – pitch, platforms and features are text. Motion: the demo honours `prefers-reduced-motion` through the still; the loop is 18 s with no flashing. Contrast figures are in the banner table. Keyboard and focus are GitHub's; our content adds only ordinary links. At 375 px: images scale to width, the link row and the platform line wrap, the features are a list, and nothing scrolls sideways (checked in plan step 9).
8. **What gets cut.** On a narrow screen nothing is removed – images shrink. If the first screen must shrink further, the order of sacrifice is: link row wraps → demo drops below the fold. Banner, pitch and Download never move below the demo.
9. **Worst case, measured.** Longest line: the platform line (~80 characters) wraps at 375 px. Heaviest asset: the demo at its 5 MiB cap takes about 4 s on a 10 Mbit/s link (about 2.5 s at the 3 MiB target); the alt text and the pitch carry the meaning while it loads. The page stays well under GitHub's 500 KiB README limit (today 8.8 KB). Longest viewport: 1440×900 is the first-screen reference; 1280×800 is recorded as a second measurement.

## States

| State | What the reader sees | Handled by |
|---|---|---|
| GitHub light theme | Light banner, lime-on-dark Download button, demo | `<picture>` light source |
| GitHub dark theme (default and high contrast) | Dark banner | `<picture>` dark source |
| GitHub dark dimmed | Dark banner as a flat rectangle on #22272e | Accepted; recorded in QA |
| Viewer without `<picture>` / `prefers-color-scheme` | Light banner (fallback `<img>`) | Fallback is light and has alt text |
| Reduced motion requested | Still frame instead of the loop | `<source media="(prefers-reduced-motion: reduce)">` (verified on github.com in step 9; if GitHub's own "autoplay animated images" setting also pauses it, both are recorded) |
| Image fails or is slow | Alt text; pitch and features still carry the meaning | Alt text on every image |
| shields.io down | Download button shows its alt text as a link to Releases; badges show alt text | Alt text; the "Get started" section repeats the Releases link as text |
| User guide not yet merged | A broken "User guide" link | Ordering: the README PR merges only after #138's guide index exists (plan step 0) |
| Demo not recordable (no Claude login on the capture machine) | – | Stop and report (#138 rule); do not ship a faked demo. The README may ship with `demo-still.png` only if the leader accepts that as a partial delivery of AC-3 – otherwise AC-3 stays open |

## Open decisions

Only decisions that are genuinely the owner's, or that this design cannot settle alone. Design choices themselves (pitch, layout, banner, storyboard) are for the reviewer agent to approve, per the owner.

1. **Apply the repository metadata** (description, topics, social preview) – **decided** by the owner (2026-09-25): applied only after the README merges, with the values shown to the owner first (see [Repository metadata](#repository-metadata-applied-after-merge)).
2. **Extend `TRADEMARKS.md` § Logos and brand assets** – **decided** by the owner (2026-09-25): `TRADEMARKS.md` will be extended to name the new banner, wordmark and social image (`docs/assets/readme/banner-*.png`, `social-preview.png`) as Erfana marks that a renamed fork must replace. Done in the build PR (plan step 7).
3. **A permanent external-link check in CI.** Internal links, anchors and the wording rule are already covered: #138's `scripts/check-links.mjs` (`npm run check:links`) runs in the gate once #138 adds it (`.xezar/checks/repository-checks.sh` runs it whenever the file exists) and its scope reaches `README.md`, which links into `docs/user-guide/`. External URLs and badge fetches are not; a CI job for them would be a new workflow job – a trust-boundary change (`.github/workflows/`) and outside #139's scope. Recommendation: fetch them by hand for this PR (AC-5, AC-6) and file a follow-up issue.
4. **Recording the light-theme deviation.** The app is dark-only by rule; the banner card renders a light variant because GitHub has a light theme. Recommendation: the card says so in its Exceptions section (`/* deviates: … */` convention); no change to the app rule. Reviewer confirms; owner only if the reviewer disagrees.
5. **Demo format** – **decided** (owner's pick "A 10–20 second loop (GIF or WebP)"; leader decision 2026-09-25): animated WebP if the step-1 spike shows it plays in Chrome, Safari and Firefox on github.com, otherwise GIF; both produced by #138's `encode.mjs` (R138-9). MP4 via a `user-attachments` upload is not used in the hero (hosted outside the repository, re-uploaded by hand after each recording). This comes back to the owner only if the spike fails for WebP *and* the GIF misses the 5 MiB cap.

## Requirements on #138

#138 owns the demo fixture project and the capture script (owner decision). This design **does not** design either; it states what the README needs from them. The leader hands this table to #138's design fix (draft PR #141) as-is (2026-09-25). If #138 lands without one of these, #139 adds it **inside #138's script and fixture**, never as a second copy.

State at #141 head `b7864e20` (from the review of this spec): R138-5 and R138-7 are met, R138-4 partly; the rest are open there.

| ID | Requirement |
|---|---|
| R138-1 | The fixture contains a Markdown file suited to the demo: a short, fictional plan with a 5–7-item list that the Visualize prompt can turn into a flowchart, and **no diagram yet** (so Visualize visibly adds one); neutral project and file names. |
| R138-2 | The capture script can run the README demo as a **named scenario** from the one documented command (for example `npm run docs:screenshots -- --only readme-demo`, if `--only` accepts a scenario id; otherwise the manifest row id that selects it), with condition-based waits only. The scenario starts at Erfana's start screen so S0 (open a project) is recorded. |
| R138-3 | A **recording mode** for that scenario: the app window only (no desktop, menu bar or clock), at the **1280×800 content size** #138 already uses (`setContentSize(1280, 800)`) – one size for both specs – written to a git-ignored working directory. Recorder: Playwright `recordVideo`, as #138 uses. It must pass #139's terminal-legibility check (plan step 4) through the final encode; if it does not, #138 switches that scenario to a sharper source (Playwright `page.screencast`, or `screencapture -l -V` on macOS, both named by the #138 research) – the choice of fallback is #138's. |
| R138-4 | Scrubbing: the fixture opens from a path with no username or home directory in it (#138's `/tmp/erfana-capture/`), from Erfana's own recent-projects list, never the native folder dialog; the capture's Claude Code runs with the capture machine's personal status line and hooks disabled; the scenario never runs `/status`, `/usage` or `/cost` and never hovers the context meter; Claude Code's start-up screen, which can show account details, is **cut** from the edited loop (the S0→S1 cut) and never reaches a committed file. |
| R138-5 | Real Claude Code with a real login; if none is available, stop and report – never fake output (#138's own rule, restated because the README inherits it). |
| R138-6 | A still of the S5 state (editor with the new Mermaid block, preview rendering it, terminal showing the finished agent turn) at the recording's resolution, as `demo-still.png`. |
| R138-7 | The user guide index at `docs/user-guide/README.md` (or the path #138 chooses – the README links whatever exists) with section anchors the Features list can link. |
| R138-8 | **Edit approval during the recording.** By default Claude Code asks before it edits a file, and the sandbox's `.claude/settings.json` holds only a Stop hook, so S4 would stop at a prompt. #138 handles it one of two ways: (a) the sandbox project's `.claude/settings.json` sets an edit-accepting permission mode (Claude Code's `acceptEdits`), scoped to the sandbox only; or (b) the scenario answers the prompt with its keypress and the storyboard shows it in S4. Recommendation: (a) – it keeps S4 short and is not an account detail; the mode shown in Claude Code's footer may appear on screen. |
| R138-9 | `encode.mjs` also emits **animated WebP** (`libwebp_anim`, looping) beside the GIF and MP4 it already produces, from the same trimmed and sped-up source; the size budget applies to each. |
| R138-10 | Manifest validation (`manifest.mjs`) accepts a `file` ending in `.webp`, and the output allow-list at the top of `run.mjs` includes `docs/assets/readme/`. |
| R138-11 | The privacy deny-list and OCR pass (`privacy.mjs`) also runs over the **demo's frames** – one frame per second of the final encode at least – not only over stills; a hit fails the run like any other (exit 5). |

## Developer handoff

### Implementation plan

Ordered; each step lists its files and its verification. Evidence (screenshots, contact sheets, logs) goes to the task's evidence directory, never into the repository, except the downscaled QA screenshots named in step 9.

**Step 0 – Preconditions.** #138's fixture, capture script, `check-links.mjs` and user-guide index are merged into `develop` (R138-1…11). Rebase on `develop`. *Verify*: the paths exist; `npm run docs:screenshots -- --check` and `npm run check:links` run; each R138 row is ticked against #138's merged code, and any row #138 did not deliver is added inside #138's files here (never a second copy).

**Step 1 – Spike: animated WebP on github.com.** Encode a 3-second test clip with #138's `encode.mjs` WebP output (R138-9; `ffmpeg-static` with `-c:v libwebp_anim -loop 0` directly only if #138 has not landed it yet), commit it on the working branch with a scratch Markdown file, and view it on github.com in Chrome, Safari and Firefox, in both themes, and with reduced motion emulated. Remove the scratch files before review. *Verify*: a short note in the PR: plays / does not play per browser; the chosen format. *Files*: none kept.

**Step 2 – Banner card.** `design/product/github-presentation/index.html`. Line 1 is the card marker with all four required attributes (`design/README.md` § Adding a card), e.g. `<!-- @card group="Product" name="GitHub presentation" subtitle="README banner, wordmark and social preview" status="proposed" reviewed="<authoring date>" -->`; lines 2–3 the SPDX header. It renders the dark banner, the light banner and the social preview at layout size, links `../../tokens.css`, `../../fonts.css` and `../../ds.css` (the depth for a folder under `product/`), loads the icon from `../../../resources/icon.png`, and has an Exceptions section for the light variant. Every contrast ratio it shows is a `data-claim` span backed by a `contrast` entry added to `design/claims.json` (foreground and background tokens as in the banner table). Run `npm run design` (regenerates `design/index.html` and `design/claims.js`). *Verify*: `npm run lint:css`, `npm run design -- --check`, the design-claims test (`scripts/design-claims.test.mjs`, in `test:ci`) green; open the card in a browser and tab through it.

**Step 3 – Render script for brand assets.** A script in #138's capture folder (proposed `scripts/capture/brand.mjs`, SPDX header) that opens the card in Playwright Chromium at `deviceScaleFactor: 2` and screenshots the three elements to `docs/assets/readme/banner-dark.png`, `banner-light.png` (1600×400) and `social-preview.png` (1280×640 at 1×). An npm script (`docs:brand`). *Verify*: pixel dimensions (`file`), sizes within budget (≤ 150 KB, ≤ 150 KB, ≤ 300 KB), two runs produce the same dimensions; view each PNG.

**Step 4 – Legibility check, then the demo scenario.** First, before any scenario work: record a 3-second clip of the terminal showing Claude Code output with #138's recorder (R138-3), run it through `encode.mjs` at the final settings, and apply the [terminal legibility](#demo-loop) pass rule to a frame of the result at its README display width; choose the capture-only zoom or the wider display from it, and if the recorder itself blurs text, stop and hand R138-3's fallback back to #138. Then the `readme-demo` scenario in #138's capture script per the storyboard (R138-2…4, R138-8). *Verify*: the legibility frame and its measured cap height in the evidence directory; the scenario runs twice from a clean checkout; no `waitForTimeout`; no approval prompt left waiting in S4; lint and typecheck clean.

**Step 5 – Encode and check the demo.** No new script: the `readme-demo` manifest row makes #138's pipeline trim, speed up the S4 segment and encode through `encode.mjs` at 1280×800 to `docs/assets/readme/demo.webp` (or `.gif` if step 1 said so) plus `demo-still.png` (R138-6, R138-9, R138-10), and runs the privacy pass over the demo's frames (R138-11). A 1-fps contact sheet for human review is made with one `ffmpeg-static` `tile` command into the evidence directory (recorded there, not committed). *Verify*: duration 10–20 s and file size read from ffmpeg's output and stated in the PR (AC-3); the privacy pass is clean; the reviewer checks every contact-sheet frame against the scrub list (AC-3; #138's "no personal data" check), including that no Claude Code start-up screen survives the S0→S1 cut.

**Step 6 – Relocate text.** Create `docs/about.md` (SPDX header; the two sections verbatim, with links for F-44); add the image-export sentence to `docs/features/README.md` item 12 (F-30); confirm F-50's "validation on every channel" in `docs/security.md` and F-65's build commands in `docs/build/README.md` – add only what is missing; add `docs/about.md` to the `docs/README.md` index. *Verify*: `git diff` shows the moved text byte-for-byte; the fact-audit rows marked "add" now hold.

**Step 7 – REUSE.** Add a `[[annotations]]` block to `REUSE.toml` for `docs/assets/readme/**` (`SPDX-FileCopyrightText = "2025-2026 Qodeca sp. z o.o."`, `SPDX-License-Identifier = "GPL-3.0-only"`, with a comment that the files are Erfana brand assets under `TRADEMARKS.md`). The blanket `**` annotation already covers them; the explicit block records the trademark note next to the files (AC-8). Extend `TRADEMARKS.md` § Logos and brand assets to name the banner, wordmark and social image files (open decision 2, decided yes by the owner). *Verify*: CI `License compliance` (the local gate does not run `reuse lint`; run `pipx run reuse lint` if available and say so if not).

**Step 8 – Rewrite `README.md`.** Per [Screens](#screens). *Verify*:
- the fact audit re-run as a checklist, every F-id ticked with where it now lives (AC-4) – included in the PR description;
- each badge and image URL fetched and answers 200 (AC-5);
- `npm run check:links` (#138's checker: relative links, anchors, image links and the no-built-in-AI wording rule; its scope reaches `README.md` because it links into `docs/user-guide/`) green, and `docs/about.md` checked by it too (in scope if it links the guide; otherwise its `--all` report is read for that file) (AC-6, AC-7); plus each **external** URL in the changed Markdown fetched and answering 200 – the one thing `check:links` does not do. The output of both goes in the PR;
- beyond `check:links`' wording rule, a read of every sentence: nothing says "AI-powered", "built-in AI", "AI editor", "AI assistant", "intelligent" or "smart" about Erfana itself, and "context" meter sentences name Claude Code (AC-7);
- no `^RW[A-Za-z0-9+/=]+$` line in the README (Guard 5);
- `SECURITY.md`'s `#release-verification` link still resolves.

**Step 9 – Rendered QA on github.com.** Push the branch; open the README on github.com with the Chrome DevTools tools at 1440×900, emulating `prefers-color-scheme: light` and `dark` (logged-out GitHub follows the system theme), and additionally at 1280×800, at 375 px, with `prefers-reduced-motion: reduce`, and in the dark-dimmed theme if a logged-in session is available. Measure the [first-screen rule](#first-screen-budget-ac-1) with `getBoundingClientRect()`: the pass measurement on the unscrolled README file view (banner, pitch and Download fully visible; demo top ≤ 700 px from the viewport top), and the recorded one on the home page scrolled to the article top; also read the height of GitHub's chrome above the article and of the `<h1>` rule. The PR states that the unscrolled home page shows the file list first. *Verify*: screenshots of light and dark at 1440×900 (AC-1, AC-2) downscaled and committed under `docs/designs/139-readme-redesign/qa/` so the design review can see them (they contain only public GitHub content); the rest in the evidence directory. Update this document's "Design review" section with the reviewer's verdict link.

**Step 10 – Gates and handoff.** The workflow's gate step runs `.xezar/checks/repo-gates.sh --fast`; CI's seven required checks (AC-9). The PR description carries: the measured sizes and duration, the fact-audit checklist, the proposed repository metadata marked **applied after merge, values shown to the owner first**, the open decisions, and the statement that design approval is by a reviewer agent on a different model, not the owner. Labels: `needs-design`, `needs-qa`.

### Files

| File | Change |
|---|---|
| `docs/designs/139-readme-redesign/README.md` | This design (this PR) |
| `docs/README.md` | Index entry for this design (this PR); `docs/about.md` entry (implementation) |
| `design/product/github-presentation/index.html` | New card |
| `design/claims.json` | `contrast` entries for every ratio the card shows |
| `design/index.html`, `design/claims.js` | Regenerated by `npm run design` |
| `scripts/capture/brand.mjs` (name follows #138's folder) | New script, SPDX header – renders the card; nothing in #138 does this |
| `scripts/capture/encode.mjs` | **#138's file.** Animated WebP output beside GIF and MP4 (R138-9). Lands in #138; changed here only if #138 merged without it |
| `scripts/capture/manifest.mjs`, `scripts/capture/run.mjs` | **#138's files.** Accept `.webp`; add `docs/assets/readme/` to the output allow-list (R138-10); the `readme-demo` row and scenario (R138-2). Same rule |
| `scripts/capture/privacy.mjs` | **#138's file.** Deny-list and OCR over the demo's frames (R138-11). Same rule |
| `package.json` | One npm script (`docs:brand`); no dependency change. The demo runs through #138's `docs:screenshots` |
| `docs/assets/readme/banner-dark.png`, `banner-light.png`, `social-preview.png`, `demo.webp` (or `.gif`), `demo-still.png` | New images |
| `docs/about.md` | New – relocated text, verbatim |
| `docs/features/README.md` | Item 12: image export sentence |
| `docs/security.md`, `CONTRIBUTING.md` | Only if the step-6 confirmation finds a gap |
| `REUSE.toml` | Explicit annotation for `docs/assets/readme/**` |
| `TRADEMARKS.md` | § Logos and brand assets names the banner, wordmark and social image (open decision 2, owner decided yes) |
| `README.md` | Rewritten |
| `docs/CHANGELOG.md` | Unreleased entry: README redesign |
| `docs/designs/139-readme-redesign/qa/*.png` | Downscaled QA screenshots |

Not touched: `SECURITY.md` (its anchor is preserved), `.github/workflows/` (no new CI job – open decision 3), application source.

### Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Animated WebP does not play on github.com in some browser (it is not in GitHub's documented media list; Safari animation support is not in Google's FAQ) | Blank or static demo | Step 1 spike before any recording; GIF fallback with the same budget; open decision 5 if both fail |
| Real Claude Code output varies run to run and can take long | Unstable loop length; a different diagram each time | Only S4 is sped up; the storyboard fixes timing at the edit, not the agent; re-record until S5 shows a readable diagram; the caption discloses the speed-up |
| Personal data leaks into a frame | Privacy breach, published | R138-4 at capture; frame-by-frame contact-sheet review before commit; never commit an unreviewed recording |
| No Claude login on the capture machine | No demo | Stop and report; the still-only fallback is the leader's call, not the implementer's |
| #138 slips or changes paths | README links break; scripts duplicated | Step 0 precondition; requirements R138-1…11 handed to #141 by the leader (2026-09-25), each ticked in step 0 |
| Terminal text unreadable at the display width, or blurred by the recorder | The loop's key moment (the hand-off to the agent) cannot be read | Legibility check through the final encode in step 4, before the scenario is built; capture-only zoom or wider display; R138-3's recorder fallback |
| Claude Code stops at an edit-approval prompt | S4 stalls or the scenario times out | R138-8: edit-accepting mode in the sandbox settings, or the keypress shown in S4 |
| Demo text unreadable on a phone (NB-1, PR #159 design review) | At 375 px the 1280 px loop scales to about 309 px (24 %), so its terminal and editor text cannot be read | **Accepted limit, not fixed.** The design gives narrow views no other presentation: UX item 8 says nothing is removed and images shrink, and the `<picture>` sources switch only on `prefers-reduced-motion`. The alt text, the caption and the How it works bullets carry the sequence in text. A narrow-view variant (a cropped terminal clip, or a link to #138's MP4) would need a new design decision and a re-recording, which this build does not do |
| Demo too heavy | Slow first load | 5 MiB hard cap; 12 fps; 1280×800; measured in step 5 |
| GitHub layout differs from the budget (column width, spacing) | AC-1 fails | Measured on github.com, not assumed; banner and demo heights are the adjustable parts |
| Banner drifts from tokens later | Off-brand banner | The card is the source; `docs:brand` re-renders it; the card sits in `design/` under the same lint |
| Trademark misuse (icon modified, a third-party name in the banner) | Legal exposure | Icon used unmodified; no third-party name or mark in banner or social preview (the terminal strip shows a bare `❯` glyph); the Anthropic notice stays on the page; `TRADEMARKS.md` names the new brand files (open decision 2) |
| Anchor or link breakage | Broken links from `SECURITY.md` and outside | Kept headings; `npm run check:links` and the external fetch in step 8 |
| Guard 5 trips | Required check fails | No key values in the README |
| An overclaim slips into copy | Violates `CLAUDE.md` | Banned-phrase check in step 8; reviewer reads every sentence against AC-7 |

## Design review

Pending. Approval is by a reviewer agent on a different model from the author, not by the owner (owner decision, campaign `release-0.21.0`, 2026-09-25).

- Round 1: REQUEST CHANGES at `68d292ae` ([PR #140](https://github.com/qodeca/erfana/pull/140)), eleven findings; all eleven addressed in the following commit, with the leader's cross-spec decisions shared with #141 (one 1280×800 size, WebP from #138's `encode.mjs`, R138-1…11).
- Build review: FAIL at `56ba01bb` ([PR #159](https://github.com/qodeca/erfana/pull/159)) – B-1 account name in the QA screenshots (masked), NB-1 demo unreadable at 375 px (accepted limit, see Risks), NB-2 `gp-` class naming (documented deviation in the card).

## Implementation notes

Measured during the build (2026-09-25), logged out, Playwright Chromium on github.com.

- **Demo format**: animated WebP. On github.com it animated in Chromium, WebKit (Safari's engine, not Safari itself) and Firefox, and `prefers-reduced-motion: reduce` swapped in `demo-still.png` in all three (step 1).
- **Banner width 440, not 800.** At `width="800"` the demo's top edge was at 799 px on the unscrolled README file view at 1440×900, and at 703 px with the banner at 480. At 440 it is at **693 px** (banner 386–496, pitch 531–579, Download 595–623). GitHub's chrome above the article is 386 px; the `<h1>` rule adds 9.6 px padding and a 1 px border. The link row now shares the Download paragraph, which saves one paragraph margin.
- **Home page**: the unscrolled home page shows the file list first (article top at 2,849 px). Scrolled to the article top, the demo starts at 308 px.
- **375 px**: no horizontal scroll; images scale to 309 px; the platform line and link row wrap. The demo's text is not readable at that width – an accepted limit, see [Risks](#risks).
- **Canvas edge**: the banner's solid background is faintly visible against both GitHub canvases as a flat rectangle, as expected from the 1.02:1 and 1.05:1 ratios.
- QA screenshots of both themes at 1440×900, downscaled: [light](qa/readme-1440x900-light.png), [dark](qa/readme-1440x900-dark.png). GitHub's commit row (avatars and account names) is masked in both; the first versions showed it, and they remain in git history.
