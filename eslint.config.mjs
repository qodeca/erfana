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
      'coverage/**'
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
  // Renderer process: ban POSIX-only path manipulation. The renderer is
  // sandboxed (no Node `path` module) and receives paths in their NATIVE
  // separators from the main process, so `.split('/')`-based basename/join
  // logic silently breaks on Windows. Use the cross-platform helpers in
  // `utils/fileUtils.ts` instead (which is itself exempt, as it owns the
  // separator-class logic). See issue #238.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['src/renderer/src/utils/fileUtils.ts'],
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
        }
      ]
    }
  }
]
