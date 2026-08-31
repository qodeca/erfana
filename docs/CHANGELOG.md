# Erfana Changelog

Per-version release notes for Erfana, v0.9.0 onwards. Earlier: v0.8.0–v0.8.3 in [archive/changelog-v08.md](./archive/changelog-v08.md), v0.3.0–v0.5.4 in [archive/changelog-v03-v05.md](./archive/changelog-v03-v05.md); v0.6.x–v0.7.x have no entries at all, as recorded under "Earlier versions (archived)" at the foot of this file. For in-flight Windows enablement work not yet released, see [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) "Status snapshot".

> **Note:** In v0.7.2, BRS (Business Requirements Specifications) were renamed to "specs" and relocated from `specs/business-reqs/` to `specs/spec-t{tier}-{id}-{slug}/`. All references in code and docs now use `Spec #XXX`. Historical entries below have been updated accordingly.

## Unreleased

### Fixed

- **Text fields you could not see** – an input's inside was exactly the same colour as the panel behind it, and its border was so faint it measured 1.24:1 against a required 3:1. On a good monitor in a bright room you found the box by clicking where you guessed it was; with low vision you could not find it at all. Fields now draw a boundary you can actually see, on every surface they appear on, and placeholder text went from 2.69:1 to 4.53:1 so it is readable rather than a suggestion of text. This affects every dialog, the rename box, the search bar and the settings panel.
- **Coloured values in document frontmatter came out plain grey** – a `true` or a `42` at the top of a markdown file was supposed to be colour-coded like the strings beside it. The colours were referenced but never defined, so they silently fell back to body text in every document with frontmatter. Numbers and booleans are now coloured, and the window picker's thumbnail frame – missing for the same reason – is back.
- **A flash of light theme on a light-mode Mac or PC** – one toolbar in the diagram view had its own light-mode styling, left over and unmaintained. Erfana is dark-only, but that toolbar followed your operating system instead, so anyone running a light desktop saw it in the wrong colours. Removed.
- **The keyboard focus ring on dialog buttons appeared after mouse clicks too**, which made it look like a rendering fault. It is now shown to keyboard users only, which is who it is for.

### Changed

- **Two more checks now have to pass before code can merge**, both inside the existing `Lint` job: a stylesheet linter that fails on a raw colour, a hard-coded stacking order, or a rounded corner; and a check that the design system in `design/` has been rebuilt after a token change. Run `npm run lint:css` and `npm run design -- --check` locally before pushing. See [Continuous integration](./ci.md).
- **`design/` is now the source of truth for how Erfana looks.** It is a set of pages you open in a browser, each deciding one rule – one focus ring, one selected state, one warning colour – and showing it working rather than describing it. Every number in it is calculated from the real code on each run, so it cannot quietly go out of date. [`docs/ui-style-guide.md`](./ui-style-guide.md) has been cut back to the few things the cards do not cover. Start at [`design/index.html`](../design/index.html).

### Known issues

- Nine accessibility defects found during this work are recorded and filed but **not yet fixed**: the file tree and right-click menu cannot be used with a keyboard, most dialogs do not trap focus, and several controls are smaller than the minimum touch target. See [Known issues § Accessibility](./known-issues.md#accessibility) and issues [#88–#96](https://github.com/qodeca/erfana/issues/88).

### Added

- **Links inside an HTML preview now work, and every `.html` file gets its own tab** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – until now, clicking a link in a previewed page did nothing at all: no navigation, no message, not even an entry in the failure badge. And only one preview could run: opening a second `.html` file showed "A preview is already open." Both are fixed. **Every `.html` file now opens in its own tab and runs independently**, like a Markdown preview. To keep the cost bounded, the three most recently used previews stay running and the rest freeze to a still picture of the page, starting themselves again the moment you click their tab — so a sleeping preview looks like the page you left, not a blank panel. Page state (scroll position, typed text) is lost when a preview sleeps. **Clicking a link opens its target inside Erfana, in a new tab**, reusing the tab if that file is already open, exactly like clicking in the project tree. Be aware this deliberately departs from web convention: on the web a plain link replaces the page you are on and only `target="_blank"` opens a tab, whereas here *every* link opens a tab — so clicking through a generated documentation site accumulates tabs quickly. `target`, `_self` and `<base target>` are read but change nothing; there is no in-page navigation in this version. A link to a `.md`, an image or any other project file opens in its usual panel; a link into `node_modules/`, `dist/` or a gitignored path opens as source; a link to a missing file or one outside the project is refused and listed in the failure badge, so a dead link finally says so instead of doing nothing. An `https:` or `mailto:` link shows you where it goes and asks before handing it to your browser — a click proves you clicked, not that you knew the destination, and a previewed page can move a link under your cursor. Two cases where a link still does nothing, both unchanged: a page whose own JavaScript cancels the click, and a link inside a closed shadow root. See [HTML preview § Links](./html-preview/README.md#links).

- **You can now zoom the previewed page itself** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – Cmd/Ctrl-plus and minus over a preview used to make the text *smaller*, which is the opposite of what anyone wants and left no route to readable text at all. The reason was that zoom was resizing the preview's rectangle rather than the page inside it, so a bigger box held the same-sized text and everything around it shrank in comparison. Zoom now goes to the page, the way it does in a browser: the text grows, 200% is reachable, and Cmd/Ctrl-0 returns to normal. It works from the keyboard over the page and from the **View** menu, and each preview remembers its own zoom – including across a sleep and wake, so returning to a tab you had zoomed does not reset it.
- **A preview now carries a permanent "Preview – content below is not Erfana" label** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – a previewed page is somebody else's HTML, and it paints over everything in its panel. It now also stays on screen while Erfana asks you a security question, such as whether to let the page reach a remote host. A thin band of Erfana's own interface sits above every live preview, in a strip the page provably cannot draw on, so a prompt that appears *inside* the preview area is the page imitating Erfana, not Erfana. See [`docs/security.md`](security.md).

### Fixed

- **An HTML file opened to a black, empty tab** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – opening an `.html` file showed nothing at all. The page was running the whole time, at one pixel square, behind a black panel; it only appeared once you clicked around the other tabs and something unrelated nudged it to the right size. Two separate faults, either one enough on its own: the panel measured itself while it was still a hidden tab with no size, and the size it did eventually send arrived before the preview existed and was thrown away without a word. The preview is now sized and visible immediately – measured at 9 ms from opening the tab.
- **Previewed pages were unreadable – near-black text on a near-black background** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – any page that did not set its own background colour was painted on Erfana's dark brand colour while its text stayed the browser default black. Only the parts of a page with a background of their own could be read. A preview now paints the colour the page itself asks for, the way a browser does – white for ordinary HTML, and genuinely dark for a page that declares a dark colour scheme rather than the white-on-white this would otherwise have become. Saving a file or approving a host reloads without a flash of any colour.
- **A notification hid every preview, sometimes for good** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – any message popping up in the corner blanked every running preview for as long as it was on screen, whether or not it was anywhere near one. The worst case was self-inflicted: the "Approve this host?" prompt a preview raises about its own page waits for you and never dismisses itself, so a preview raised a message that hid every preview indefinitely. Messages now move out of the preview's way instead of hiding it, so you can read the page and answer the question at the same time. If a window is genuinely too small for the message to fit clear of the page, the old behaviour returns and the preview hides – a security prompt must never end up underneath somebody else's web page.
- **Previews are now cleaned up when their window closes** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – quitting with previews open wrote one warning per preview to the log file. The warning was pointing at something real: nothing removed a window's previews when the window went away, so with a second window open its previews stayed running after it closed. Previews now follow the same rule as terminals, file watching and git status, all of which were already cleaned up on window close.
- **Closing a preview tab while it was still opening leaked the whole preview** – closing a tab in the moment between clicking an `.html` file and the page appearing left a running preview behind with nothing pointing at it: its browser view, its session, its file watchers and its registry entry all stayed alive for the rest of the session. The close was a no-op in exactly that window, and nothing ever cleaned up afterwards. With one preview that leaked one; with a preview per tab it would have leaked one per tab.
- **A preview tab could become permanently unusable** – if any step of tearing a preview down failed, the teardown stopped there, skipping the part that actually destroys the view. The panel was left marked as destroyed but still holding a live browser view, and that tab could never show a preview again until the app was restarted. Teardown now always completes and always destroys the view, whatever fails along the way.
- **Approving one blocked host made the others disappear** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – on a page that reached for several remote hosts, allowing one wiped the rest from the failure badge and left no way to allow them at all, short of closing the tab and opening it again. Approving reloads the page, and on that reload the remaining hosts were recognised as "already reported" and silently swallowed — while the list they would have appeared in had just been cleared. Every host still blocked after an approval is now listed again, so working through several is a matter of clicking Approve as many times as needed.
- **A busy page could hide one of its own blocked hosts for good** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – a page with many images from one place could use up the budget Erfana keeps for reporting blocked hosts, on repeats of a host it had already listed. A different host mentioned later in the page — a script, say — was then never reported and never offered, and reloading reproduced it exactly. Repeats no longer cost anything.
- **The "Approve this host?" prompt could slide back underneath the page** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – the prompt moved clear of the previewed page correctly, then dropped straight back on top of it as soon as a second message arrived or the find bar opened, leaving it invisible and unclickable, with clicks landing on the page instead. It was measuring its own moved position and concluding it no longer needed to move. It now stays where it put itself.
- **The prompt now says what allowing a host actually does** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – it said the preview "will reload and may fetch remote content", which reads as unblocking one image. Allowing a host in fact lets it run code in the preview and send data out, and the decision is written into the project's own settings file — so it applies to every preview in that project, survives restarts, reaches anyone who clones the repository, and cannot yet be undone from inside Erfana. The prompt says all of that now, and the button reads "Approve for this project".
- **A page with a faintly tinted background was painted solid black** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – a common styling shortcut, a barely-there tint over white, was read as pure black, so the page's own black text became invisible. This was the unreadable-page problem returning by another route.
- **A preview that failed to load could blank the other previews** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – after a failed load, Erfana kept believing a page still occupied that part of the window. Notifications then worked around a rectangle that was not there, and in a large panel gave up and hid every running preview until dismissed — which, for a prompt that waits for you, meant indefinitely.
- **A no-op link (`<a href="#">`) opened the page's own file and stole your place** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – the standard link idiom behind dropdowns, tabs and toggle buttons was treated as a navigation to a different page, re-opening the file already on screen and pulling keyboard focus off the page every time it was clicked. It is now what it always meant: nothing.
- **A sleeping preview could stay asleep** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – returning to a tab whose preview had been put to sleep normally wakes it. If another preview happened to start at the same moment, the wake was abandoned and nothing tried again, leaving a frozen picture of the page with no way back except closing the tab. It now retries.
- **A screen reader read the notification stack backwards** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – dismissing the newest message caused the one beneath it to be announced again as though it had just arrived. With three messages, closing them one by one read all three out in reverse.
- **Allowing a host from a prompt whose preview you had already closed** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – the prompt outlives the tab that raised it, and clicking Approve after closing that tab still wrote the host permanently into the project's settings, with no preview to apply it to and nothing on screen to say so. It now declines and tells you why.
- **Some hosts were offered for approval and then refused** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – a hostname with a trailing dot or an underscore, or one seen only over an insecure `http://` connection, showed an Approve button that quietly did nothing when pressed. Those hosts are still listed as blocked; they are simply no longer offered.
- **A `tel:` link asked "The preview wants to open: null"** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – the one prompt standing between a previewed page and your operating system named nothing at all for phone and SMS links. It now shows the number.

- **Approving a remote host now applies to every open preview of that project**, not just the one that asked. The approval already opened the network gate for all of them, while only the approving preview had its security policy rebuilt — so a second preview could be left forbidding a host its own network filter had already allowed.

### Internal

- **A preview open that gets overtaken now says so in the log** ([#74](https://github.com/qodeca/erfana/issues/74) follow-up) – when a newer action overtakes an in-flight preview open (a project switch, a close, a sleep), the open correctly gives up and correctly shows no banner, because whoever overtook it owns what happens next. But it returned in complete silence, and that silence is a large part of why an invisible preview took so long to find: a genuinely failed open painted a black rectangle and reported nothing anywhere. It now logs a debug line with the file's name only, never its full path.
- **Every IPC channel is now sender-gated by default** – the app has roughly 118 main-process handlers and only eight files checked who was calling, leaving `shell:openExternal`, terminal creation and the file-writing handlers open to any renderer frame that could send. A single guard now sits in front of all of them, so handlers are protected by default rather than by each author remembering, and future handlers are covered automatically.
- **`shell:openExternal` validates URLs by parsing them** instead of comparing text prefixes, rejects embedded credentials, bounds the length, and no longer writes full URLs into log files. Electron's own guidance is that prefix comparison can be fooled; a `javascript:` URL containing the text `https://` would previously have passed.
- **Electron raised to 39.8.10**, which carries a fix for a sandboxed-iframe popup bypass — the preview relies on exactly that restriction.

## 0.18.0

*Released 2026-08-25. Tag `v0.18.0`.*

### Added

- **HTML preview – see a page's HTML render with its CSS and JavaScript actually running** ([#74](https://github.com/qodeca/erfana/issues/74)) – Erfana can now show a live preview of an HTML page, with styles applied and scripts executing, instead of only its source. The page renders in a sandboxed, isolated view layered over the panel, kept apart from Erfana's own interface, and its local files are served over a private, app-only channel rather than opened directly. A page that reaches out to a remote host is blocked until you approve that host: you are prompted once, and your approvals are remembered per project (up to 200 hosts) so you are not asked again. You can export the live page to PDF and search within it, and there is a single global switch to turn the whole feature off (on by default). See [HTML preview](./html-preview/README.md) and [`docs/security.md`](security.md).
- **You can now save the picture you are looking at as a PNG or a PDF, or copy it straight to the clipboard** ([#73](https://github.com/qodeca/erfana/issues/73)) – an image opened in its own tab was a dead end: you could zoom it and you could look at it, but getting it out of Erfana meant going back to Finder or Explorer and finding the file by hand. The image viewer's toolbar now carries three more buttons – **Export as PNG**, **Export as PDF** and **Copy image** – and they are in the full-screen view too, so you never have to leave it to take something away. PNG and PDF ask where to save with the normal system dialog; cancelling that dialog does nothing at all and says nothing. Copy puts the actual picture on the clipboard, not a file reference, so it pastes into Slack, Word, Figma or a chat window as an image. **What you get is a conversion of the file, not a snapshot of what is on screen.** Zooming in first does not produce a zoomed-in export; panning does not crop it. The file is read again from disk at the moment you click, so if an agent rewrote the diagram a second ago you export the new one, not the one the tab happens to be showing. Each format keeps what it is good at: an SVG is drawn at twice its natural size so the PNG is not soft, an animated GIF exports its first frame, an icon file exports its largest size, and a picture with transparency keeps that transparency in a PNG while the PDF and the clipboard copy get a white background behind them (clipboards on Windows cannot carry transparency, and a "transparent" paste would come out black). Erfana never quietly shrinks an export to make it fit – if a picture is too large for one PDF page, or simply too large to render, it tells you and writes nothing rather than handing you a smaller file than you asked for. It also refuses to save over the image you are exporting. Very large files (over 50 MB) are out of scope. The toolbar now scrolls sideways when the panel is too narrow for all eight controls, so nothing gets clipped off the right-hand edge. See [UI components § Image Viewer Panel](ui-components.md#image-viewer-panel).

### Fixed

- **An image or SVG open in its own tab now updates itself when the file changes on disk** ([#70](https://github.com/qodeca/erfana/issues/70)) – a picture opened from the project tree kept showing the version it was opened with for as long as the tab stayed open. An agent could rewrite a diagram ten times and the tab never moved; closing and reopening it was the only way to see the new drawing. Markdown files, their live preview and Mermaid diagrams were never affected by *this* fault – it was the image viewer alone, which read the file once when it opened and then never listened for changes again. That is not an all-clear for pictures inside a Markdown document: an image *referenced from* Markdown is reported not to render in the live preview at all, and not to refresh when the file changes on disk. That is tracked separately as [#71](https://github.com/qodeca/erfana/issues/71) and is not addressed here. Three separate faults had to be fixed before the symptom went away, and two of them affected the Markdown editor too. **The viewer now watches the file.** When the file changes it re-reads it, decodes the new picture off-screen and swaps it in as one step, so there is no blink, no blank frame and no flash of the old picture at the new size; `Reloaded from disk` appears briefly in the toolbar, alongside an `Updated 14:32:05` stamp that stays. **Your zoom and pan survive a refresh** as long as the picture's own width and height did not change – the flagship case of an agent rewriting an SVG while you are zoomed into a corner – and reset to fit only when the picture genuinely changed size. **A file replaced rather than edited no longer kills the watch.** Most agents and design tools save by writing a temporary file and renaming it over the original; where the operating system reports that as a delete, the old watch was left listening to a file that no longer exists, permanently, and every later edit was invisible. Erfana now recognises that pattern and re-attaches to the new file. **Two tabs on one file no longer deafen each other** – closing the first used to stop the watch for the second. Deleting the file now shows a banner that says so, keeps the last picture on screen instead of blanking it, renames the tab `icon.svg (deleted)`, and offers **Reload** to pick the file back up if you restore it. If auto-refresh is unavailable for any reason – the app-wide 100-file watch limit, or a watcher fault – the toolbar says `Auto-refresh unavailable` rather than quietly showing stale bytes, and the same **Reload** button is the way back. Clicking an image path in the terminal now opens the image viewer as well, instead of opening a binary file in the text editor.
- **Two file-reading channels no longer follow a symlink out of the open project** ([#70](https://github.com/qodeca/erfana/issues/70)) – the boundary check on `file:readFile` and the image read channel (`file:readImage`, which replaced `file:readAsBase64`) compared path text only. Text comparison collapses `..` but does not follow a link, so a symlink planted inside the project pointed at a file outside it and the file was read anyway. Both channels now also compare the fully resolved paths (`fs.realpath` of the file and of the project root). This mattered more after the fix above: a read the user triggers once became a read that repeats on every change to the file. `file:getStats` keeps a deliberate exemption – it has to keep serving the paths you pick in the native file dialog, which are outside the project by definition – and rejects only a path that looks in-project but resolves out of it. See [`docs/api-services.md`](api-services.md#path-confinement-for-the-file-read-ipc-handlers).

### Internal

- **The build now refuses to ship a preload script that cannot load** ([#73](https://github.com/qodeca/erfana/issues/73)) – Erfana's windows each get their own small privileged bridge, and there are three of them now that the image export has a hidden window of its own. If two of those bridges happen to import the same file, the bundler helpfully factors it out into a shared piece — and a sandboxed bridge has no way to load a shared piece, so it fails at startup. The symptom is the worst kind: every test passes, and the packaged app opens on the crash-recovery screen with nothing working. The build now checks for that shape and stops, with a message saying what to do instead. Also of note for anyone building from source: the window layer now has two HTML entry points rather than one, so both need to be verified in a packaged build, not only in development. See [`docs/build/preload.md`](build/preload.md).
- **A picture that has not really changed is no longer re-read, re-encoded and re-sent** ([#70](https://github.com/qodeca/erfana/issues/70)) – now that the viewer re-reads on every disk change, the expensive half of that round trip is turning the file into text the window can display: for a large asset it locks up the whole app – terminal included – for roughly a tenth to a fifth of a second, every time. The viewer now tells the main process which version of the file it is already showing, and an unchanged file is answered with "you are current" instead of tens of megabytes of data. Nothing is decoded, nothing is repainted, and the toolbar deliberately says nothing – announcing a reload that changed nothing would be misleading. The version is recorded together with the picture it belongs to, so if a picture fails to display and the viewer falls back to the previous one, the next change is still noticed. The old unconditional read channel (`file:readAsBase64`) has been removed rather than left behind as a second way in.
- **The image viewer was split into a folder** ([#70](https://github.com/qodeca/erfana/issues/70)) – the 901-line `ImageViewerPanel.tsx` is now a panel shell plus a toolbar, a banner, three hooks (`useImageSource`, `useImageViewerTransform`, `useFullScreenOverlay`) and a pure status module, under `src/renderer/src/components/Panels/ImageViewerPanel/`. Characterization tests were written against the old component first and kept passing untouched through the move. Two new shared pieces came out of the same change: `src/renderer/src/hooks/useFileChangeSubscription.ts`, a read-only watch subscription deliberately separate from the text-coupled `useFileWatcher`, and `src/renderer/src/hooks/fileWatchSlot.ts`, a serialised acquire/release slot that both watcher hooks hold – it removes three ways a subscription could go wrong (starting twice, stopping something it never started, and a stop overtaking its own start). Panel opening now goes through one router, `src/renderer/src/utils/openFileInPanel.ts`, with an ESLint rule that stops panel ids being hand-built anywhere else. See [`docs/file-watching/README.md`](file-watching/README.md#single-file-watch-internals-70).
- **The atomic-save re-arm is dormant on macOS, and that is measured rather than assumed** ([#70](https://github.com/qodeca/erfana/issues/70)) – on macOS with fsevents, chokidar v3 reports `mv tmp target` over a watched file as a `change`, not an `unlink`, and the watch keeps working afterwards. The re-arm branch therefore never runs there; the ordinary debounced change path carries the fix, and the branch matters only on platforms that do report `unlink`. `src/main/services/watcher/singleFileWatch.rename.integration.test.ts` drives the real production watcher against a real rename and asserts that disjunction, so the branch cannot be deleted as dead code and a platform that reports `change` and then goes deaf fails loudly. Watch options moved to `watcher/singleFileWatch.ts` (single-file watches no longer follow symlinks), the unlink branch to `watcher/atomicRearm.ts`, the send loop to `watcher/watchNotifier.ts`, and per-window subscription counting to `watcher/SubscriberCounter.ts`.
- **Three shellcheck findings in the CI workflow files were fixed** – no change to anything the app ships or does. `release.yml` now hashes the release assets with `sha256sum -- *` rather than `sha256sum *`, so a filename beginning with a dash can no longer be mistaken for a command-line option; the recorded names stay bare, which both the release-time verification and the end-user `sha256sum -c` recipe depend on (the `./*` form the linter also suggests would have prefixed every entry with `./` and broken both). In `whisper-binaries.yml`, an unused `IDENTITY` variable was dropped from the macOS code-signing step – that step signs by Team ID and never read it – and the Windows round-trip check now looks for the expected DLLs with a glob instead of `ls | grep`. See [`docs/build/release.md`](build/release.md) and [`docs/ci.md`](ci.md).

## 0.17.2

*Released 2026-08-12. Tag `v0.17.2`.*

### Fixed

- **Erfana no longer crashes to a black window when you open a very large project** ([#60](https://github.com/qodeca/erfana/issues/60)) – opening a project with roughly 100 000 files or more (reported on a 174 000-item folder held on an external drive) turned the whole window black: no message, nothing to click, force-quit the only way out. Building the project tree's internal flat list ran into a hard limit in the JavaScript engine on how many items may be handed to a single function call, and the resulting error tore down the entire interface. That list is now built one item at a time, so the limit cannot be reached – checked against a 200 000-node test tree. In case something else ever fails the same way, the damage is now contained instead of taking the window with it: a failure inside the project tree leaves the rest of the app running and shows "Project tree unavailable" in the sidebar with a Reload button, and a failure anywhere else shows a recovery screen offering **Restart Erfana**, **Copy error details** and **Open logs folder**. Restarting always reopens Erfana on the welcome screen, never the project that just crashed. Crashes and hangs are also written to the log file now – including the case where the window dies outright and no in-app message is possible – so a report can carry evidence rather than a description. Very large projects still open **slowly** (that work is tracked separately as #149/#150); they no longer open fatally. See [`docs/design/design-issue-60.md`](design/design-issue-60.md) and [UI components § Error containment](ui-components.md#error-containment).

### Internal

- **The two Claude Code automation workflows were removed from CI** – `claude-code-review.yml` (automated pull-request review) and `claude.yml` (the `@claude` mention responder) both authenticate through the Claude Code GitHub App, which is not installed on this repository, so every run failed at token exchange and produced nothing but a red tick in the Actions tab. Neither was a branch-protection required check, so nothing is blocked by their absence and no other workflow depended on them. To reinstate: restore the two files from git history and install the [Claude Code GitHub App](https://github.com/apps/claude) on the repository. See [`docs/ci.md`](ci.md).

## 0.17.1

*Released 2026-08-10. Tag `v0.17.1`.*

### Fixed

- **DOCX export no longer lets an exported document trigger a network request from your machine** ([#57](https://github.com/qodeca/erfana/issues/57)) – `@turbodocx/html-to-docx`, the library Erfana uses to build the `.docx` file, fetches any `http(s)` image source it finds during conversion. A document containing `<img src="http://internal-host/...">` — pasted content or an imported file — turned into a server-side request from the main process (SSRF) the moment you clicked **Export to Word**. Erfana now parses the HTML with a real parser (parse5), not a tag regex a crafted attribute could desynchronize, and removes every `<img>`/`<source>` whose `src` or `srcset` names an `http`, `https`, `file`, `ftp`, or protocol-relative address before the library ever sees it; empty, `data:`, and relative sources — including the PNGs Mermaid diagrams already export as — are left untouched, and a toast reports how many images were removed. Conversion itself also now runs in a separate, killable process rather than in-thread, so a malformed image that used to be able to hang the export can no longer freeze the app or exhaust main-process memory. See [`docs/security.md`](security.md#document-export-security) and [`docs/editor/export.md`](editor/export.md#docx-export).
- **Document import now rejects oversized files outright instead of partway through parsing** ([#57](https://github.com/qodeca/erfana/issues/57)) – files above 250 MB are now rejected before any converter runs, closing a gap where a very large PDF or Office file could tie up memory mid-parse. This is a blocking, non-configurable security limit, separate from the existing 50 MB non-blocking size *warning*. See [`docs/security.md`](security.md#document-import-security).
- **The build-time guard that keeps the project's files out of the shipped app now covers two more ways they could slip in** ([#55](https://github.com/qodeca/erfana/issues/55)) – the [#43](https://github.com/qodeca/erfana/issues/43) fix above checks only the main application folder. Two neighbouring copy mechanisms could still place content *beside* or *above* it — for example a stray `from: '.'` or a build-command override that copies the whole repository one directory over — and nothing checked those spots. The build now inspects them too, refusing to sign an app that carries repository or secret-looking files there, and it reads the effective build configuration (including per-platform command-line overrides such as the Windows build uses) rather than only the file on disk, so the same slip cannot sneak through on one platform. A matching check runs on every push, before a build is even attempted. One part of the check — the exhaustive list of expected files sitting beside the app — is enforced strictly on macOS but only warns on Windows for now, until a real Windows build has been measured to confirm the list; the leak-detection itself is strict on both. No change to what the app does or ships; this only tightens the build-time safety net. See [`docs/build/fuses.md`](build/fuses.md#extra-content-destinations--extrafiles--extraresources-issue-55).
- **The installed app no longer carries a copy of the project's own source tree** ([#43](https://github.com/qodeca/erfana/issues/43)) – every file in the repository – documentation, tests, specs, build configuration, and any folders that only ever existed on the machine doing the build – was being copied into the shipped application, uncompressed and readable by anyone who opened the bundle. The packaging configuration listed only what to *leave out*, and the packager reads a list of nothing-but-exclusions as "include everything", so the exclusions were being applied to a sweep of the whole project rather than to a chosen set. It now lists what to include: the built application code and its manifest, nothing else. Measured on a local macOS build, the app bundle drops from 612 MB to 581 MB and the application directory inside it from 350 MB to 319 MB, with 23 top-level items reduced to 3. A stray `.env` or `.npmrc` is now also stripped from anywhere in the tree, including inside bundled dependencies, where the previous rules did not reach. Two guards keep it that way: the wiring and allowlist shape are checked in the required test suite on every push, and the build itself refuses to sign an app whose contents do not match the list. The published `v0.16.3` artifact was audited to bound what earlier releases actually shipped — tracked development files only, **no credentials and no machine-local content**, because releases build from a clean checkout; see [`SECURITY.md`](../SECURITY.md#packaging-scope-of-releases-before-the-43-fix-audited). See [`docs/build/electron-builder.md`](build/electron-builder.md#files-allowlist).
- **The context meter no longer freezes the app after a long Claude Code session compacts** ([#47](https://github.com/qodeca/erfana/issues/47)) – once a Claude Code session grew large enough to auto-compact, the terminal's context meter could stall the whole app in bursts – the editor, the project tree and everything else briefly stopped responding, roughly once a second, for as long as the session stayed compacted. To find your latest usage the meter reads the tail of Claude Code's transcript file; when a compaction pushes that entry out of the last 256 KB, the meter used to fall back to reading and parsing the *entire* transcript – up to ~18.8 MB – and it did so on every refresh, on the thread that keeps the app responsive. That fallback read is now capped at 2 MB and remembered per file version, so it runs at most once until the transcript actually changes instead of on every refresh; the meter keeps showing your last known usage rather than blanking, and it can no longer block the interface regardless of transcript size. See [`docs/designs/47-context-meter-freeze.md`](designs/47-context-meter-freeze.md).

## 0.17.0

*Released 2026-08-08. Tag `v0.17.0`.*

### Added

- **macOS Screen Recording permission – grant-and-relaunch flow** – when a screenshot capture is denied by macOS, Erfana now shows `ScreenPermissionDialog` instead of a dead-end error toast. It offers *Open settings* (jumps straight to the Screen Recording privacy pane) and *Relaunch* (macOS applies a fresh grant only to a newly-launched process, so restarting is genuinely required). The capture is always attempted first and is never gated by a permission pre-check, so a stale TCC record cannot block a user who does have access. Backed by two sender-gated `system:*` IPC channels. Other platforms keep the toast fallback. See [`docs/terminal/README.md`](terminal/README.md).

### Changed

- **The camera preview is no longer mirrored, and mirroring is now your choice per camera** (#42) – the webcam preview used to be flipped horizontally for every camera, so anything with text in it read backwards and the preview never matched the photo you got. **Your preview will look different after this update**: it now shows the camera's true image. If you prefer the selfie-style mirrored view, tick **Mirror preview (saved photo is never mirrored)** below the preview; the setting is remembered separately for each camera and survives restarts. The saved photo has never been mirrored and still isn't, whichever way the checkbox is set. There is deliberately no automatic front-camera detection – macOS does not tell apps which way a camera faces, so guessing would get it wrong for some people every time.
- **The camera preview now shows the whole photo you are about to take** (#42) – the preview was cropped to a 4:3 window, so parts of the picture that were still captured were hidden while you framed the shot. It is now a 16:9 box that fits the entire frame. Black bars may appear at the sides or top when the camera's own shape differs – an intentional trade for showing everything.

### Fixed

- **A camera plugged in while Erfana is running now shows up reliably** ([#52](https://github.com/qodeca/erfana/pull/52)) – Erfana waits 300 ms after the system reports a device change before rescanning, so that plugging things in quickly does not cause a storm of activity. That pending rescan could be thrown away: if the screen updated during the wait – opening the capture dialog, starting a preview, switching cameras – the scan was cancelled and never rescheduled. The camera then stayed missing from the list, with no error and nothing in the logs, until the dialog was reopened or **Refresh** was clicked, which made it look intermittent. The device-change listener is now registered once for the life of the terminal panel rather than being rebuilt on every render, so it can no longer cancel its own pending rescan. Reported against a Lumens USB document camera on macOS.
- **Pressing Enter on a dialog's Cancel button no longer takes a photo** (#42) – in the camera dialog Enter was captured by the dialog itself and always fired the shutter, even when Cancel had keyboard focus. Enter now does what the focused control says; Capture still fires on Enter or Space while the Capture button is focused, and keyboard focus lands on Capture as soon as the camera is ready.
- **Dialogs are easier to use with a keyboard and a screen reader** (#42) – Tab now cycles inside the camera, document-import and transcription dialogs instead of walking off into the page behind them, and focus is returned to a usable control when the one you were on becomes unavailable (a button greying out no longer strands you). Camera errors and the "Starting camera…" state are announced to screen readers. The same change closed a hard keyboard trap: pressing **Cmd+Q** during a transcription put the quit confirmation on top of the still-open transcription dialog, and the dialog underneath read "focus is in the dialog above me" as "focus escaped to the page", swallowed every Tab and dragged focus back down to its own first control – so neither **Quit** nor **Cancel** could be reached by keyboard at all. Dialogs now agree on which one of them is in front (highest `zIndex` wins; registration order only breaks a tie) and only that one acts on the keystroke.
- **Confirm buttons in dialogs are now legible** (#42) – the label on the violet primary button (Capture, and every other confirm/submit button in a dialog) was too pale against its own background to meet the WCAG AA contrast minimum; it is now dark, taking the contrast from 2.2:1 to 8.4:1. Checkboxes, scrollbars and other controls drawn by the OS now also follow Erfana's dark theme instead of rendering light.
- **Search bar no longer applies stale results after closing** – a pending debounced search survived unmount and wrote into the global search store, so results from a closed find bar could land on whatever was shown next. The debounce helper now exposes `cancel()`, which the search bar calls on unmount. Also removes an intermittent CI test failure.
- **The Claude Code context meter now scales correctly for Opus 5, Sonnet 5 and Fable 5** ([#41](https://github.com/qodeca/erfana/issues/41)) – the terminal status bar showed a 200k context window for models that actually run 1M, so the used percentage climbed about five times too fast and the bar turned red while most of the window was still free. Three separate pieces of code each read the model name with their own pattern, and all three assumed a name shaped like `claude-opus-4-8`; current names drop the last number (`claude-opus-5`), and each one then broke differently: the window detector mis-sized a 1M model to 200k, the name renderer showed the raw identifier instead of "Opus 5", and the `/model` parser matched the `[1m]` marker, stripped it, and then rejected what was left – silently discarding the model you had just selected. They now share a single parser and one capability table, verified 2026-08-07 against Anthropic's published model and Claude Code documentation, so the label and the window can no longer disagree. The table also corrects two entries in the other direction: at the Claude Code layer **Opus 4.6 and Sonnet 4.6 are 200k**, not 1M. Those are the metered defaults rather than ceilings – Opus 4.6 reaches 1M where your plan includes extended context (automatic on Max, Team and Enterprise) and Sonnet 4.6 reaches it with usage credits, which no plan includes by default, Max included – so Erfana shows 200k for both whatever you are entitled to, and re-scales the meter once your real usage crosses 200k. Because the real window also depends on your plan and your provider (Bedrock, Google Cloud and Foundry cap Opus at 200k), a 1M badge resting on the table alone is now marked `(inferred)` in the hover tooltip, announced as such to screen readers, and re-checked on every update instead of sticking for the session. Signals are applied first-match rather than blended: real usage above 200k always wins, then an explicit `/model` selection (which can force either 1M or 200k), then the table, then a `[1m]` model in your `~/.claude/settings.json`. See [the design note](./designs/41-model-capability-registry.md).

### Internal

- **The two hand-rolled dialog focus traps were replaced by one in `BaseDialog`** (#42) – `DocumentImportDialog` and `TranscriptionDialog` each carried their own local `handleFocusTrap`. Both were deleted in favour of BaseDialog's opt-in `trapFocus` prop, so Tab cycling, recovery of focus that has already escaped, and the `focusout` rescue for a control that becomes disabled now have exactly one implementation. New dialogs pass the prop rather than writing their own.
- **Guards against the capability table going stale or drifting from the docs** ([#41](https://github.com/qodeca/erfana/issues/41)) – the table carries a `CAPABILITIES_VERIFIED_ON` stamp with a unit test that fails once it is more than 180 days old, and a hand-derived oracle table plus document-parity and key-set guards keep the design note, the shipped table and the tests from disagreeing silently. The spawn-environment rule that forced 200k for a capped deployment was withdrawn in the same change: three of its four signals were unreachable because `TerminalService` strips `CLAUDE_CODE_*` from spawned terminals, the surviving one was a routing fact rather than a capacity fact, and the rule outranked explicit user configuration. A narrowed, settings-based replacement is tracked as [#48](https://github.com/qodeca/erfana/issues/48).

## 0.16.3

*First public open-source release of Erfana. Tag [`v0.16.3`](https://github.com/qodeca/erfana/releases/tag/v0.16.3). (v0.16.1 and v0.16.2 were tagged but never published — Windows code-signing failures: first an Azure cert secret mismatch, then a legacy-encrypted (RC2/3DES) signing PFX that the CI/Node OpenSSL 3.x toolchain rejects. Resolved by re-exporting the PFX with AES-256 (PBES2). See [`docs/release-incidents/`](release-incidents/index.md).)*

### Changed

- **Erfana is now open source under `GPL-3.0-only`** *(2026-06-16)* – the project was relicensed from its prior proprietary ("All rights reserved") terms and published publicly at [github.com/qodeca/erfana](https://github.com/qodeca/erfana). The relicensing act of record is in [`COPYRIGHT`](../COPYRIGHT). Per-file licensing follows the [REUSE](https://reuse.software) specification (SPDX headers on every source file, `REUSE.toml`, `LICENSES/`); bundled third-party notices are in [`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md). Added community-health files (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CLA.md`, `TRADEMARKS.md`) and a secret-scan + license-compliance CI gate. The "Erfana"/"Qodeca" names and logos remain Qodeca trademarks — forks must rebrand. Contributions require the project CLA, which preserves Qodeca's dual-licensing option. `package.json` keeps `"private": true` as a desktop-app publish guard (not a license statement).

## 0.16.0 — never released

> **Accuracy correction (2026-08-07).** This section previously read
> "*Released 2026-06-14. Tag `v0.16.0`.*" That is wrong and is corrected rather than
> removed, because the changes below are real and shipped. **No `v0.16.0` tag was ever
> created** (verified against `git tag -l` and `gh release list`: the repository holds only
> `v0.16.1`, `v0.16.2` and `v0.16.3`, of which just `v0.16.3` is published — `v0.16.1` and
> `v0.16.2` are drafts burned by Windows signing failures). 2026-06-14 was the date the
> release was prepared, not a publish date. Everything listed below first reached users in
> **v0.16.3**. The heading is kept at `0.16.0` so the version's own entry stays findable.

### Added

- **Claude Code context status bar now works on Windows** (#217) – the per-terminal status bar (friendly model name, 200k/1M context-window badge, used-percentage meter) that shipped for macOS is now available on Windows. A native `WinClaudeProcessDetector` walks the PTY child-process tree, a shared `AbstractClaudeProcessDetector` base unifies the macOS and Windows detectors, and `encodeCwd` is platform-branched for Windows transcript paths. Context usage now also resets correctly after a `/compact` and tracks mid-session model switches.
- **New home-view background** – the central welcome screen now shows a branded background image, with the controls (Import button, Recent Projects) grouped in a dimmed bottom-right panel and the live app version in the heading. The image is scoped to the welcome view only, never the shared panel background.

### Fixed

- **Preview "Modify"/"Ask" now act on the text you selected, not the frontmatter** – in a file with YAML frontmatter, selecting body text in Preview and choosing Modify or Ask previously sent the document's first frontmatter line instead of your selection. Body element line numbers were tracked relative to the frontmatter-stripped content while the source was read with full-file line numbers; they are now offset to real file lines. This also corrects a latent editor↔preview scroll-sync drift by the frontmatter height.
- **Claude status bar cross-platform hardening** – the Windows detector uses the `win32` path namespace so its tests pass on Linux CI, and transcript parsing is bounded by a parse-attempt cap tied to the locator's candidate limit.
- **No spurious error on quit** – a benign `chokidar` timer race during shutdown is now guarded instead of surfacing as an error.

### Internal

- Claude status-bar documentation synced with the merged #217 work; the home-view background and `.home-bg` scoping rule are documented; the macOS welcome visual-regression baseline was regenerated for the new home view.

## 0.15.1

*Released 2026-06-10. Tag `v0.15.1`.*

### Fixed

- **Project Tree git-status badges update automatically after editing a file** (#241) – previously the `M` indicator only appeared after pressing `Cmd/Ctrl+Alt+R` because `DirectoryWatcherService` listened only to create / delete / rename events, never to chokidar `change`. Monaco autosaves (in-place `fs.writeFile`, same inode) emit `change`, which was silently dropped. The watcher now broadcasts `change` events through the existing throttle / coalesce / IPC pipeline; `.git/` internals are filtered so `GitWatcherService` stays the sole publisher for git-state changes. End-to-end latency is roughly 2.5–3 s on macOS (2 s autosave debounce + ~750 ms pipeline). A 250 ms debounce added to `useDirectoryWatcher` absorbs multi-file write storms (`prettier --write`, snapshot updates, AI multi-file edits) into one tree re-list.
- **Parent-folder git-status dot now shows on Windows** (#237) – a folder's colored git-status indicator in the project tree was missing on Windows because the parent-path lookup only recognised the POSIX `/` separator; it now also recognises the Windows `\` separator, with no change to macOS/Linux behaviour.

## 0.15.0

*Released 2026-06-09. Tag `v0.15.0`.*

### Multi-instance reliability

- **Project locks are now tamper-resistant and self-healing** – when the same project is open in more than one Erfana window, the lock file that coordinates them is signed (HMAC) so a stale or forged lock from another process on the same machine can no longer hijack a project. Each live instance now refreshes a heartbeat, so a crashed or force-quit window's lock is reclaimed automatically once it goes quiet (after 30s) instead of leaving the project blocked. Locks also survive sleep/wake correctly – every held lock is refreshed when the machine resumes, preventing another instance from stealing it after a long sleep. Several edge cases were hardened along the way: symlinked lock directories and lock paths are refused (junction-redirect / CVE-2025-68146 class), interrupted lock writes leave no orphaned temp files behind, and the Windows process-liveness check now fails closed on unknown errors rather than assuming a process is dead.

### Fixed

- **Text is selectable again across the app** (#211) – you can now copy error messages, file paths, status data, dialog text, toast messages, settings descriptions, and chat content, and the markdown-preview prompt-template context menu (Explain / Modify / Ask / Visualize) works again. A dockview panel-chrome style had been disabling selection on nested content; the per-surface rule is now captured in the [Text selection policy](./ui-style-guide.md#text-selection-policy) so future components stay selectable by default where it matters.

### Internal

- **Text-selection policy lives in one file** (#228) – the `user-select: text` override previously repeated across 15 component CSS files (a follow-up to #211). It is now declared once in `src/renderer/src/styles/utilities.css` for 20 selectors, and the cross-cutting audit test (`src/renderer/src/styles/userSelect.audit.test.ts`) reads from the central file. Two CSS-module surfaces (`.metadataItem`, `.errorMessage` in `ImageViewerPanel.module.css`) keep their declarations in-place because build-time class-name hashing prevents the central selector from matching them at runtime; this is documented in [Text selection policy](./ui-style-guide.md#text-selection-policy).
- **E2E terminal-driven tests no longer race the user's `.zshrc`** — `TerminalService`'s POSIX bootstrap pattern now honors `ERFANA_E2E_FAST_SHELL=1` and execs into `/bin/sh -i` instead of `exec -l "$SHELL" -i` when set. Removes the dependency on individual contributors' shell-init speed (a heavy `.zshrc` sourcing >1500 ms used to leave `e2e/directory-watcher.e2e.ts` consistently timing out on some dev machines while passing on CI). `e2e/directory-watcher.e2e.ts` opts in; production behaviour and other tests are unchanged. See [docs/known-issues.md § E2E terminal-driven tests sensitive to user's shell init speed](./known-issues.md#e2e-terminal-driven-tests-sensitive-to-users-shell-init-speed).

## 0.14.0

*Released 2026-06-06. Tag `v0.14.0`.*

### Terminal font

- **The terminal now looks the same on every platform** — Erfana bundles the Cascadia Mono font and uses it in the terminal. Previously the terminal asked for Apple's SF Mono, which only exists on macOS; on Windows it fell back to the dated Courier New. Cascadia Mono (a clean, SF Mono–like programming font) now ships inside the app, so the Windows terminal matches the polished Mac look and renders identically across machines. The font is loaded before the terminal opens so text stays crisply aligned from the first frame.

### Window title

- **The window title now shows the open project and the app version** — with no project open the title reads `ERFANA v{version}`; with a project open it reads `{Project Name} | ERFANA v{version}`, on both Windows and macOS. Previously the title was static and the version never actually showed (the renderer's document title silently overrode the one the app set). The title is now driven from the renderer so it updates as you open and close projects.

### Fixed

- **Project panel header shows the folder name on Windows** — the sidebar header showed the full path (e.g. `C:\Users\…\erfana`) on Windows because the name was derived with a POSIX-only path split. It now shows just the folder name (e.g. `erfana`), matching macOS.
- **More reliable `git status` on Windows** — the project tree no longer reports phantom "modified" files caused by CRLF line-ending handling differences between `isomorphic-git` and the user's `git config core.autocrlf` setting. The git-status worker now prefers the native `git` binary on Windows (and falls back to `isomorphic-git` only when `git` is not on PATH) and detects when a folder becomes or stops being a git repository.
- **Accurate Claude Code context bar on launch** (#225) — a freshly launched `claude` session could briefly display the context percentage of a *previous* session that ran in the same terminal directory. Transcript selection is now floored by the running `claude` process's start time, so a fresh session hides the bar until it writes its own first turn instead of mis-reporting the prior session; `claude --continue` still resolves correctly because resume bumps the reused transcript's mtime above the floor.

## 0.13.0

*Released 2026-06-05. Tag `v0.13.0`.*

### Terminal Claude Code context status bar (macOS)

- **See your Claude Code context usage right in the terminal** (#216) — when you run Claude Code (`claude`) in a terminal panel, a thin status bar appears at the bottom of that panel showing the model (e.g. "Opus 4.8"), a badge for the context-window size (200k or 1M), and how much of the window you've used as a percentage. A progress bar shifts from green to orange to red as you fill the window, so you can see at a glance how much room is left. Hover the bar to see exact token counts (e.g. "84k / 200k"). The bar is display-only and shows only while Claude Code is actively running in that panel; it disappears when Claude exits. Erfana reads this purely from Claude Code's own session files and **never changes your Claude Code configuration**. If anything can't be read, the bar quietly hides rather than showing stale or wrong numbers. **macOS only in this version** — Windows support is planned as a follow-up.

### Fixed

- **Reliable native build on hardened Windows 11** — a fresh `npm ci` now rebuilds the `node-pty` terminal backend successfully on Windows 11 machines with the hardened `NoDefaultCurrentDirectoryInExePath` setting, fixing an install failure that blocked building Erfana from a clean checkout on those systems. See [docs/build/windows.md](./build/windows.md#node-pty-build-failures-on-windows-11).

### Windows enablement (Phase 6)

- **Filenames are no longer written to log files** (#167) — when a file or folder name is rejected as invalid, the on-screen message still shows the name you typed, but Erfana's local log files now record `[redacted-filename]` instead, keeping anything sensitive you might paste into a filename field out of the logs.
- **Internal** — renderer platform detection now routes through a single `window.api.utils.getPlatform()` bridge (retiring scattered `navigator.platform` / `process.platform` checks), the OneDrive and antivirus file-watching contention case is documented in [known issues](./known-issues.md#windows-specific-issues), and an advisory `windows-latest` CI job (typecheck + main-process tests) was added. The camera and project-lock services were verified working on Windows with no code change. See [docs/windows/implementation-plan.md](./windows/implementation-plan.md).

## 0.12.0

*Released 2026-06-04. Tag `v0.12.0`.*

### Windows screenshot capture

- **Terminal screenshot capture now works on Windows** (#164, PR #208) — the terminal screenshot button previously worked only on macOS (native `screencapture`). Windows now captures through Electron's `desktopCapturer`: full-screen and per-window capture use an in-app window picker with live thumbnails, and area capture uses a frameless transparent overlay you drag to select a region (with a keyboard-driven selection mode for accessibility). The captured image path is pasted into the terminal exactly as on macOS, and macOS behaviour is unchanged. This completes Windows enablement Phase 3. (Corrected 2026-08-07: the original entry said "Windows and Linux". `ScreenshotService` routes `darwin` to the native capturer and `win32` to `desktopCapturer`; every other platform gets `UnsupportedCapturer`, and Linux distribution had already been dropped in v0.11.x.)

### Fixes

- **Text selection restored in the markdown preview** — selecting text in the rendered preview pane had stopped inheriting the editor's selection styling; normal click-drag text selection works again in the preview.
- **Large projects no longer risk file-descriptor exhaustion** — pinned the file watcher's `chokidar` dependency to exact v3 (3.6.0). chokidar v4 opens one file descriptor per watched file, which could exhaust the OS limit on large folders (>~10k files) and crash PDF/DOCX export at sandbox init. v3 uses FSEvents (near-zero descriptors per file). Added CI guards to prevent an accidental v4 bump.

### Internal

- **CI on Node 24** — GitHub Actions runners and the project toolchain moved to Node 24.
- **Test-infrastructure hardening** — Playwright, vitest, and ESLint configuration tightened; Windows visual-regression baselines added for the five core UI scenes; POSIX-only fuse-contract tests skip on Windows hosts; the deprecated vitest `basic` reporter replaced with `dot` in `test:ci`; the e2e re-enable strategy documented in the workflow header.

## 0.11.2

*Released 2026-06-01. Tag `v0.11.2`.*

### Changes

- **Single build per platform** — macOS now ships only an Apple Silicon (arm64) `.dmg` and Windows only the NSIS installer (`setup.exe`). The Intel (x64) macOS build, the macOS `.zip`, and the Windows portable `.exe` were dropped — auto-update is disabled, so the `.zip` and portable variants served no purpose. **Intel Macs are no longer supported.**
- **Smaller download** — the installed macOS app is roughly 40% smaller (about 1.0 GB → 610 MB) after pruning bundled dependencies and foreign-architecture binaries. No features were removed.
- **Linux builds discontinued** (#206) — Erfana no longer ships Linux packages (AppImage / deb / rpm); releases now target macOS and Windows only. Linux remains usable for local development (`npm run dev`).

### Security

- **Patched axios and fast-uri** — updated `axios` to 1.16.1 (GHSA-pjwm-pj3p-43mv, GHSA-898c-q2cr-xwhg, GHSA-654m-c8p4-x5fp, GHSA-35jp-ww65-95wh: proxy bypass, prototype-pollution DoS / header injection, MITM) and `fast-uri` to 3.1.2 (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc: path traversal, host confusion). Both are transitive dependencies (document import/export, settings storage); production `npm audit` is now clean.

### Fixes

- **Copy and paste work again in the editor** (#203) — Electron's security sandbox blocked the browser clipboard, so Cmd/Ctrl+C/X/V in the Monaco editor failed silently with a `NotAllowedError`. All clipboard access now goes through a single central service backed by the app's own (main-process) clipboard, so copy, cut, and paste work reliably in the editor, terminal, dialog text fields, the markdown preview, and the file-picker "copy path" action — without weakening the sandbox.

### Internal

- **Central text-clipboard service** (#203) — Every in-scope text surface now routes clipboard read/write through one renderer service (`textClipboard`) over a new async, Zod-validated IPC bridge (`clipboard:readText` / `clipboard:writeText`, `api.clipboard`) to Electron's main-process `clipboard` module. The service is the single transport-error chokepoint (retry-once + debounced, screen-reader-announced error toast); the main handler validates the sender frame and bounds writes to 5 MB. Monaco's keybinding/context-menu overrides extracted to the pure `monacoClipboardCommands.ts`; the per-surface dupes in PromptDialog/FileSystemDialog/ChatBubble were removed (`useTextareaClipboard` rebuilt). Over-limit textarea paste now truncates-and-inserts instead of silently rejecting. The terminal SIGINT-vs-copy decision table (`terminalClipboard.logic.ts`, #28/#122) is unchanged. Project-tree file clipboard (`useClipboardStore`) is out of scope and untouched.
- **Package-size reduction** (#206) — Moved renderer-only libraries (Monaco, Mermaid, xterm, dockview, dnd-kit, markdown plugins) to `devDependencies` so Vite still bundles them but electron-builder no longer copies their raw sources into the packaged app; removed unused runtime dependencies; and pruned foreign-architecture binaries (ffprobe-static, node-pty prebuilds) plus Windows `.pdb` debug files in the `afterPack` hook. ASAR stays disabled (isomorphic-git's transitive `require()` tree). The macOS `Resources/app` payload dropped ~56% (791 MB → 347 MB).
- **CI build workflows aligned with the slim artifact set** — `build_mac.yml` no longer passes `--x64` or uploads `.zip`; `build_win.yml` no longer verifies or uploads the portable `.exe`. Each platform leg now produces and uploads exactly one binary.

## 0.10.1

*Released 2026-05-31. Tag `v0.10.1`.*

### Fixes

- **Restored dragging the editor/terminal divider to resize the panels** — the terminal-maximize feature shipped in v0.10.0 inadvertently broke the sash between the editor and terminal: the divider still highlighted on hover but could not be dragged. Resizing now works again. Added an end-to-end regression test that performs a real sash drag so this can't silently break again.

## 0.10.0

*Released 2026-05-31. Tag `v0.10.0`.*

### Terminal maximize

- **Expand the terminal over the editor** — a new toggle maximizes the terminal panel to cover the editor/tabs area, leaving only the project panel and terminal visible (hide the project panel with Cmd/Ctrl+B for a full-screen terminal). Trigger with **Cmd/Ctrl+Shift+M** or the maximize/restore button in the terminal header. Opening any file automatically restores the editor; maximizing moves focus to the terminal and announces the change to screen readers. Built for heavy terminal work on small screens. Not persisted — every launch and project switch starts collapsed.

### In-app AI prompts apply directly to the document

- **Modify, Visualize, and the diagram prompts now edit your file instead of printing to the terminal** (#202) — the in-app AI prompts previously printed their result into the terminal non-deterministically, forcing manual copy-paste. They now reliably apply the change in place: Modify replaces the selection with the edited version, Visualize inserts the new Mermaid diagram immediately after the selection, and the diagram prompts (Diagram Chat, Bug Report, Change Direction) edit the diagram block directly. Read-only prompts (Explain, Ask) are unchanged.

### Fixes

- **Video transcription works in installed builds** (#199) — packaged builds shipped a single-architecture ffmpeg that failed with ENOENT on video import; ffmpeg is now bundled per-architecture with an integrity-pinned binary, so video audio extraction works on both Intel and Apple Silicon.
- **Quieter, more accurate logging** (#199) — broken markdown links are no longer recorded as errors (~186 false error lines removed per session), and test runs no longer write to the real application log.

## 0.9.6

*Released 2026-05-22. Tag `v0.9.6`.*

### Critical fix – terminal restored on macOS

- **Terminal works again in macOS builds** (`ea3eaf1`) — v0.9.5 shipped with node-pty's `spawn-helper` binary at mode `0644` because `electron-builder` preserves npm-tarball permissions of prebuilt binaries and `npmRebuild: false` skipped the source rebuild that would have produced an executable copy. `pty.fork()` then called `posix_spawnp` against the un-executable helper, returning `EACCES`, so every terminal-spawn in the v0.9.5 macOS DMG failed with `Error: posix_spawnp failed.`. The `afterPack` hook in `scripts/fuses.js` now `chmod 0755`'s every spawn-helper under `node-pty/prebuilds/*/` before code-signing, so the signed bundle carries the executable bit. `requireMatch: true` on the platform-host match fails the build if zero helpers are found, blocking ship of a broken DMG. Dev builds were unaffected because `electron-vite` rebuilds node-pty via `node-gyp` and writes `spawn-helper` at `0755`. Nine new tests in `scripts/fuses.test.mjs` cover happy/idempotent/multi-arch/missing/empty/symlink/EROFS cases. **Anyone on v0.9.5 macOS must upgrade to use the terminal.**

### Internal tooling – `releasing-erfana` skill cleanup

Internal-only refactor of `.claude/skills/releasing-erfana/`. No user-visible changes.

- **Mechanical fixes** — `allowed-tools` corrected (`Agent`→`Task`, `TaskCreate/Update/List`→`TodoWrite`); 3 `Agent(...)` pseudocode call sites replaced with `Task(...)`; frontmatter completed with `capabilities`, `model: opus`, `user-invocable`. Skill is now properly gateable and discoverable.
- **Structure** — `SKILL.md` reduced from 524 to ≤500 lines (Rule #16 BLOCKING resolved); Examples + Anti-patterns + Phase 1.5 git-signing pre-flight extracted to `guides/`. Constants table added as single source of truth for asset count / polling cadence / stuck-leg threshold.
- **Logic hardening** — Phase 3 unknown-signature gate now requires ≥8 words AND `grep -Fc=1` (single-word-bypass closed). Phase 3 polling gains per-leg stuck-leg early warning at 45 min (catches macOS notarize hangs that would otherwise burn the full 88-min ceiling). Phase 4.5 `sha256sums-digest` fetch gains expiry fallback with operator-ack for late audits.
- **Architectural exception** — `release-failure-analyzer` is intentionally project-local; managing-skills Rule #2 exception now formally documented with cookbook-format-contract rationale.
- **Runtime fix** — Phase 5.1 minisign re-verify referenced a nonexistent `$WORK/release.pub`; corrected to `$WORK/release-primary.pub` matching Phase 4.3.

Out of scope (deferred): `release-pretag-runner` agent; CI guard for cookbook-format invariants.

### Project ops

Three operational/metadata shifts on 2026-04-25 with no runtime impact:

- **License switched MIT → proprietary** (`34fd829`) — `LICENSE` now reads "All rights reserved" with Polish governing-law clause; `package.json` set to `license: UNLICENSED` + `private: true`; copyright holder is **Qodeca sp. z o.o.**, not the individual developer. Erfana is a closed-source freemium product; references to MIT in code or docs were corrected. The earlier `d259442` (added MIT `LICENSE`) was reverted by this commit.
- **Workflow display names → Title Case** (`9848451`, preceded by `2bc4ab2`) — Author-controlled GitHub Actions workflows now use Title Case for the `name:` field (e.g. `Quality Checks`, `Build Linux (Reusable)`, `Whisper Binaries (Canary)`). Project-specific override of the global Sentence-case style rule for `name:` fields only; filenames and `workflow_call` references untouched. Documented in `CLAUDE.md` § Continuous integration.
- **E2E Tests workflow disabled** (`997ba65`) — `gh workflow disable "E2E Tests"`. Playwright + Electron tests are unreliable on `macos-latest` hosted runners; the visual suite hangs at `waitForLoadState('domcontentloaded')`. E2E was already excluded from branch-protection required checks, so disabling does not block any merges or releases. Local-only path remains: `npm run test:e2e` / `npm run test:e2e:visual`. Re-enable with `gh workflow enable "E2E Tests"`. Full root-cause analysis in `docs/ci.md` § Visual regression on CI.

### Dependencies

- **`tar` 7.4.0 → 7.5.11** (#170, commit `b0fd9ad`) — Direct prod dep on the Phase 4 trust chain (Whisper macOS tarball extraction in `src/main/utils/tarArchive.ts`). The previous `7.4.0` was npm-marked deprecated with the explicit note "widely publicized security vulnerabilities, fixed in the current version". 7.5.x adds defense-in-depth (sanitize absolute linkpaths, hardlink-ahead-of-target prevention) — additive to the existing reject-symlinks/hardlinks `filter` callback, no API breakage. Upstream license field migrated ISC → BlueOak-1.0.0. Lockfile dedup removed 5 duplicated transitive entries under `node_modules/app-builder-lib/node_modules/{tar,chownr,minipass,minizlib,yallist}`. Pre-existing `WhisperModelManager` chmod-on-win32 test that failed on the original PR run was unrelated and already fixed on develop by `faaee61`; rebase pulled it in. Closes the `tar` rows in #169's Dependabot triage.

### CI

- **`claude-code-review.yml` allows Dependabot** (#192, commit `2c44ff8`) — Added `allowed_bots: 'dependabot'` to the action input. Without it the review job aborted with `Workflow initiated by non-human actor: dependabot` on every Dependabot PR (seen on #170). Scoped to `dependabot` only — the action's [security docs](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md) warn against `'*'` because external Apps could invoke the action with attacker-controlled prompts. Effect takes hold on the next Dependabot PR after merge (GitHub uses base-branch workflow definitions for `pull_request` events).

## 0.9.5

*Released 2026-04-25. Tag `v0.9.5`.*

> *Note added 2026-06-03: Linux distribution references in this entry are historical. The Linux build target was dropped in v0.11.2 (#206). The signed pipeline + signing infrastructure described below remain accurate for macOS + Windows.*

### Multi-platform signed release pipeline (#174)

Single GitHub Actions workflow (`.github/workflows/release.yml`) now produces signed, notarized artifacts for macOS, Windows, and Linux on a single tag push. Replaces the prior tag-only flow used through v0.9.4.

- **Pipeline shape** — `prepare → {build_linux, build_mac, build_win} → finalize → cleanup`. `prepare` asserts a green `checks.yml` run for the tagged commit (lockfile-drift guard). Matrix legs run in parallel on native runners. `finalize` collects sha256s, signs them with minisign, uploads draft assets. `cleanup` deletes the draft if any leg failed (no orphaned half-releases).
- **macOS signing** — Developer ID + notarization via `notarytool submit --wait`, stapled DMG + ZIP. ZIPs are notarized but `xcrun stapler validate` is skipped on them (unsupported by `stapler`). DMG verification uses `spctl -t open` (not `-t install`); standalone `spctl verify` dropped for DMGs in favour of `stapler` + `codesign`.
- **Windows signing** — Azure Trusted Signing via **certificate auth** (X.509 against an app registration). electron-builder 26 doesn't yet support OIDC for Trusted Signing. `signingHashAlgorithms` + `rfc3161TimeStampServer` configured under `win.signtoolOptions`. Signing endpoint trimmed + structural env diagnostics before `electron-builder` invocation.
- **Linux** — AppImage / DEB / RPM ship unsigned; cross-platform authenticity is covered by minisign over `SHA256SUMS`.
- **Trust chain** — `SHA256SUMS` + `SHA256SUMS.minisig` ship with every release. Dual-key minisign acceptance (primary in CI, rotation key offline). Operator verifies via `minisign -V -P <pubkey> -m SHA256SUMS -x SHA256SUMS.minisig`, then re-hashes each asset and diffs against the signed sums.
- **No GitHub Artifact Attestations** — Enterprise-only for private repos. Authenticity is fully covered by minisign + per-platform OS signing.
- **Operator skill** — `.claude/skills/releasing-erfana/` orchestrates pre-flight, tag push, CI polling, cryptographic verification, and the publish checkpoint. The `release-failure-analyzer` agent writes structured incident memos to `docs/release-incidents/` on CI failure, matched against the typed-regex troubleshooting cookbook (`.claude/skills/releasing-erfana/guides/troubleshooting.md`).

### Phase I: branch protection + protected tag ruleset

Both protections went live on `qodeca/erfana`:

- **`main` branch protection** — 6 required status checks, `enforce_admins: true`, no force pushes, no deletions. *(Accuracy correction 2026-08-07, verified via `gh api repos/qodeca/erfana/branches/main/protection`: the required set as shipped at the time was recorded here as `Lint`, `Typecheck`, `Unit tests`, `Build`, `npm audit signatures`, `Release readiness guards` with conversation resolution required. The live set is `Lint`, `Typecheck`, `Unit tests`, `Build`, `License compliance`, `Secret scan` — `npm audit signatures` and `Release readiness guards` run on every push but are **not** required — and `required_conversation_resolution` is `false`. See [`ci.md`](./ci.md).)* **No PR review requirement** (solo-developer workflow — Phase I initially shipped with `count=1`, was reduced to `count=0` during release prep, and was removed entirely on 2026-04-25 after the v0.9.5 release exposed the friction; the release skill verifies the no-PR state at Phase 0.4.5).
- **Protected release tags** (ruleset id `15540259`) — `v*.*.*` semver pattern, signed-tag enforcement, deletion blocked.
- `e2e` is intentionally excluded from required checks until the `macos-latest` hang in `waitForLoadState('domcontentloaded')` is resolved (see `docs/ci.md` § "Visual regression on CI").

### Documentation

- New `docs/build/release.md` — full operator reference (matrix, secrets + rotation calendar, minisign verification, incident response: B.1 federated-cred cleanup, B.2 cert workstation-loss DR, B.3 PFX hygiene).
- New `docs/release-incidents/` — auto-appended incident memos written by the failure analyzer.
- New ADRs under `docs/adrs/` covering the trust-chain decisions inherited from Phase 4 (whisper) and now applied to the release pipeline.

### Notable fixes absorbed from triple review

Three rounds of pre-merge review on the release pipeline produced eight batches of fixes (TIER A blocking, TIER B robustness + cookbook gate, TIER C cleanup, TIER D nits — batches 8.1 through 8.9):

- macOS notarytool JSON parser collapsed to a single-line `python -c` so log-buffer pagination doesn't break parsing.
- Windows env injection moved from YAML macros to `electron-builder --config` CLI to handle empty-string Azure secrets correctly.
- `resign.js` is a no-op on CI (CI signs in-band; resign was a local-dev artefact).
- Stapler retry loop against Apple's ticket-DB lag.
- Multiple Bash-env scoping fixes for OIDC token export paths.
- Pubkey fence markers + spctl correction in the security docs.

Supersedes the tag-only release flow used through v0.9.4. v0.9.5 is the first release cut by the new pipeline.

## 0.9.4

*Released 2026-04-23 (Windows installer; macOS + Linux builds follow on native build hosts). Tag `v0.9.4`.*

> *Note added 2026-06-03: Linux references in this entry are historical. The Linux distribution target was dropped in v0.11.2 (#206).*

### Windows-host test-flake remediation (#172, #173)

Merged 2026-04-23 (`c3cc005`). Clears 5 tests that consistently failed on Windows under Defender + NTFS + V8 GC pressure, while green on Linux/macOS CI. The pool includes one real production perf bug alongside three test-quality issues.

- **`ThrottledWorker` offset-based deque** (production code, closes #173) — Replaced `this.buffer = this.buffer.slice(droppedCount)` with an offset-based deque (`buffer: T[]` + `bufferOffset: number`). Push + eviction + chunk consumption now amortized O(1) via offset advance; periodic compaction reclaims wasted slots (floor = 1024 or ≥50 % waste). 60 k-event stress test: **31 s → 831 ms on Windows (37×)**. Nulls consumed/evicted slots before offset advance so V8 can GC payloads before the next compaction. Production side-effect: directory-watcher bursts during `npm install` / `git checkout` no longer interrupt the Electron main loop via GC sweeps.
- **`FileService.copyItem` MAX_COPY_ATTEMPTS split** — Moved the 1000-conflict boundary test from real-disk I/O (25 s on NTFS + Defender) to mocked-fs in a new `FileService.copyItem.limit.test.ts`. Runs in <200 ms cross-platform. `MAX_COPY_ATTEMPTS` now exported as the source-of-truth constant (test asserts against the import, not a hardcoded `1000` literal).
- **`directory-watcher.e2e.ts` platform-aware budget** — Per-platform timeout: 6000 ms Windows / 2000 ms POSIX. Added `test.describe.configure({ retries: 0 })` so budget regressions can't be masked by a fast retry (same discipline as `visual-regression.e2e.ts`). `test.info().attach('latency-trend', ...)` emits structured JSON for trend tracking.
- **500 ms NFR-001 signal preserved** — New `016-NFR-001: Main-process pipeline latency budget` describe block in `DirectoryWatcherService.pipeline.test.ts` asserts <200 ms virtual latency for single add + atomic-save flows via fake timers. Isolates main-process latency from chokidar + Defender + UI noise.
- **`SettingsOverlay` focus tests** — Replaced wall-clock `waitFor({ timeout: 100 })` with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` + `vi.advanceTimersByTime(11)` wrapped in `act()`. Deterministic cross-platform; ~10× faster.
- **`docs/windows/known-flakes.md`** — New register for Windows-host test flakes with status legend (✅/🟡/🔴/🚫), issue links, remediation-patterns cheat-sheet (fake timers, mocked-fs splits, per-platform e2e budgets, offset-deque), and follow-up audit candidates. Seeded with the 4 fixes + 6 pool entries observed during verification.
- **`.gitattributes`** — Force LF endings on the minisign trust-chain fixtures (`manifest.fixture.json` + `.minisig`) so Windows `core.autocrlf=true` checkouts don't CRLF-corrupt the signed bytes. Makes `verifyManifest.test.ts` pass locally on Windows.

### Local Whisper transcription on macOS + Windows x64 (Phase 4, #165)

Unlock the offline whisper.cpp transcription backend on both macOS and Windows x64. Previously the macOS code path referenced a ggml-org GitHub Release filename that **never existed** (ggml-org publishes Windows zips and a macOS xcframework-for-iOS only — no macOS CLI binary at any recent version), so `Local (whisper.cpp)` had been gated to macOS-only and would 404 on first download. 0.9.4 rebuilds the feature end-to-end by self-hosting signed binaries via a dedicated CI workflow.

**Release streams**
- **App releases** — `v{semver}` tags as usual.
- **Whisper binary releases** — new `whisper-build-<label>-erfana<N>` pre-release tags on the same `qodeca/erfana` repo. Marked pre-release so electron-updater ignores them. Cadence: manual, triggered on whisper.cpp minor bumps (4–6/yr) + security-driven rebuilds.

**Trust chain**
1. **Manifest signature verification** — `manifest.json` at each whisper-build release is minisign Ed25519-signed. Dual embedded pubkeys (primary in CI, rotation offline on hardware token); client accepts either so a single-key compromise is recoverable by ship-patch without a gap. `verifyManifest` supports both legacy Ed25519 (`Ed`) and prehashed BLAKE2b-512 (`ED`) minisign variants.
2. **Artifact SHA-256 pin** — `src/main/services/whisper-assets.ts` pins the release tag + per-platform filename + SHA-256 + per-file sidecar DLL SHAs. Manifest's SHA is cross-checked against the source pin as a source-drift guard.
3. **Pre-spawn re-hash (TOCTOU close)** — `LocalWhisperService.runWhisper()` calls `WhisperModelManager.verifyInstalledBinary()` before every `spawn()`, re-hashing main + all sidecars (<50 ms). Closes the gap where local write access to `{userData}/whisper/bin/` could swap the binary between install-time verification and spawn-time execution.
4. **Monotonic downgrade protection** — `manifest.revisionIndex` enforced against both a source floor (`MIN_REVISION_INDEX`) **and** a persisted `lastSeenRevision` in `{userData}/whisper/.last-seen-revision`. Defeats manifest-replay where an attacker serves a legitimately-signed but superseded manifest.
5. **Pre-flight CPU probe** — `checkCpuSupport()` inspects `os.cpus()[0].model` against pre-SSE4.2 Intel / AMD families (Core 2, Pentium 4/D/III/M, Phenom, Athlon 64, etc.). Fast-fails on unsupported hardware before any download. Runtime SIGILL / STATUS_ILLEGAL_INSTRUCTION detection is the final safety net.
6. **Argv hardening** — `validateAudioPath()` rejects UNC paths, Windows reserved device names (CON/PRN/AUX/NUL/COM1-9/LPT1-9), NTFS alternate-data-stream colons in basenames; canonicalises via `fs.realpath` so ffmpeg/whisper run against the actual target, not a symlink / name-mangled alias.
7. **DLL sideload mitigation** — on Windows, spawn uses `cwd: dirname(binaryPath)` so `LoadLibrary` prefers pinned sidecar DLLs over PATH.
8. **Legacy cruft migration** — one-time cleanup of pre-0.9.4 `{userData}/whisper/bin/` content (broken ggml-org download path left partial artifacts on v0.8.0–v0.9.3 macOS users). Gated by schema-version sentinel.

**CI workflow** — `.github/workflows/whisper-binaries.yml` (`workflow_dispatch` only, gated on `production-signing` GitHub Environment requiring repo-admin approval before any signing secrets are attached). Inputs are regex-validated (`upstream_sha` = 40 lowercase hex, `upstream_label` = `[A-Za-z0-9._-]{1,64}`, `erfana_revision` = non-negative integer) to prevent JSON-injection via crafted inputs. Concurrency group serializes dispatches; `gh release view` pre-check rejects overwrites. macOS: universal build (arm64 + x86_64 via `lipo`), Developer ID signed, notarized (`notarytool submit --wait`), stapled. Windows: x64 MSVC build, **unsigned in 0.9.4** (Phase 5 procures a code-sign cert). Smoke-transcribes a JFK fixture on both platforms before publishing.

**Utility modules** — new `src/main/utils/` helpers with SRP boundaries:
- `zipArchive.ts` / `tarArchive.ts` — split by archive format; both reject traversal, UNC, drive-letter, symlinks, NTFS ADS colons via exported `assertSafeEntry` / tar `filter`.
- `secureDownloader.ts` — hostname allowlist (`github.com`, `huggingface.co`, etc.), `redirect: 'manual'` with 5-hop max, dual Content-Length + live-byte size caps, streaming SHA-256 verification.
- `verifyManifest.ts` — minisign Ed25519 verifier (legacy + prehashed BLAKE2b-512 variants), dual-pubkey acceptance.

**Settings UI**
- Transcription → Backend → "Local (whisper.cpp)" now enabled on macOS (all archs via universal) and Windows x64.
- Windows ARM64 shows a disabled option with ARM64-specific copy directing users to the OpenAI API backend. Upstream whisper.cpp has no ARM64 Windows binary.
- First-use disclosure updated to reflect ~8 MB verified whisper.cpp binary download on first transcription (in addition to the selected model).
- New `api.utils.getArch()` preload helper exposes `process.arch` to the renderer for arch-based gating.

**Known limitations (0.9.4)**
- Windows binary is **unsigned**. SHA-256 + MOTW-strip are the current trust anchors; Phase 5 procures a code-sign cert.
- Windows ARM64 unsupported — OpenAI API only.
- Pre-SSE4.2 CPUs (Intel pre-Haswell / AMD pre-Zen) rejected with `WHISPER_CPU_UNSUPPORTED`.
- Cancellation on Windows is abrupt (TerminateProcess); `${audioPath}.txt` orphans are cleaned up post-close.
- Whisper updates are manual — no in-app auto-update loop. Cadence ~4–6 rebuilds/yr.

See [`docs/build/whisper-binaries.md`](./build/whisper-binaries.md) for the operational runbook, cert-revocation procedures, and upstream-SHA diff-review checklist.

**Test coverage pre-merge** — D12 resolved 2026-04-23: `WhisperModelManager.test.ts` rewritten from scratch against Phase 4 mock boundaries (`downloadToFile`, `verifyManifest`, `zipArchive`, `tarArchive`). 41 tests, 0 skipped, 0 platform-gated. Removes the pre-Phase-4 `describe.skipIf(darwin)` block that hid the entire `ensureBinary()` suite on ubuntu-latest CI. Workspace total: 7852 → 7868 passed, 94 → 78 skipped. See [`docs/windows/deferred-work-phase4.md`](./windows/deferred-work-phase4.md) §D12 for the resolution note.

## 0.9.3 (test build, never publicly released)

> **Status note (2026-04-25):** `v0.9.3` was a test build — the GitHub release artifact and `v0.9.3` git tag were deleted on 2026-04-25 because the binary distribution was a dry-run for the multi-platform release pipeline, not a customer-facing release. The Phase 0–2 codebase work documented below is real and shipped to `develop` on 2026-04-22; **the first publicly released Windows-capable version is v0.9.4** (which contains Phase 0–2 + Phase 4). This entry is preserved for development-history continuity.

### Platform support (Windows)

Phase 0 + Phase 1 + Phase 2 of the Windows enablement roadmap landed on `develop` in the 0.9.3 development cycle (merged from `windows` branch on 2026-04-22). See [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) for canonical status / [`docs/windows/deferred-work.md`](./windows/deferred-work.md) for tracked deferrals (D1–D8). Summary:

- **Phase 0 (#153 closed)** — portable `test:cov` + `prebuild` scripts, `docs/build/windows.md` prerequisites, test path portability (#157), `app.setJumpList` mock (#156), SearchBar focus-trap fix, NSIS installer (316 MB, fused + signed; requires Developer Mode on build host).
- **Phase 1 (#154 closed)** — terminal parity: cmd.exe `@echo off` bootstrap, PowerShell `Set-Location -LiteralPath`, `resolveWindowsShell()` fallback chain, cwd validation deny-list, `WindowsBootstrapBuilder` strategy. 128+ tests (Phase-2 UAT hardening added a dedicated `WindowsTerminalBootstrap.test.ts` with 60 unit tests for the strategy layer).
- **Phase 2 (#155 umbrella closed)** — sub-issues:
  - **#160 git allowlist** — Program Files (64+32), Chocolatey, Scoop paths + `git --version` liveness probe (fixes Windows `fs.access(X_OK)` existence-only degradation).
  - **#161 reserved-filename guard** — shared `validateFilename` util with Unicode bidi-override stripping (Trojan Source defence); wired into `FileService` (throws) + Pdf/DocxService (transform). Friendly error toasts via `INVALID_FILENAME_MARKER` shared constant.
  - **#162 LibreOffice Windows detection** — DependencyDetector probes Program Files paths with `--version` liveness.
  - **#163 long-path activation** — deferred to Phase 6 with promotion criteria recorded inline at `PlatformConfig.ts:194-201` (comment block above `isWindowsLongPath` at `:203`).
- **#159 CameraDialog timer cleanup** + **`flakeGuard.ts`** shared post-teardown error catcher across all 3 vitest projects (no more invisible "Errors 1 error" reports).
- **Phase-2 UAT hardening (2026-04-21 session)** — surfaced and closed during dev-build UAT on the `windows` host:
  - **Windows terminal bootstrap parity (Git Bash support + ConPTY reflow fix).** `resolveWindowsShell` already honored `$SHELL=…\bash.exe`, but the dispatcher had no Git Bash builder — bash fell through to the cmd.exe catch-all and exited with code 126. New `GitBashBootstrapBuilder` emits the POSIX bootstrap and is registered ahead of the cmd.exe fallback. Separately, Windows ConPTY re-emits its screen-buffer contents through the PTY on every resize; the marker handshake cleared xterm.js but not ConPTY's own buffer, so resizes replayed pre-bootstrap `pwd`+marker as a "phantom header". Each of the three builders now appends a post-marker screen-clear (`printf '\033[2J\033[3J\033[H'` / `[Console]::Write([char]27 + '2J' …)` / `cls`) so ConPTY is wiped before the interactive shell takes over. cmd.exe can only clear the viewport (not scrollback) from a bootstrap script – documented caveat in `known-issues.md`.
  - **Log-spam cleanup (two Windows-specific noisy paths).** `TerminalService.resize()` swallows the node-pty `"Cannot resize a pty that has already exited"` race (demotes `!terminal` missing-id path to debug); `GitPollingService.hasIndexChanged()` detects `ENOENT` explicitly and logs once at debug on non-git projects (polling continues so a mid-session `git init` is still caught).
  - **`C:\Program Files (x86)\…` project paths are no longer rejected as unsafe.** `UNSAFE_WINDOWS_CWD_CHARS` dropped `(` and `)` — parens are cmd metacharacters only outside quotes and are literal inside `cd /d "<cwd>"`. 8-entry deny-list still covers every real injection vector.
  - **Test-suite additions** — new `WindowsTerminalBootstrap.test.ts` (60 cases: `canHandle` patterns, dispatch precedence, script shape per builder including the ConPTY clear, escape rules, loosened deny-list, `normalizeWindowsCwd`); fixed `e2e/settings-logs.e2e.ts` path-sep assertion so both Windows `\` and POSIX `/` hosts pass.
- **Security**: `@xmldom/xmldom` resolves at 0.8.13 (transitive via `electron-builder → app-builder-lib → plist@3.1.0` which declares `^0.8.8`; npm resolution picks the highest matching 0.8.x which is 0.8.13). Dev-time only — the DOCX export path goes through `@turbodocx/html-to-docx@1.20.1` which does NOT depend on `@xmldom/xmldom`. Earlier CHANGELOG copy attributing the dep to the DOCX path was incorrect; corrected on 2026-04-21 (Phase 4 B5e audit follow-up). Pre-empts Dependabot PR #145 regardless.
- **Phase 3-6 + deferred-work tracked on GitHub**: [#164 (screenshot parity), #165 (local Whisper Windows binary), #166 (distribution + signing), #167 (polish + CI guard), #168 (D1-D8 meta), #169 (Dependabot triage + 28 security alerts).

Known gaps (deferred to Phases 3–6): screenshots, local Whisper, auto-updater URL, code signing, long-path `\\?\` activation, structured-error IPC serialization (D4).

### Post-Phase-2 hygiene (14576cd, 5a89844)

- **Lint cleanup** — 11 test-file errors resolved (unused consts, `require()`→import, useless regex escapes). `playwright-report/`, `test-results/`, `coverage/` added to `eslint.config.mjs` ignores so E2E artifacts on disk don't poison lint runs.
- **SearchBar flake harden** — first-keystroke-drop under CPU contention. `'executes search'` + `'debounces search'` tests both now gate on observable state via `await waitFor(() => expect(document.activeElement).toBe(input))`. Evidence: 10/10 consecutive runs green.
- **Visual regression determinism** — `visualTestProject` fixture split into outer `mkdtemp('visual-')` parent + fixed inner `visual-project` leaf so tree/terminal labels are deterministic across runs (prevents random suffix from leaking into snapshots). `(b) editor-loaded` masks extended to `TERMINAL_INSTANCE` + `TOAST_CONTAINER`; mask specificity now matches `(c) terminal-open`. Cleanup wrapped in try/finally with `maxRetries:3` rm (Windows EBUSY) + symlink guard on `.e2e-temp`.
- **Lodash CVE (GHSA-1115805/6/9/10)** — pinned `lodash`/`lodash-es` to **exact** `4.18.1` in `package.json` overrides. Production high-severity advisories 7 → 0. Provenance note in [`docs/security.md`](./security.md#dependency-overrides-packagejson) — 4.18.x is a community fork by `magic-akari`, not OpenJS.

---

## 0.9.2

### Fixed
- **App crash after ~42 minutes of use** – The git status worker thread accumulated isomorphic-git internal V8 heap objects in a persistent `statusCache` Map across polling cycles, triggering a V8 cppgc thread-safety assertion (`EXC_BREAKPOINT/SIGTRAP`) that killed the entire Electron process. Fix: replaced persistent cache with fresh `cache: {}` per `statusMatrix()` call. Removed the now-dead `clearCache` chain across `IGitStatusWorker`, `GitStatusWorkerAdapter`, `GitStatusService`, and IPC handlers. Simplified `dispose()` in adapter. Corrected pre-existing inaccuracy in `GitStatusStrategySelector` docs (described caching that never existed). Added 42 regression tests (`GitStatusWorkerAdapter.test.ts`, `git-status-cache.test.ts`).

## 0.9.1

### Fixed
- **Autosave race condition – data loss during typing** (#124): Typing during autosave could lose keystrokes due to stale closure overwrites and self-save echo misdetection. Fix adds three-layer defense in `useFileWatcher`: `isSavingRef` guard, content comparison via `isEchoEvent()` (with CRLF normalization), and `hasLocalChangesRef` mirror. `MarkdownEditorPanel.handleSave` now reads content from Monaco editor model (not React state), calls `notifySaveComplete(savedContent)` after write, and performs post-save dirty re-detection to re-mark as modified if the buffer diverged during save. 15 new tests.
- **Terminal file links – @-prefixed paths and line ranges** (#123): Terminal now detects `@/absolute/path` and `@src/relative/path` as clickable file links (from Claude Code CLI output), stripping the `@` prefix to open the underlying file. The `:line-line` range notation (e.g., `:22-24`) is recognized, navigating to the first line of the range. CLI-wrap joining handles @-prefixed paths across multiple terminal lines. Existing `@scope/package` detection (e.g., `@types/node`) is preserved.

## 0.9.0

### Added
- **LiteParse document import** – Import 50+ document formats (PDF, Office, images) with local OCR via Tesseract.js, spatial text extraction, YAML frontmatter, and optional page screenshots. Full stack: backend converter (#132), IPC layer (#133), frontend UI (#134). Spec #021 fully implemented and archived
- **Logs folder shortcut** – Settings overlay Logging section shows clickable logs directory path with "Open" button that opens Finder (#137)
- **GitWatcherService diagnostics** – Diagnostic logging with `raceResolved` guard, late-ready handler, and lifecycle fixes for reliable git status indicators (#136)
- **Git status worker thread offloading** – Moved `isomorphic-git statusMatrix()` from main thread to `worker_threads` Worker for responsive UI during git status computation. Includes native `git status --porcelain` fallback for large repos (>.git/index 5 MB), per-project circuit breaker (3 crashes in 60 s → disable, half-open after 5 min), strategy selector based on repo size, timing instrumentation with structured logging, and cache clearing on project switch. Spec #022 implemented (#147)
  - New files: `IGitStatusWorker` interface, `git-status.worker.ts` worker script, `GitStatusWorkerAdapter`, `GitStatusCircuitBreaker`, `GitStatusStrategySelector`
  - Modified: `GitStatusService` refactored to delegate via `IGitStatusWorker`, `electron.vite.config.ts` worker entry, dispose on `before-quit`, cache clearing in file handlers, `GIT_STATUS` constants in shared
- **Diagnostic logging instrumentation** – ~37 structured log entries across 15 files for large-project performance debugging (#151). Covers `statusMatrix()` and `readDirectory()` timing, project switch stage logging, watcher health snapshots (120s intervals), ThrottledWorker buffer pressure (80%/50% hysteresis), and EMFILE rate-limited logging via new `RateLimitedLogger` utility
- **Large-project performance plan** – Implementation order document for issues #146–#151 based on dependency analysis of the git status → tree render pipeline

### Fixed
- **EMFILE cascade in DirectoryWatcherService** – chokidar EMFILE errors reset the restart timer indefinitely (4,497 errors in 4 min). Fix: close watcher immediately on EMFILE before scheduling restart, guard against late errors from removed watchers, increment `switchVersion` to invalidate in-flight events (#146)
- **FD exhaustion fallback** – When native git's `execFile` fails with EBADF/EMFILE, the worker now returns a transient error instead of falling back to isomorphic-git (which opens thousands of FDs via `fs.stat()`, worsening the cascade). Non-FD errors still fall back. Status and branch `execFile` calls serialized to halve peak FD usage (#147)
- **Diagnostic logging review fixes** – Extract `checkBufferPressure()` for ThrottledWorker `workMany()`, `.unref()` health logger intervals to prevent blocking shutdown, normalize `errorCounts` field, demote non-critical logs to debug level (#151)

### Changed
- Version bump from 0.8.3 to 0.9.0

---

## Earlier versions (archived)

Entries for **v0.8.0 through v0.8.3** are archived in [`docs/archive/changelog-v08.md`](./archive/changelog-v08.md). Entries for **v0.3.0 through v0.5.4** are in [`docs/archive/changelog-v03-v05.md`](./archive/changelog-v03-v05.md). v0.6.x–v0.7.x are missing historical entries; they predate the current changelog discipline.

Archival criterion: once a major version is two releases behind the current shipped version AND the CHANGELOG file exceeds the 500-line cap, move the oldest major-version block to an archive file and leave a one-line pointer here.

Earlier 0.8.x entries moved to archive on 2026-04-23 during the Phase 4 doc-sweep (#165).
