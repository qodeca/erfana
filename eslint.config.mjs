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
  // Renderer process: two families of hand-rolled string building that keep
  // reintroducing bugs.
  //
  // 1. POSIX-only path manipulation. The renderer is sandboxed (no Node `path`
  //    module) and receives paths in their NATIVE separators from the main
  //    process, so `.split('/')`-based basename/join logic silently breaks on
  //    Windows. Use the cross-platform helpers in `utils/fileUtils.ts` (itself
  //    exempt, as it owns the separator-class logic). See issue #238.
  // 2. Hand-built dockview panel ids. The id prefix and the panel component
  //    must be derived from the same kind answer or a file opens in the wrong
  //    panel type; `utils/openFileInPanel.ts` owns that (and is therefore
  //    exempt). The `preview-` prefix is issue #74's running HTML preview.
  //    See issues #70 and #74.
  // 3. The running preview's visibility. `api.preview.setVisibility` and the
  //    `preview:setVisibility` channel have exactly ONE permitted caller,
  //    `services/preview/OverlayGuardService.ts` (exempt), so the "single
  //    hide/show owner" invariant is enforced by the linter, not by convention.
  //    See issue #74 design §1.8.
  //
  // NOTE: all three families live in ONE `no-restricted-syntax` entry on
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
        }
      ]
    }
  }
]
