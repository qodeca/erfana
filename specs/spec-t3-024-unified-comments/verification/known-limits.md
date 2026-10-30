<!-- SPDX-License-Identifier: GPL-3.0-only -->
<!-- SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. -->

# Known limits

Parts of a design rule that the platform cannot build, with the fallback that ships. Each row is listed in the pull request.

| Item | Limit | Fallback |
|---|---|---|
| C-12 R-20 – a link inside a comment mark | The CSS Custom Highlight API cannot style links inside a highlighted range: `::highlight()` takes no `text-decoration-line` and no descendant selector. The "links keep their colour and gain an underline" rule cannot be built for marks drawn this way (recorded 2026-10-30). | The mark's fill and bar are drawn under the link's own colour and underline as the preview styles it. Link contrast inside a mark is part of the owner's hands-on check on the Text highlights card. |
