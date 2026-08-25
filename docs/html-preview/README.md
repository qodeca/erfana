# HTML preview

Erfana previews `.html` files as a **running page** – a live view that executes the file's real CSS and JavaScript, refreshes as you edit, and stays sealed off from your machine and from Erfana itself. This page explains what previews, what does not, how the network allowlist works, and where the accepted risks are written down.

For the full threat model and the risks knowingly accepted, see [Security § HTML preview](../security.md#html-preview). This page cross-references that section rather than repeating it.

## What previews, what does not

**`.html` runs.** Opening an `.html` file from the project tree renders the live page full width in the editor area, with its CSS applied and its JavaScript executed. Relative `.css`, `.js` and image references resolve against the project folder, and remote subresources load once their host is approved (see [Network allowlist](#network-allowlist)).

**`.md` stays static.** Markdown keeps its existing static, sanitized preview – it never executes scripts. `.html` is the single format Erfana runs; that line is deliberate and does not change here.

**Build-dependent projects do not fully preview.** A page that needs a build step – `npm install`, a bundler, TypeScript, JSX, `node_modules` resolution – does not render its build-output parts. Those parts fail to load, and the failures are reported in the error badge rather than crashing the preview. This is documented behaviour, not a bug: the page runs as-is, with no build tooling behind it.

**Some paths only ever open as source.** Files under `node_modules`, `dist`, `out`, `coverage`, `.git`, and any gitignored path open as source in the Monaco editor and never execute – including when opened from search results or the project tree. Source viewing of any `.html` is also available as a separate, explicit action, with html, css and js each highlighted by file type.

## Network allowlist

Remote subresources – scripts, CSS, fonts, images from other hosts – are **blocked by default**. A page that references a host absent from the project's allowlist has that subresource blocked, and a single toast appears for that host with an **Approve** action.

- **Approving records the host** in `.erfana/settings.json` inside the open project. That file is the only source of truth for which hosts are allowed. On the next load the approved host's subresource loads.
- **Removing an approval is currently a manual edit.** There is no in-app view or revoke of approved hosts yet – to remove one, edit `.erfana/settings.json` by hand and delete the host. An in-app allowlist view/revoke UI is a planned follow-up (see [Security § HTML preview](../security.md#html-preview) and the technical-debt ledger).

The allowlist controls *which* origins a page may reach, never *what* it sends. It raises the cost of an attack; it is a speed bump, not a wall – the accepted risks section spells out why.

## Auto-refresh

The preview watches the page plus every local file it links, and re-subscribes when the link set changes, so newly linked files start triggering updates and removed ones stop.

- **CSS saves swap in place.** Saving a CSS-only change updates styling without a reload, preserving page state – scroll position, form values, in-memory JavaScript state.
- **HTML or JS saves fully reload.** Saving an HTML or JavaScript change performs a full page reload.

For the acceptance corpus, save-to-visible-change stays under 300 ms.

## Find, export, and the off-switch

- **Find-in-page.** The existing search UI matches text inside the running page, reports match counts, and steps through matches – it drives the view's own find, not a DOM search.
- **PDF export.** Export produces a PDF of the page as rendered *after* its JavaScript has run.
- **Global off-switch.** A single setting disables HTML execution entirely. With it off, `.html` files open as source only and no preview process is ever created – existing previews are torn down when the toggle flips.

## Failure reporting

Failures – script errors, missing local files, network timeouts, blocked hosts, unsupported asset types – accumulate quietly into a badge that carries a count. Opening the badge lists the individual failures with enough detail to identify the cause. Blocked hosts additionally raise the one-time Approve toast described above. Nothing interrupts the page; the badge is the single place failures gather.

## Accepted risks

Shipping a format that executes real code is a deliberate trade-off with risks that are accepted rather than eliminated – the allowlist being a speed bump not a wall, known breakage on external/network volumes and same-project-in-two-windows, a permanent Chromium security surface, and exfiltration channels no chokepoint can observe. These are stated plainly in [Security § HTML preview](../security.md#html-preview); consult that section before relying on the sealed box for anything sensitive.
