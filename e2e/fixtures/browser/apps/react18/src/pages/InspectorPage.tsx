// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The one page whose elements carry source attributes (025-FR-037 rule 1), in
 * the react-dev-inspector form. Line and column point at the element's opening
 * `<` in this file, both 1-based; the self-test checks they still do.
 */
export function InspectorPage() {
  return (
    <section
      className="inspector-page"
      data-inspector-relative-path="src/pages/InspectorPage.tsx"
      data-inspector-line="10"
      data-inspector-column="5"
    >
      <h2
        className="inspector-title"
        data-inspector-relative-path="src/pages/InspectorPage.tsx"
        data-inspector-line="16"
        data-inspector-column="7"
      >
        Source attributes
      </h2>
      <button
        className="inspector-button"
        type="button"
        data-inspector-relative-path="src/pages/InspectorPage.tsx"
        data-inspector-line="24"
        data-inspector-column="7"
      >
        Annotated button
      </button>
    </section>
  )
}
