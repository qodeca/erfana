# HTML preview

Erfana previews `.html` files as a **running page** – a live view that executes the file's real CSS and JavaScript, refreshes as you edit, and stays sealed off from your machine and from Erfana itself. This page explains what previews, what does not, how the network allowlist works, and where the accepted risks are written down.

For the full threat model and the risks knowingly accepted, see [Security § HTML preview](../security.md#html-preview). This page cross-references that section rather than repeating it.

## What previews, what does not

**`.html` runs.** Opening an `.html` file from the project tree renders the live page full width in the editor area, with its CSS applied and its JavaScript executed. Relative `.css`, `.js` and image references resolve against the project folder, and remote subresources load once their host is approved (see [Network allowlist](#network-allowlist)).

**Every `.html` file gets its own tab.** Previews run independently, like Markdown previews. To keep the cost bounded, only the **3 most recently used** previews stay running: the rest freeze to a still picture of the page and start themselves again the moment you click their tab. Page state (scroll position, typed text, counters) is lost when a preview sleeps.

**`.md` stays static.** Markdown keeps its existing static, sanitized preview – it never executes scripts. `.html` is the single format Erfana runs; that line is deliberate and does not change here.

**Build-dependent projects do not fully preview.** A page that needs a build step – `npm install`, a bundler, TypeScript, JSX, `node_modules` resolution – does not render its build-output parts. Those parts fail to load, and the failures are reported in the error badge rather than crashing the preview. This is documented behaviour, not a bug: the page runs as-is, with no build tooling behind it.

**Some paths only ever open as source.** Files under `node_modules`, `dist`, `out`, `coverage`, `.git`, and any gitignored path open as source in the Monaco editor and never execute – including when opened from search results or the project tree. Source viewing of any `.html` is also available as a separate, explicit action, with html, css and js each highlighted by file type.

## Links

Clicking a link inside a previewed page opens its target **inside Erfana**. By default it opens **in a new tab** – reusing the tab if that file is already open, exactly like clicking in the project tree – which matches how a Markdown preview behaves.

**A tab can open links in place instead.** The **Open links in this tab** toggle at the left of the preview's toolbar switches that one tab to same-tab mode: a plain link to another previewed page in the project then replaces the page in this tab, the way a browser does. Its tooltip says which mode is on. The mode is per tab and kept in memory only – after a restart every tab opens links in new tabs again – and a tab opened by a link inherits the mode of the tab it came from.

What a link's own markup and the click decide, in either mode:

| Link or click | Where it opens |
|---|---|
| Cmd-click (macOS), Ctrl-click (Windows, Linux), or any button other than the main one | a new tab |
| `target="_blank"` or a named target | a new tab |
| `target="_self"`, `_top` or `_parent`, including through `<base target>` | this tab |
| no `target` | the tab's mode decides |

Only a page that runs as a preview can open in place. A link to anything else – a `.md`, an image, or an `.html` that opens as source – opens in its usual panel in a new tab, whatever the mode says.

**One file, one tab.** When a page opens in place, any other tab in the window that shows the same file closes – editor tabs included. If one of those editors has unsaved changes, Erfana asks first (Save, Don't save, or Cancel), and Cancel leaves everything as it was. Nothing closes until the new page has been accepted.

| Link | What happens |
|---|---|
| `#section` on the same page | scrolls, as normal |
| another `.html` in the project | opens as a running preview – in a new tab, or in this tab per the rules above |
| a `.md`, an image, any other project file | opens in its usual panel |
| a file under `node_modules/`, `dist/`, `out/`, `coverage/`, `.git/`, or gitignored | opens as **source** |
| a path outside the project, or a missing file | refused, and listed in the failure badge |
| `https:`, `http:`, `mailto:`, `tel:`, `ftp:` | Erfana shows you the destination and asks before handing it to the operating system (your browser, mail or phone app) |
| anything else, and `<a download>` | blocked, and listed in the failure badge |

That question is a native message box **owned by the window whose preview asked**, so it is modal to that window and raised with it, and only one such question is open per window at a time — a second external link clicked while the first is still waiting is refused rather than queued, and listed in the failure badge as a blocked link.

Every path is re-checked by Erfana itself before anything opens: the page's own idea of where a link points is never trusted.

**Two cases where a link stays dead**, both the same as before this feature existed:

- a page whose own JavaScript calls `stopPropagation()` on the click, which hides it from Erfana;
- a link inside a **closed** shadow root, which nothing outside the page can see.

## Back and Forward

Each preview tab keeps its own history of the pages it has shown, up to 50 entries. It lives in Erfana, not in the page, so it survives a preview going to sleep and waking again.

- **Back** is a button at the left of the toolbar; its tooltip names the page it goes back to. It is greyed out when the tab has no earlier page.
- **Keys**: Cmd+[ and Cmd+] on macOS, Alt+Left Arrow and Alt+Right Arrow on Windows and Linux. **Forward has a key but no button.** The keys work only while focus is in that preview – its toolbar, find bar, banner, or the page itself – so they never reach the page's own scripts, and Cmd+[ in the editor still outdents. They match the physical key, whatever character it types on your keyboard layout.
- **A page that was deleted** is dropped from the history the first time Back or Forward reaches it: a notice says it was removed, the tab stays where it is, and the next press goes one entry further.
- **Script steps.** A page's own `#hash` change or `pushState` adds an entry only right after a real click or key press; without one it replaces the entry you are on, so a page that rewrites its address in a loop cannot flood the history.

If a page that was opened in place cannot be shown – it was moved or deleted in the meantime – the tab says so and offers a button back to the page before it.

## Frames

A page can show other pages from the same project in an `<iframe>`.

- **`<iframe src>` pointing at a project file runs**, with its own CSS and JavaScript. Every frame is sealed off like the page: the page and its frames cannot read each other.
- **`<iframe srcdoc>` runs too** – the frame's markup lives inside the page and follows the page's rules.
- **Links inside a frame** move that frame, not the tab: the tab's title and Back stay as they were. A link inside a frame with `target="_top"` or `_blank` does nothing, and because nothing outside the page sees that click, it is not listed in the failure badge either.
- **Remote hosts used by a frame** – a script, stylesheet or font from a CDN – are blocked and listed in the permission band like the page's own, and **Allow** works for them the same way.

**What is refused, and listed in the failure badge:**

| Frame | Badge label |
|---|---|
| a remote page (`https:` and so on), even from an approved host – hosts are approved for subresources, never as frames | Blocked remote frame |
| a `data:` or `blob:` address | Blocked remote frame (only the scheme is listed) |
| a path outside the project, or another preview's page | Frame escaped the project |
| a file under `node_modules/`, `dist/` or another always-excluded folder, or a dot-path | Excluded frame |
| a missing file | Missing local file |
| a link inside a frame that already shows a page, to a remote or `data:` / `blob:` address | Blocked link in frame (scheme and host only) |

**Limits.** A frame may nest at most 3 levels below the page, and a page may hold at most 50 frames. An `<iframe src>` past either limit stays empty and is listed ("Frame nested too deep", or "12 frames over the limit of 50 were left empty").

**The `srcdoc` rule.** A `srcdoc` frame cannot be stopped before it loads, so one past a limit is **shown anyway** and listed once per page load – "srcdoc frame – shown anyway; the depth limit covers src frames only", or "10 srcdoc frames over the limit of 50 are shown anyway". This is accepted: the limits guard responsiveness, not security, and a `srcdoc` frame can load nothing its page could not load itself.

**Gitignored pages can run inside a frame.** The gitignore rule decides only how a click in the tree or a link opens a file. A gitignored `.html` framed by a page runs there, while a link to the same file still opens it as source.

**A file that is itself a symlink is not served.** A frame whose `src` names a symlink – whether it points inside the project or out of it – is listed as a **Missing local file**, and a stylesheet, script or image the page asks for by a symlinked name does not load either. The target is never read. A symlinked *folder* inside the project works, and one that leads out of the project is still refused as an escape. On Windows the same frame is expected to be listed as "Frame escaped the project" instead; that has not yet been checked on Windows.

Markdown previews still show no frames at all.

## Network allowlist

Remote subresources – scripts, CSS, fonts, images from other addresses – are **blocked by default**. A page that references an address absent from the project's allowlist has that subresource blocked, and the address is listed in the **permission band** along the top of the preview, with an **Allow** button on its row.

The unit of a permission is an **origin**: scheme, host and port together. `https://cdn.example.com`, `https://cdn.example.com:8443` and `http://cdn.example.com` are three different permissions, because they are three different things to reach. `http://` is allowable and works, and the confirm step says what it costs — the connection is not encrypted, so anyone in between can change what the page loads.

Every blocked address gets a button, `localhost` and IP literals included — including a hostname ending in a dot, which is a *different* grant from the same name without one (measured: a CSP host-source matches only its own spelling), so the row draws the dot rather than hiding it.

A row without a button says **why**, and the reason is derived from the address rather than assumed. Two shapes reach it. An **IPv6 literal** cannot be allowed at all, because the browser's Content-Security-Policy grammar has no way to write one (`host-char` is `ALPHA / DIGIT / "-"`). A name that is **not a valid host name** — an underscore, an empty part — cannot have a permission written for it either. The row used to give the IPv6 reason for both.

- **Approving records the origin** in `.erfana/settings.json` inside the open project, under `htmlPreview.allowlist.origins`. (An older `hosts` field may sit beside it: it is a projection kept for builds that predate origins, and `origins` is the truth.) That file is the only source of truth for what is allowed. The preview reloads and the approved origin's subresource loads.
- **You can see what is approved, but not yet revoke it in-app.** The permission band lists every origin the project has already allowed alongside the blocked ones, so a cloned repository that arrives with approvals shows them. Removing one is still a manual edit – open `.erfana/settings.json` and delete the entry. In-app revoke is tracked as [#86](https://github.com/qodeca/erfana/issues/86) (see also [Security § HTML preview](../security.md#html-preview) and the technical-debt ledger).

The allowlist controls *which* origins a page may reach, never *what* it sends. It raises the cost of an attack; it is a speed bump, not a wall – the accepted risks section spells out why.

## Auto-refresh

The preview watches the page plus every local file it links, and re-subscribes when the link set changes, so newly linked files start triggering updates and removed ones stop.

- **CSS saves swap in place.** Saving a CSS-only change updates styling without a reload, preserving page state – scroll position, form values, in-memory JavaScript state.
- **HTML or JS saves fully reload.** Saving an HTML or JavaScript change performs a full page reload.
- **Frames are watched too.** A frame's own `.html` file and the files it links are part of the page's watch set, so saving any of them reloads the page. A stylesheet that a frame uses reloads the whole page rather than swapping in place, so the frame is never left showing the old styling; a stylesheet only the top page uses still swaps in place.
- **After a page opens in place**, the watch set follows the new page: saving the old page's files no longer reloads the tab.

**At most 16 files are watched per preview.** The page's own links come first, then the frames' files by depth. A file past that budget is left out and counted, so a framed page with many files can report a non-zero "not watched" count – expected, not a fault. Saving an unwatched file does not refresh the preview.

For the acceptance corpus, save-to-visible-change stays under 300 ms.

## Colours, zoom, and the preview toolbar

- **A page is painted in its own colours.** A preview uses the background the page itself resolves to – white for ordinary HTML, dark for a page declaring `color-scheme: dark` – exactly as a browser would. Erfana's own dark colour appears only before the page has painted anything, so the seam between Erfana's panel and the page never flashes.
- **Zoom applies to the page, not the panel.** Cmd/Ctrl-plus, minus and 0 over a preview, or the **View** menu, zoom the previewed page the way a browser does. Each preview keeps its own zoom level, including across a sleep and wake.
- **Every live preview carries a toolbar above the page.** It is Erfana's own interface, in the same shape as the toolbar above a Markdown file, and it sits in an area the page cannot draw on – the page is laid out below it, not over it. From left to right it holds **Back** and the **Open links in this tab** toggle (see [Links](#links)), a **Find** button, the permission chip described under [Network allowlist](#network-allowlist), and the **Open in default browser** and **Export to PDF** buttons; in a very narrow panel Find and Export to PDF leave the row, while their shortcuts keep working. It is also where Erfana asks you about the page: "Approve this host?" is asked in the toolbar, above the page, rather than in a message beside it. The toolbar used to name itself – it read "Preview – content below is not Erfana" and had a bright 2px line under it. Both were removed when it became a conventional toolbar, so **nothing on screen now tells you where Erfana stops and the previewed page starts**. What you can still rely on: Erfana never asks for a password or an API key inside a preview, and anything that appears *inside* the page area – including a dialog that looks like Erfana's – is the page, not Erfana.
- **Notifications move rather than hide the page.** A message in the corner shifts itself clear of a running preview instead of blanking it, so you can read the page and answer a prompt at the same time. If the window is too small for it to fit clear, the preview hides instead – a prompt must never sit underneath somebody else's page.

## Find, export, and the off-switch

- **Find-in-page.** The existing search UI matches text inside the running page, reports match counts, and steps through matches – it drives the view's own find, not a DOM search. It opens from Cmd/Ctrl-F as it always did, and now also from the **Find** button in the preview's toolbar, so it can be found without knowing the shortcut.
- **PDF export.** The **Export to PDF** button in the preview's toolbar produces a PDF of the page as rendered *after* its JavaScript has run. It used to be a right-click on the tab handle, which nobody found; it is now where the Markdown editor keeps the same button. The save dialog suggests the name of the page the tab shows now, and the button greys out while a save dialog is open, so a second click cannot stack another one behind it.
- **Keyboard entry into the page.** The page is drawn by a separate view, so Tab alone cannot reach inside it. Tab to the preview area, then press **Enter** or **Space** to put focus in the page – from there Tab reaches its links and fields, and the preview's shortcuts (Find, Back, Forward) keep working. **Escape** brings focus back to the toolbar's permission chip. Only the active tab, with a page running and on screen, can be entered; a screen reader announces the area as "HTML preview of page.html – press Enter to enter the page, Escape to come back".
- **Global off-switch.** A single setting disables HTML execution entirely. With it off, `.html` files open as source only and no preview process is ever created – existing previews are torn down when the toggle flips.

## Open in default browser

A page can also be opened outside Erfana, in your own web browser – for browser devtools, or to check it without the preview's seal.

- **Where**: right-click an `.html` or `.htm` file in the project tree and choose **Open in default browser** (second in the menu, after Open as source), or press the **Open in default browser** button in a preview's toolbar. The toolbar button opens the page the tab shows now, including after a link opened another page in place. The tree offers it for every `.html` / `.htm` file – gitignored files, excluded folders and HTML execution turned off included.
- **What opens is the file**, not an address: no `#section` is passed on, and the browser gets the real file behind any symlink.
- **Only project files open.** The file must sit inside the open project, still exist, be a regular file, and be an `.html` / `.htm` file both by the name you clicked and by the file a symlink leads to. On Windows, a name that points at an NTFS alternate data stream (`page.exe:x.html`) is refused as not an HTML page. A refused file gets an error notice titled "Could not open in browser"; the codes are listed in [Error codes § Open in default browser](../error-codes.md#open-in-default-browser-6-codes).
- **Success is silent.** While the request runs, the toolbar button is dimmed and further presses are ignored.
- **When your default browser cannot be found**, the file goes to the app your system uses for `.html` files instead, and a notice says so ("Opened in the app for .html files"). That app may be an editor rather than a browser. On **Linux**, Erfana does not look up the default browser at all, so this is what happens every time. If the browser was found but did not start, nothing else is tried: the notice "Could not open in browser" suggests Reveal in Finder, Explorer or File Manager instead.

**This page runs unsealed.** In a real browser the page has no sandbox, no host allowlist and open network access. It is started only from Erfana's own interface – a previewed page cannot trigger it – and this is recorded as an accepted risk in [Security § HTML preview](../security.md#html-preview).

## Failure reporting

Failures – script errors, missing local files, network timeouts, blocked hosts, blocked links, unsupported asset types, refused frames (see [Frames](#frames)) – accumulate quietly into a badge that carries a count. Opening the badge lists the individual failures with enough detail to identify the cause. Blocked addresses additionally appear in the permission band described above. Nothing interrupts the page; the badge is the single place failures gather.

The badge belongs to the page on screen. When a link opens another page in the same tab, or a reload finishes, the badge shows that page's failures only; a `#section` jump within the page keeps it as it is.

## Accepted risks

Shipping a format that executes real code is a deliberate trade-off with risks that are accepted rather than eliminated – the allowlist being a speed bump not a wall, known breakage on external/network volumes and same-project-in-two-windows, a permanent Chromium security surface, and exfiltration channels no chokepoint can observe. These are stated plainly in [Security § HTML preview](../security.md#html-preview); consult that section before relying on the sealed box for anything sensitive.
