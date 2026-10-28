// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import pluginJs from '@eslint/js'
import pluginReact from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import * as tseslint from 'typescript-eslint'
// Use flat-config-friendly Prettier rules directly
import eslintConfigPrettier from 'eslint-config-prettier'
import { readBaseline } from './scripts/lib/max-lines-baseline.mjs'

// Layer rules (project-session design, section 6). The layers are `src/main`,
// `src/preload`, `src/renderer` and `src/shared`; `shared` sits under all of
// them. A layer is matched only by climbing out to it (`../../main/x`,
// `../src/main`) or by its `@main/` style alias, via the `regex` option, so a
// sibling `./main`, a folder that merely contains the word, or a package such as
// `@electron-toolkit/preload` is never hit. Flat config replaces
// `no-restricted-imports` wholesale per matching block, so every block that
// sets it for these files must spread the right set.
//
//   * shared   imports nothing from main, renderer, preload or electron;
//   * renderer imports nothing from main, and only TYPES from preload/index;
//   * main     imports nothing from renderer or preload;
//   * preload  imports nothing from renderer. preload -> main is left open on
//     purpose: previewPage.contract.test.ts imports main values.
const LAYER_MESSAGE = 'Layer rule: '
const layerRegex = (layer, suffix = '(/|$)') => `^((\\.\\./)+(src/)?|@)${layer}${suffix}`
const layerPattern = (layer, who) => ({
  regex: layerRegex(layer),
  message: `${LAYER_MESSAGE}${who} must not import from src/${layer}.`
})
const ELECTRON_IPCMAIN_MESSAGE =
  'Register global IPC through src/main/ipc/registry.ts (registerHandle / registerOn / …) so every channel is gated on the app renderer. Importing ipcMain directly bypasses that gate.'
const SHARED_LAYER_PATTERNS = [
  layerPattern('main', 'src/shared'),
  layerPattern('renderer', 'src/shared'),
  layerPattern('preload', 'src/shared'),
  { group: ['electron/*'], message: `${LAYER_MESSAGE}src/shared must not import electron.` }
]
const MAIN_LAYER_PATTERNS = [
  layerPattern('renderer', 'src/main'),
  layerPattern('preload', 'src/main')
]
const GATEWAY_MESSAGE =
  'Reach the preload bridges through their gateway in services/ (fileGateway, gitGateway, …), not window.api.'
// Every way to reach `window.api` outside a gateway. The renderer's `window.api`
// type already lists only the bridges the TerminalPanel files still read (see
// preload/index.d.ts); these selectors are the backstop for the ways round it.
const GLOBAL_OBJECTS = '/^(window|globalThis|self)$/'
const WINDOW_API = `MemberExpression[computed=false][object.name=${GLOBAL_OBJECTS}][property.name='api']`
// Where the global sits in a destructure's source: bare, or under one or two
// casts (`as`, `!`, `satisfies`, `<T>`), each of which keeps it in `.expression`
const GLOBAL_SOURCE_PATHS = ['name', 'expression.name', 'expression.expression.name']
// The `api` key of a destructure, as an identifier or a string. Tied to the
// global on the right: a bare `{ api }` is everyday code (`const { api } = props`)
const API_PROPERTY = "Property:matches([key.name='api'], [key.value='api'])"
const DESTRUCTURE_API_SELECTORS = GLOBAL_SOURCE_PATHS.flatMap((path) => [
  // const { api } = window
  `VariableDeclarator[init.${path}=${GLOBAL_OBJECTS}] > ObjectPattern.id > ${API_PROPERTY}`,
  // ({ api } = window)
  `AssignmentExpression[right.${path}=${GLOBAL_OBJECTS}] > ObjectPattern.left > ${API_PROPERTY}`,
  // ({ api } = window) => …, a default value in a parameter or a nested pattern
  `AssignmentPattern[right.${path}=${GLOBAL_OBJECTS}] > ObjectPattern.left > ${API_PROPERTY}`
]).map((selector) => ({ selector, message: GATEWAY_MESSAGE }))
const RENDERER_API_BYPASS_SELECTORS = [
  {
    // window['api'], globalThis[k], self[k]
    selector: `MemberExpression[computed=true][object.name=${GLOBAL_OBJECTS}]`,
    message: GATEWAY_MESSAGE
  },
  {
    // (window as X).api, (<X>window).api
    selector:
      "MemberExpression[property.name='api'][object.type=/^TS(AsExpression|NonNullExpression|SatisfiesExpression|TypeAssertion)$/]",
    message: GATEWAY_MESSAGE
  },
  ...DESTRUCTURE_API_SELECTORS
]
const RENDERER_GATEWAY_SELECTORS = [
  // window.api, window?.api, globalThis.api, self.api: read, aliased or destructured
  { selector: WINDOW_API, message: GATEWAY_MESSAGE },
  ...RENDERER_API_BYPASS_SELECTORS
]

// TEMPORARY. These files still read two bridges off `window.api` (screenshot in
// useScreenshotCapture, utils in the unused useTerminalDragDrop), so they keep
// exactly those reads until they move to screenshotGateway and utilsGateway.
// Any other read, an alias of `window.api` or a computed key is still an error
// here. Delete this list, its selectors and its block below once they have moved.
const RENDERER_TERMINAL_PANEL_FILES = [
  'src/renderer/src/components/Panels/TerminalPanel/hooks/useScreenshotCapture.ts',
  'src/renderer/src/components/Panels/TerminalPanel/hooks/useTerminalDragDrop.ts'
]
const TERMINAL_PANEL_BRIDGES = ['utils', 'screenshot']
const RENDERER_TERMINAL_PANEL_SELECTORS = [
  {
    selector: `${WINDOW_API}:not(MemberExpression[property.name=/^(${TERMINAL_PANEL_BRIDGES.join('|')})$/] > .object)`,
    message: GATEWAY_MESSAGE
  },
  ...RENDERER_API_BYPASS_SELECTORS
]

// Where the renderer may stand in for the bridges: tests install mocks on `window.api`
const RENDERER_TEST_FILES = [
  'src/renderer/**/*.test.{ts,tsx}',
  'src/renderer/**/__test__/**',
  'src/renderer/**/__tests__/**',
  'src/renderer/**/__test-utils__/**',
  'src/renderer/**/test-utils/**'
]

// Files that own a pattern the shared selectors ban (see the block comment below)
const RENDERER_PATTERN_OWNERS = [
  'src/renderer/src/utils/fileUtils.ts',
  'src/renderer/src/utils/openFileInPanel.ts',
  'src/renderer/src/services/preview/OverlayGuardService.ts'
]

// The only files that read the bridges off `window.api`: the gateways, and the
// presence check that answers only whether a bridge is there
const RENDERER_GATEWAY_FILES = [
  'src/renderer/src/services/fileGateway.ts',
  'src/renderer/src/services/terminalGateway.ts',
  'src/renderer/src/services/fileWatchGateway.ts',
  'src/renderer/src/services/directoryWatchGateway.ts',
  'src/renderer/src/services/gitGateway.ts',
  'src/renderer/src/services/settingsGateway.ts',
  'src/renderer/src/services/loggingGateway.ts',
  'src/renderer/src/services/quitGateway.ts',
  'src/renderer/src/services/systemGateway.ts',
  'src/renderer/src/services/clipboardGateway.ts',
  'src/renderer/src/services/testHooksGateway.ts',
  'src/renderer/src/services/importGateway.ts',
  'src/renderer/src/services/transcriptionGateway.ts',
  'src/renderer/src/services/cameraGateway.ts',
  'src/renderer/src/services/documentExportGateway.ts',
  'src/renderer/src/services/imageExportGateway.ts',
  'src/renderer/src/services/browserGateway.ts',
  'src/renderer/src/services/markdownImageGateway.ts',
  'src/renderer/src/services/previewGateway.ts',
  'src/renderer/src/services/claudeStatusGateway.ts',
  'src/renderer/src/services/screenshotGateway.ts',
  'src/renderer/src/services/utilsGateway.ts',
  'src/renderer/src/services/bridgePresence.ts'
]

// Selectors every renderer file obeys; the gateway selectors are added on top for non-test code.
const RENDERER_RESTRICTED_SYNTAX = [
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
  // `setVisibility` call on the preview gateway or bridge and the raw
  // `preview:setVisibility` channel everywhere except OverlayGuardService.
  {
    selector:
      "CallExpression[callee.property.name='setVisibility'][callee.object.property.name='preview'], CallExpression[callee.property.name='setVisibility'][callee.object.name='previewGateway'], Literal[value='preview:setVisibility']",
    message:
      'Preview visibility is owned by services/preview/OverlayGuardService. Do not call previewGateway.setVisibility (or api.preview.setVisibility) or reference the preview:setVisibility channel elsewhere (issue #74, design §1.8).'
  },
  {
    selector:
      "CallExpression[callee.property.name='createElement'][arguments.0.value=/^(object|embed|iframe|frame)$/i]",
    message:
      'object / embed / iframe load an SVG AS A DOCUMENT, which executes script. Use <img> (see the image-export harness boundary, #73).'
  }
]

const PRELOAD_LAYER_PATTERNS = [layerPattern('renderer', 'src/preload')]
// The renderer reaches the preload only through `window.api`; a type-only
// import of `preload/index` is the one allowed link. Two patterns do it: the
// first bans every preload file except `index`, the second matches ONLY
// `preload` and `preload/index`, carries `allowTypeImports`, and so bans value
// imports of those two while letting type imports through. (typescript-eslint exempts a
// type-only import when ANY `allowTypeImports` pattern matches it, so
// `preload/x` stays banned for types too because the second pattern misses it.
// Known limit: the image-export harness's `../*` group also has
// `allowTypeImports`, so a type-only import of main slips through there. Value
// imports are caught.)
const RENDERER_PRELOAD_MESSAGE = `${LAYER_MESSAGE}src/renderer may only \`import type\` from src/preload/index.`
const RENDERER_LAYER_PATTERNS = [
  layerPattern('main', 'src/renderer'),
  { regex: layerRegex('preload', '/(?!index$)'), message: RENDERER_PRELOAD_MESSAGE },
  {
    regex: layerRegex('preload', '(/index)?$'),
    allowTypeImports: true,
    message: RENDERER_PRELOAD_MESSAGE
  }
]

// Every way an e2e file can reach `executeJavaScript` without the bounded
// helper (lens review finding 34) – see the `e2e/**` block below.
const E2E_EXECUTE_JAVASCRIPT_MESSAGE =
  'Unbounded executeJavaScript can hang a test forever. Use the bounded exec from e2e/utils/bounded-exec.ts (installBoundedExec + globalThis.__erfanaE2eExec).'
const E2E_EXECUTE_JAVASCRIPT_SELECTORS = [
  'MemberExpression[property.name=/^executeJavaScript/]',
  'MemberExpression[computed=true][property.value=/^executeJavaScript/]',
  "MemberExpression[computed=true][property.type='TemplateLiteral'][property.quasis.0.value.raw=/^executeJavaScript/]",
  'ObjectPattern > Property[key.name=/^executeJavaScript/]',
  'ObjectPattern > Property[key.value=/^executeJavaScript/]'
].map((selector) => ({ selector, message: E2E_EXECUTE_JAVASCRIPT_MESSAGE }))

// The max-lines ratchet (docs/technical-debt.md #26): a source file may shrink,
// never grow. Every non-test `src/**/*.{ts,tsx}` is held to the baseline's
// `limit` (pinned to 500); each file that was already over it is held to its
// own size, from scripts/max-lines-baseline.json, read and validated by
// scripts/lib/max-lines-baseline.mjs. scripts/check-max-lines.mjs (run by
// `npm run lint`) counts every covered file itself too, so an inline directive
// that switches this rule off cannot let a file grow, and keeps the list
// current: it fails when a file shrinks and its allowance is not lowered, and
// `npm run lint:max-lines -- --update` lowers it.
// The rule must be "error": `eslint .` exits 0 on warnings. `e2e/` and
// `scripts/` are not covered yet. The ignores mirror `isCovered()` in the check
// script, and scripts/eslint-max-lines.test.mjs proves the two agree.
const MAX_LINES_BASELINE = readBaseline(import.meta.dirname)
const MAX_LINES_FILES = ['src/**/*.{ts,tsx}']
const MAX_LINES_IGNORES = [
  '**/*.test.{ts,tsx}',
  '**/__test__/**',
  '**/__tests__/**',
  '**/__test-helpers__/**',
  '**/__test-utils__/**',
  '**/test-utils/**',
  '**/__fixtures__/**',
  '**/*.d.ts'
]

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
      // docs/design-system/claims.js is GENERATED (scripts/design-sync.mjs) and runs in a
      // browser over file://, so it uses `window`/`document` and would fail
      // `no-undef` under this Node-flavoured config. It is not hand-edited and
      // it is not shipped. What actually guards it: `npm run design -- --check`
      // fails when it is stale, and scripts/design-claims.test.mjs re-derives
      // every value in it on each CI run. The authored cards' JS is inline in
      // HTML, which ESLint does not read either — CSS in docs/design-system/ is covered by
      // stylelint via postcss-html.
      'docs/design-system/claims.js',
      // Scratch project trees Playwright creates per e2e run. Already in
      // .gitignore, but ESLint reads the working tree, not the index: on
      // Windows a teardown can fail with EBUSY (the app still holds a handle),
      // and the surviving fixtures — plain browser scripts, not app source —
      // then fail `no-undef` on `document`/`window` and break `npm run lint`
      // for reasons unrelated to any change.
      '.e2e-temp/**',
      // Xezar pipeline: the kit's own scripts (.xezar/), the per-machine skill
      // installs (.agents/, .claude/skills/xez-*) and local working state (.local/).
      // None of it is app source.
      '.xezar/**',
      '.agents/**',
      '.claude/**',
      '.local/**',
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
  // React hooks (renderer only). Every rule of the plugin's v7 preset is an
  // error, including `exhaustive-deps` and the React-Compiler-derived rules the
  // preset ships as errors or warnings (lens review [19]: the warnings were
  // fixed in #368 and its follow-up, so a new one now fails lint instead of
  // piling up). A justified exception is a targeted
  // `eslint-disable-next-line <rule> -- <reason>` at the site.
  {
    ...reactHooks.configs.flat.recommended,
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: Object.fromEntries(
      Object.keys(reactHooks.configs.flat.recommended.rules).map((rule) => [rule, 'error'])
    )
  },
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
  // E2E suite: no direct `executeJavaScript` (lens review finding 34).
  // `webContents.executeJavaScript` / `WebFrameMain.executeJavaScript` have no
  // timeout, and a call whose document is replaced under it can stay pending
  // forever, stalling the caller's poll past its deadline with no word about
  // which call hung (#255). Every call goes through the bounded helper in
  // e2e/utils/bounded-exec.ts, the one file exempt here. No other block sets
  // `no-restricted-syntax` for `e2e/**`, so this list is complete for it.
  //
  // The selectors ban the REFERENCE, not just the call, so an alias
  // (`const run = wc.executeJavaScript`), `.call` / `.bind` and a destructure
  // (`const { executeJavaScript } = wc`) are caught too: member access in dot,
  // string and template form, and a destructured key in either form. Matches
  // `executeJavaScriptInIsolatedWorld` as well.
  {
    files: ['e2e/**/*.{ts,js,cjs,mjs}'],
    ignores: ['e2e/utils/bounded-exec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...E2E_EXECUTE_JAVASCRIPT_SELECTORS]
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
  // Documentation capture (#138, AC4): condition-based waits only. A fixed
  // sleep makes a screenshot of whatever state the app happens to be in; the
  // scenes wait on the PTY stream, the Stop hook's file, the DOM or two
  // identical screenshots instead (scripts/capture/lib/). No other block sets
  // `no-restricted-properties` for these files.
  {
    files: ['scripts/capture/**/*.{ts,mjs,js}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'waitForTimeout',
          message: 'No fixed waits in the capture (#138 AC4). Wait on a condition: the PTY stream, a locator, a file, or a stable screenshot.'
        }
      ]
    }
  },
  // Shared code is imported by every process, so it may not import any of them
  // (nor electron). Its own block: no other block matches `src/shared/**`.
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: `${LAYER_MESSAGE}src/shared must not import electron.`
            }
          ],
          patterns: SHARED_LAYER_PATTERNS
        }
      ]
    }
  },
  // Renderer layer rule. MUST stay before the imageExport block below: both set
  // `@typescript-eslint/no-restricted-imports` for the harness folder, the later
  // block wins, and it re-states these patterns.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: RENDERER_LAYER_PATTERNS }]
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
            ...RENDERER_LAYER_PATTERNS,
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
  // NOTE: `no-restricted-imports` is set for `e2e/**`, `src/shared/**`,
  // `src/renderer/**` (and its `imageExport/**` folder) and `src/preload/**`
  // elsewhere in this file. None overlaps `src/main/**`, so this block is safe.
  // Flat config REPLACES a rule rather than merging it, so the only second block
  // that sets it for main-process files is the one right below, which covers
  // exactly the files this one ignores and sets nothing but the layer patterns.
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
              message: ELECTRON_IPCMAIN_MESSAGE
            },
            {
              name: 'electron/main',
              importNames: ['ipcMain'],
              allowTypeImports: true,
              message: ELECTRON_IPCMAIN_MESSAGE
            }
          ],
          patterns: MAIN_LAYER_PATTERNS
        }
      ]
    }
  },
  // The files the block above ignores still obey the layer rules: only the
  // `ipcMain` path is dropped for them. Safe as a second setter because the two
  // blocks' file sets are disjoint (this one is exactly the other's `ignores`).
  {
    files: ['src/main/ipc/registry.ts', 'src/main/**/*.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: MAIN_LAYER_PATTERNS }]
    }
  },
  // Preload: nothing from the renderer. preload -> main is open on purpose (see
  // the layer notes at the top of this file).
  {
    files: ['src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: PRELOAD_LAYER_PATTERNS }]
    }
  },
  // Every URL handed to the OS goes through `openExternalSafe()`, which checks it
  // against the one allowlist. Syntax selectors rather than an import ban, so an
  // alias (`import { shell as s }`, `const sh = shell`), a namespace access
  // (`electron.shell.openExternal`) or a destructure cannot get round it. Its own
  // block, with no `ignores` for registry.ts, so nothing in src/main is exempt
  // except the one module. `deps.openExternal` (an injected dependency, not the
  // Electron call) is the only receiver left alone. Tests are exempt: they mock
  // the call by name.
  {
    files: ['src/main/**/*.ts'],
    ignores: [
      'src/main/utils/openExternalSafe.ts',
      'src/main/**/*.test.ts',
      'src/main/**/__test-helpers__/**'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='openExternal'][object.name!='deps']",
          message:
            'Open external URLs through openExternalSafe() in src/main/utils/openExternalSafe.ts, the only module that calls openExternal. It checks the URL against the one allowlist first.'
        },
        {
          selector: "MemberExpression[computed=true][property.value='openExternal']",
          message:
            'Open external URLs through openExternalSafe() in src/main/utils/openExternalSafe.ts, the only module that calls openExternal.'
        },
        {
          selector: "ObjectPattern > Property[key.name='openExternal']",
          message:
            'Do not destructure openExternal. Use openExternalSafe() from src/main/utils/openExternalSafe.ts.'
        },
        {
          selector: "ImportSpecifier[imported.name='shell'][local.name!='shell']",
          message:
            'Do not alias the electron shell. Use openExternalSafe() from src/main/utils/openExternalSafe.ts for external URLs.'
        },
        {
          selector: "VariableDeclarator[init.name='shell']",
          message:
            'Do not alias the electron shell. Use openExternalSafe() from src/main/utils/openExternalSafe.ts for external URLs.'
        },
        {
          selector: "VariableDeclarator > MemberExpression.init[property.name='shell']",
          message:
            'Do not alias the electron shell. Use openExternalSafe() from src/main/utils/openExternalSafe.ts for external URLs.'
        },
        // Paths are checked with src/main/ipc/confinement, never by a string prefix. The one
        // permitted prefix test lives there and builds its argument from a variable.
        {
          selector:
            "CallExpression[callee.property.name='startsWith'][arguments.0.type='MemberExpression'][arguments.0.property.name=/^(projectPath|projectRoot)$/]",
          message: 'Confine paths with src/main/ipc/confinement, never a string prefix.'
        },
        {
          selector:
            "CallExpression[callee.property.name='startsWith'][arguments.0.name=/^(projectPath|projectRoot|resolvedRoot|realRoot)$/]",
          message: 'Confine paths with src/main/ipc/confinement, never a string prefix.'
        },
        {
          selector:
            "CallExpression[callee.property.name='startsWith'][arguments.0.type='BinaryExpression'][arguments.0.left.name=/^(projectPath|projectRoot|resolvedRoot|realRoot)$/]",
          message: 'Confine paths with src/main/ipc/confinement, never a string prefix.'
        },
        {
          selector:
            "CallExpression[callee.property.name='startsWith'][arguments.0.type='BinaryExpression'][arguments.0.left.property.name=/^(projectPath|projectRoot)$/]",
          message: 'Confine paths with src/main/ipc/confinement, never a string prefix.'
        },
        {
          selector:
            "CallExpression[callee.property.name='startsWith'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.0.name=/^(projectPath|projectRoot|resolvedRoot|realRoot)$/]",
          message: 'Confine paths with src/main/ipc/confinement, never a string prefix.'
        },
        // Only the native resolver: the plain JS `realpathSync` keeps `subst` drives, the
        // typed letter case and UNC folder case on Windows, so a prefix compare on it fails.
        // `fs.promises.realpath` and `realpathSync.native` are both native.
        {
          selector: "CallExpression[callee.name='realpathSync']",
          message:
            'Use fs.promises.realpath or realpathSync.native: the plain realpathSync does not canonicalise Windows paths.'
        },
        {
          selector: "CallExpression[callee.property.name='realpathSync']",
          message:
            'Use fs.promises.realpath or realpathSync.native: the plain realpathSync does not canonicalise Windows paths.'
        }
      ]
    }
  },
  // The same native-realpath rule for the main-process tests: on Windows the plain
  // `realpathSync` keeps 8.3 short names (RUNNER~1), so a path built from it does not
  // match the canonical one the code under test compares against.
  {
    files: ['src/main/**/*.test.ts', 'src/main/**/__test-helpers__/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='realpathSync']",
          message: 'Use fs.promises.realpath or realpathSync.native in tests too.'
        },
        {
          selector: "CallExpression[callee.property.name='realpathSync']",
          message: 'Use fs.promises.realpath or realpathSync.native in tests too.'
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
  // 3. The running preview's visibility. `previewGateway.setVisibility` (and
  //    `api.preview.setVisibility`) and the `preview:setVisibility` channel
  //    have exactly ONE permitted caller, `services/preview/OverlayGuardService.ts`
  //    (exempt), so the "single hide/show owner" invariant is enforced by the
  //    linter, not by convention. See issue #74 design §1.8.
  // 4. Creating an `object` / `embed` / `iframe` element. Those load an SVG AS
  //    A DOCUMENT, which executes script — the one route the image-export
  //    harness (#73) must never acquire. The selector lives HERE rather than in
  //    the harness-scoped block below because this block owns
  //    `no-restricted-syntax`, and a second declaration of the rule would
  //    silently disable these selectors for whichever files it matched. No
  //    renderer code creates those elements today.
  //
  // NOTE: flat config replaces a rule wholesale rather than merging, so every
  // block below sets the COMPLETE `no-restricted-syntax` list for the files it
  // matches: the shared families above, plus the gateway selectors where they
  // apply. A block that listed only one set would silently disable the other.
  //
  // 5. Reading `window.api` at all. Every bridge has a gateway in `services/`,
  //    and only the gateways (and the yes/no presence check) read `window.api`.
  //    The renderer's `window.api` type already leaves the bridges out; the
  //    gateway selectors catch the ways round the type. Tests may install
  //    mocks; the gateways read them.
  //
  //  - ordinary renderer code: shared families + gateway selectors
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: [
      ...RENDERER_PATTERN_OWNERS,
      ...RENDERER_TEST_FILES,
      ...RENDERER_GATEWAY_FILES,
      ...RENDERER_TERMINAL_PANEL_FILES
    ],
    rules: {
      'no-restricted-syntax': ['error', ...RENDERER_GATEWAY_SELECTORS, ...RENDERER_RESTRICTED_SYNTAX]
    }
  },
  //  - TEMPORARY, the TerminalPanel files: shared families + gateway selectors
  //    that still let them read their two bridges (see RENDERER_TERMINAL_PANEL_FILES)
  {
    files: RENDERER_TERMINAL_PANEL_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...RENDERER_TERMINAL_PANEL_SELECTORS, ...RENDERER_RESTRICTED_SYNTAX]
    }
  },
  //  - tests and their helpers: shared families only
  {
    files: RENDERER_TEST_FILES,
    ignores: RENDERER_PATTERN_OWNERS,
    rules: {
      'no-restricted-syntax': ['error', ...RENDERER_RESTRICTED_SYNTAX]
    }
  },
  //  - the gateways: shared families only
  {
    files: RENDERER_GATEWAY_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...RENDERER_RESTRICTED_SYNTAX]
    }
  },
  //  - the files that own a banned pattern: gateway selectors only
  {
    files: RENDERER_PATTERN_OWNERS,
    rules: {
      'no-restricted-syntax': ['error', ...RENDERER_GATEWAY_SELECTORS]
    }
  },
  // HTML Preview comments render page and file text, so raw HTML is banned there
  // (docs/designs/html-preview-comments.md SEC-25). A separate rule from
  // `no-restricted-syntax`, so it adds to the blocks above instead of replacing them.
  {
    files: ['src/renderer/src/components/Panels/HtmlPreviewPanel/comments/**/*.{ts,tsx}'],
    rules: {
      'react/no-danger': 'error'
    }
  },
  // The max-lines ratchet (see MAX_LINES_BASELINE above). Last, so nothing
  // after them can reset the rule; each baseline block replaces the base limit
  // for its one file, because a later block's rule options win.
  {
    files: MAX_LINES_FILES,
    ignores: MAX_LINES_IGNORES,
    rules: { 'max-lines': ['error', { max: MAX_LINES_BASELINE.limit }] }
  },
  ...Object.entries(MAX_LINES_BASELINE.files).map(([file, max]) => ({
    files: [file],
    rules: { 'max-lines': ['error', { max }] }
  }))
]
