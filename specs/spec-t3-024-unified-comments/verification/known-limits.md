<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Known limits

Parts of a design rule that the platform cannot build, with the fallback that ships. Each row is listed in the pull request.

| Item | Limit | Fallback |
|---|---|---|
| C-12 R-20 – a link inside a comment mark | The CSS Custom Highlight API cannot style links inside a highlighted range: `::highlight()` takes no `text-decoration-line` and no descendant selector. The "links keep their colour and gain an underline" rule cannot be built for marks drawn this way (recorded 2026-10-30). | The mark's fill and bar are drawn under the link's own colour and underline as the preview styles it. Link contrast inside a mark is part of the owner's hands-on check on the Text highlights card. |
| M-08 frames and M-10 overlay setup failure – the HTML menu's reason line | In the HTML Preview a right-click on a frame that cannot be commented (an inline `srcdoc` frame, a frame from another site – M-08) and a right-click after the page overlay failed to set up (M-10) do not take the page→main pick path that names the reason, so the menu cannot say "Comments can't be added inside an inline frame.", "…inside a frame from another site." or "Comments are unavailable for this file: {reason}.". Widening the page→main pick path to these cases was decided against, to leave the right-click gate of security review L-1 (`src/main/services/preview/comments/commentContextGate.ts`) unchanged (recorded 2026-10-30). | The item keeps its action name, disabled with the generic reason line ("This part of the page can't hold a comment."). For M-10 the toolbar's tooltip still gives the full sentence, "Comments are unavailable for this file: {reason}.". |
