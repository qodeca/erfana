import pluginJs from '@eslint/js'
import pluginReact from 'eslint-plugin-react'
import * as tseslint from 'typescript-eslint'
// Use flat-config-friendly Prettier rules directly
import eslintConfigPrettier from 'eslint-config-prettier'

export default [
  // Ignore build outputs and vendored folders
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'temp/**'] },
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
  }
]
