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

Clicking a link inside a previewed page opens its target **inside Erfana, in a new tab** — reusing the tab if that file is already open, exactly like clicking in the project tree.

This is deliberately not the web's rule. On the web a plain link replaces the page you are on, and only `target="_blank"` opens a tab; here every link opens a tab, which matches how a Markdown preview behaves. `target`, `_self` and `<base target>` are read but do not change the outcome — there is no in-page navigation in this version.

| Link | What happens |
|---|---|
| `#section` on the same page | scrolls, as normal |
| another `.html` in the project | opens as a running preview in a new tab |
| a `.md`, an image, any other project file | opens in its usual panel |
| a file under `node_modules/`, `dist/`, `out/`, `coverage/`, `.git/`, or gitignored | opens as **source** |
| a path outside the project, or a missing file | refused, and listed in the failure badge |
| `https:`, `http:`, `mailto:`, `tel:`, `ftp:` | Erfana shows you the destination and asks before handing it to the operating system (your browser, mail or phone app) |
| anything else, and `<a download>` | blocked, and listed in the failure badge |

Every path is re-checked by Erfana itself before anything opens: the page's own idea of where a link points is never trusted.

**Two cases where a link stays dead**, both the same as before this feature existed:

- a page whose own JavaScript calls `stopPropagation()` on the click, which hides it from Erfana;
- a link inside a **closed** shadow root, which nothing outside the page can see.

## Network allowlist

Remote subresources – scripts, CSS, fonts, images from other addresses – are **blocked by default**. A page that references an address absent from the project's allowlist has that subresource blocked, and the address is listed in the **permission band** along the top of the preview, with an **Allow** button on its row.

The unit of a permission is an **origin**: scheme, host and port together. `https://cdn.example.com`, `https://cdn.example.com:8443` and `http://cdn.example.com` are three different permissions, because they are three different things to reach. `http://` is allowable and works, and the confirm step says what it costs — the connection is not encrypted, so anyone in between can change what the page loads.

Every blocked address gets a button, `localhost` and IP literals included — including a hostname ending in a dot, which is a *different* grant from the same name without one (measured: a CSP host-source matches only its own spelling), so the row draws the dot rather than hiding it.

A row without a button says **why**, and the reason is derived from the address rather than assumed. Two shapes reach it. An **IPv6 literal** cannot be allowed at all, because the browser's Content-Security-Policy grammar has no way to write one (`host-char` is `ALPHA / DIGIT / "-"`). A name that is **not a valid host name** — an underscore, an empty part — cannot have a permission written for it either. The row used to give the IPv6 reason for both.

- **Approving records the origin** in `.erfana/settings.json` inside the open project, under `origins`. (An older `hosts` field may sit beside it: it is a projection kept for builds that predate origins, and `origins` is the truth.) That file is the only source of truth for what is allowed. The preview reloads and the approved origin's subresource loads.
- **You can see what is approved, but not yet revoke it in-app.** The permission band lists every origin the project has already allowed alongside the blocked ones, so a cloned repository that arrives with approvals shows them. Removing one is still a manual edit – open `.erfana/settings.json` and delete the entry. In-app revoke is tracked as [#86](https://github.com/qodeca/erfana/issues/86) (see also [Security § HTML preview](../security.md#html-preview) and the technical-debt ledger).

The allowlist controls *which* origins a page may reach, never *what* it sends. It raises the cost of an attack; it is a speed bump, not a wall – the accepted risks section spells out why.

## Auto-refresh

The preview watches the page plus every local file it links, and re-subscribes when the link set changes, so newly linked files start triggering updates and removed ones stop.

- **CSS saves swap in place.** Saving a CSS-only change updates styling without a reload, preserving page state – scroll position, form values, in-memory JavaScript state.
- **HTML or JS saves fully reload.** Saving an HTML or JavaScript change performs a full page reload.

For the acceptance corpus, save-to-visible-change stays under 300 ms.

## Colours, zoom, and the preview toolbar

- **A page is painted in its own colours.** A preview uses the background the page itself resolves to – white for ordinary HTML, dark for a page declaring `color-scheme: dark` – exactly as a browser would. Erfana's own dark colour appears only before the page has painted anything, so the seam between Erfana's panel and the page never flashes.
- **Zoom applies to the page, not the panel.** Cmd/Ctrl-plus, minus and 0 over a preview, or the **View** menu, zoom the previewed page the way a browser does. Each preview keeps its own zoom level, including across a sleep and wake.
- **Every live preview carries a toolbar above the page.** It is Erfana's own interface, in the same shape as the toolbar above a Markdown file, and it sits in an area the page cannot draw on – the page is laid out below it, not over it. It holds a **Find** button and the permission chip described under [Network allowlist](#network-allowlist), and it is where Erfana asks you about the page: "Approve this host?" is asked in the toolbar, above the page, rather than in a message beside it. The toolbar used to name itself – it read "Preview – content below is not Erfana" and had a bright 2px line under it. Both were removed when it became a conventional toolbar, so **nothing on screen now tells you where Erfana stops and the previewed page starts**. What you can still rely on: Erfana never asks for a password or an API key inside a preview, and anything that appears *inside* the page area – including a dialog that looks like Erfana's – is the page, not Erfana.
- **Notifications move rather than hide the page.** A message in the corner shifts itself clear of a running preview instead of blanking it, so you can read the page and answer a prompt at the same time. If the window is too small for it to fit clear, the preview hides instead – a prompt must never sit underneath somebody else's page.

## Find, export, and the off-switch

- **Find-in-page.** The existing search UI matches text inside the running page, reports match counts, and steps through matches – it drives the view's own find, not a DOM search. It opens from Cmd/Ctrl-F as it always did, and now also from the **Find** button in the preview's toolbar, so it can be found without knowing the shortcut.
- **PDF export.** The **Export to PDF** button in the preview's toolbar produces a PDF of the page as rendered *after* its JavaScript has run. It used to be a right-click on the tab handle, which nobody found; it is now where the Markdown editor keeps the same button. The button greys out while a save dialog is open, so a second click cannot stack another one behind it.
- **Global off-switch.** A single setting disables HTML execution entirely. With it off, `.html` files open as source only and no preview process is ever created – existing previews are torn down when the toggle flips.

## Failure reporting

Failures – script errors, missing local files, network timeouts, blocked hosts, blocked links, unsupported asset types – accumulate quietly into a badge that carries a count. Opening the badge lists the individual failures with enough detail to identify the cause. Blocked addresses additionally appear in the permission band described above. Nothing interrupts the page; the badge is the single place failures gather.

## Accepted risks

Shipping a format that executes real code is a deliberate trade-off with risks that are accepted rather than eliminated – the allowlist being a speed bump not a wall, known breakage on external/network volumes and same-project-in-two-windows, a permanent Chromium security surface, and exfiltration channels no chokepoint can observe. These are stated plainly in [Security § HTML preview](../security.md#html-preview); consult that section before relying on the sealed box for anything sensitive.
