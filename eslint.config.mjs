// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import pluginJs from '@eslint/js'
import pluginReact from 'eslint-plugin-react'
import * as tseslint from 'typescript-eslint'
// Use flat-config-friendly Prettier rules directly
import eslintConfigPrettier from 'eslint-config-prettier'

export default [
  // Ignore build outputs and vendored folders. `playwright-report/`,
  // `test-results/`, and `coverage/` are test-run artifacts containing
  // minified bundles that ESLint must not try to parse.
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'release/**',
      'temp/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      // design/claims.js is GENERATED (scripts/design-sync.mjs) and runs in a
      // browser over file://, so it uses `window`/`document` and would fail
      // `no-undef` under this Node-flavoured config. It is not hand-edited and
      // it is not shipped. What actually guards it: `npm run design -- --check`
      // fails when it is stale, and scripts/design-claims.test.mjs re-derives
      // every value in it on each CI run. The authored cards' JS is inline in
      // HTML, which ESLint does not read either — CSS in design/ is covered by
      // stylelint via postcss-html.
      'design/claims.js',
      // Scratch project trees Playwright creates per e2e run. Already in
      // .gitignore, but ESLint reads the working tree, not the index: on
      // Windows a teardown can fail with EBUSY (the app still holds a handle),
      // and the surviving fixtures — plain browser scripts, not app source —
      // then fail `no-undef` on `document`/`window` and break `npm run lint`
      // for reasons unrelated to any change.
      '.e2e-temp/**',
      // Static browser test-input fixtures for the HTML-preview feature (#74):
      // these run inside the sealed preview WebContentsView, not the app/Node
      // context, so linting them as project source flags browser globals.
      'e2e/fixtures/html-preview-corpus/**'
    ]
  },
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  // Disable formatting-related rules that conflict with Prettier
  { rules: eslintConfigPrettier.rules },
  // Configure React version detection for eslint-plugin-react
  { settings: { react: { version: 'detect' } } },
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_'
        }
      ],
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off'
    }
  },
  // Test files: relax some strict TS rules
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'tests/**/*.ts',
      'tests/**/*.tsx',
      'src/**/__tests__/**/*.ts',
      'src/**/__tests__/**/*.tsx'
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off'
    }
  },
  // E2E suite: forbid the bare `./fixtures` import path. The legacy
  // `e2e/fixtures.ts` file was deleted in Phase E.4 of the test-infra
  // plan, but the bare specifier remains an unhealthy pattern — it
  // re-acquires the resolution ambiguity the moment anyone adds a new
  // `fixtures.ts` file to e2e/. Require the explicit `./fixtures/index`
  // form so the import line states exactly which entry point is meant.
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './fixtures',
              message:
                'Use `./fixtures/index` explicitly — the bare `./fixtures` path is ambiguous (file before directory in Node/TS resolution).'
            }
          ]
        }
      ]
    }
  },
  // Build scripts: CommonJS Node.js environment
  {
    files: ['scripts/**/*.js', 'scripts/**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  // The image-export rasterize harness (#73) is a hidden Chromium page that is
  // handed image bytes straight from the user's project — SVG included, which
  // is a document format with a script model. It is safe ONLY because an SVG
  // reaches it as `<img src=blob:...>`, Chromium's secure static mode. Losing
  // that property takes one line, so the rule is enforced rather than
  // documented:
  //
  //   * no HTML-string sink can put SVG text into the DOM;
  //   * no parser (`DOMParser`) and no `eval` family;
  //   * no RUNTIME import from outside this folder, so the app bundle — and
  //     with it `window.api` — cannot be pulled into the harness chunk.
  //     Type-only imports are exempt via `allowTypeImports`: they are erased
  //     entirely by the compiler, emit no code, and are how the harness stays
  //     bound to the shared wire contract instead of re-declaring it. (A
  //     negated allow-list such as `!../../../shared/**` is NOT usable here —
  //     ESLint matches these patterns with the `ignore` package configured for
  //     relative paths, where `!` negation does not take effect.)
  //
  // Deliberately uses `no-restricted-properties` / `-globals` / `-imports` and
  // NOT `no-restricted-syntax`: flat config replaces a rule wholesale, and the
  // `src/renderer/**` block below owns `no-restricted-syntax`, so a second
  // declaration here would silently disable its selectors for this folder. The
  // remaining harness ban — creating an `object` / `embed` / `iframe` element,
  // which loads an SVG AS A DOCUMENT and does execute script — is therefore
  // selector 5 of that block, where it covers this folder too.
  {
    files: ['src/renderer/src/imageExport/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message:
            'The rasterize harness must never put markup into the DOM — an untrusted SVG would become executable. Build elements with createElement.'
        },
        {
          property: 'outerHTML',
          message:
            'The rasterize harness must never put markup into the DOM — an untrusted SVG would become executable. Build elements with createElement.'
        },
        {
          property: 'insertAdjacentHTML',
          message:
            'The rasterize harness must never put markup into the DOM — an untrusted SVG would become executable. Build elements with createElement.'
        },
        {
          object: 'document',
          property: 'write',
          message: 'document.write parses markup. The harness must not parse anything.'
        },
        {
          object: 'document',
          property: 'writeln',
          message: 'document.writeln parses markup. The harness must not parse anything.'
        }
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'DOMParser',
          message:
            'The harness must never parse an untrusted document. Images are decoded via createImageBitmap or <img src=blob:...> only.'
        },
        {
          name: 'eval',
          message: 'No dynamic code evaluation in the rasterize harness.'
        }
      ],
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // `../**` is belt and braces. Verified by probe: the `ignore`
              // matcher treats `../*` as a directory prefix, so it already
              // rejects `../utils/logger` and `../../up/two/levels` as well as
              // `../deep`. The explicit deep pattern keeps that property from
              // resting on a matcher detail nobody can see from here.
              group: ['../*', '../**', '@renderer/*', '@renderer/**'],
              allowTypeImports: true,
              message:
                'The rasterize harness must not import app code at runtime — it runs in a window that decodes untrusted bytes. Only this folder, and type-only imports, are allowed.'
            }
          ]
        }
      ]
    }
  },
  // Main process: `ipcMain` has exactly ONE permitted importer,
  // `src/main/ipc/registry.ts` (exempt below).
  //
  // Every global IPC channel must be gated on the app's own top-level renderer.
  // That was first attempted by monkey-patching the `ipcMain` singleton at the
  // composition root, which failed three ways: it broke `removeListener` by
  // registering a different closure than the caller held, it was walked around
  // entirely by `addListener` / `prependListener` (the same prototype function
  // under another name), and its "install before any handler registers"
  // requirement was a comment with nothing to enforce it.
  //
  // Routing every registration through one module removes all three by
  // construction, and this rule is what keeps the module from being bypassed —
  // the same enforcement pattern used for `api.preview.setVisibility` and
  // `openFileInPanel` in the renderer block below. See sd-074b §7.
  //
  // NOTE: `no-restricted-imports` is set for `e2e/**` and for
  // `src/renderer/src/imageExport/**` elsewhere in this file. Neither overlaps
  // `src/main/**`, so this block is safe — but flat config REPLACES a rule
  // rather than merging it, so never add a second block setting
  // `no-restricted-imports` for main-process files.
  {
    files: ['src/main/**/*.ts'],
    // Tests read the emitter to assert what a `register*Handlers()` call put on
    // it, which is exactly what they are for. The rule exists to keep
    // PRODUCTION registrations behind the gate; a test is not an attack surface.
    ignores: ['src/main/ipc/registry.ts', 'src/main/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              importNames: ['ipcMain'],
              allowTypeImports: true,
              message:
                'Register global IPC through src/main/ipc/registry.ts (registerHandle / registerOn / …) so every channel is gated on the app renderer. Importing ipcMain directly bypasses that gate.'
            }
          ]
        }
      ]
    }
  },
  // Renderer process: four families of code that keep reintroducing bugs, or
  // that would reintroduce a security property this app relies on.
  //
  // 1. POSIX-only path manipulation. The renderer is sandboxed (no Node `path`
  //    module) and receives paths in their NATIVE separators from the main
  //    process, so `.split('/')`-based basename/join logic silently breaks on
  //    Windows. Use the cross-platform helpers in `utils/fileUtils.ts` (itself
  //    exempt, as it owns the separator-class logic). See issue #238.
  // 2. Hand-built dockview panel ids. The id prefix and the panel component
  //    must be derived from the same `isImageFile`/kind answer or a file opens
  //    in the wrong panel type; `utils/openFileInPanel.ts` owns that (and is
  //    therefore exempt). The `preview-` prefix is issue #74's running HTML
  //    preview. See issues #70 and #74.
  // 3. The running preview's visibility. `api.preview.setVisibility` and the
  //    `preview:setVisibility` channel have exactly ONE permitted caller,
  //    `services/preview/OverlayGuardService.ts` (exempt), so the "single
  //    hide/show owner" invariant is enforced by the linter, not by convention.
  //    See issue #74 design §1.8.
  // 4. Creating an `object` / `embed` / `iframe` element. Those load an SVG AS
  //    A DOCUMENT, which executes script — the one route the image-export
  //    harness (#73) must never acquire. The selector lives HERE rather than in
  //    the harness-scoped block below because this block owns
  //    `no-restricted-syntax`, and a second declaration of the rule would
  //    silently disable these selectors for whichever files it matched. No
  //    renderer code creates those elements today.
  //
  // NOTE: all four families live in ONE `no-restricted-syntax` entry on
  // purpose. Flat config replaces a rule wholesale rather than merging, so a
  // second block setting `no-restricted-syntax` for these files would silently
  // disable whichever set it did not repeat.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: [
      'src/renderer/src/utils/fileUtils.ts',
      'src/renderer/src/utils/openFileInPanel.ts',
      'src/renderer/src/services/preview/OverlayGuardService.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='pop'][callee.object.type='CallExpression'][callee.object.callee.property.name='split'][callee.object.arguments.length=1][callee.object.arguments.0.type='Literal'][callee.object.arguments.0.value='/']",
          message:
            "POSIX-only basename: .split('/').pop() breaks on Windows native paths. Use getBasename() from utils/fileUtils."
        },
        {
          selector:
            "ConditionalExpression[test.type='CallExpression'][test.callee.property.name='endsWith'][test.arguments.length=1][test.arguments.0.type='Literal'][test.arguments.0.value='/']",
          message:
            "POSIX-only path join: x.endsWith('/') ? x : x+'/' breaks on Windows. Use isPathInside()/isStrictDescendant()/getDisplayRelativePath() from utils/fileUtils."
        },
        // The `sanitizeFilePath` callee is part of the selector on purpose:
        // `editor-${...}` is also a legitimate React `key` (see
        // EditorContentLayout), and only the sanitized-path form is a panel id.
        {
          selector:
            "TemplateLiteral[quasis.0.value.raw='editor-'][expressions.0.callee.name='sanitizeFilePath']",
          message:
            'Panel ids are built in one place. Use getFilePanelId() from utils/openFileInPanel.'
        },
        {
          selector:
            "TemplateLiteral[quasis.0.value.raw='image-'][expressions.0.callee.name='sanitizeFilePath']",
          message:
            'Panel ids are built in one place. Use getFilePanelId() from utils/openFileInPanel.'
        },
        // Mirrors the editor-/image- guards for the #74 running-preview prefix.
        // getFilePanelId is kind-free (never `preview-`), so the preview id is
        // built only inside openFileInPanel via `openFileInPanel({ kind:
        // 'preview' })`.
        {
          selector:
            "TemplateLiteral[quasis.0.value.raw='preview-'][expressions.0.callee.name='sanitizeFilePath']",
          message:
            'Preview panel ids are built in one place. Use openFileInPanel({ kind: "preview" }) from utils/openFileInPanel.'
        },
        // The running preview's visibility has a single owner (§1.8). Forbid the
        // `api.preview.setVisibility` bridge call and the raw
        // `preview:setVisibility` channel everywhere except OverlayGuardService.
        {
          selector:
            "CallExpression[callee.property.name='setVisibility'][callee.object.property.name='preview'], Literal[value='preview:setVisibility']",
          message:
            'Preview visibility is owned by services/preview/OverlayGuardService. Do not call api.preview.setVisibility or reference the preview:setVisibility channel elsewhere (issue #74, design §1.8).'
        },
        {
          selector:
            "CallExpression[callee.property.name='createElement'][arguments.0.value=/^(object|embed|iframe|frame)$/i]",
          message:
            'object / embed / iframe load an SVG AS A DOCUMENT, which executes script. Use <img> (see the image-export harness boundary, #73).'
        }
      ]
    }
  }
]
