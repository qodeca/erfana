import pluginJs from '@eslint/js'
import pluginReact from 'eslint-plugin-react'
import * as tseslint from 'typescript-eslint'
import prettier from '@electron-toolkit/eslint-config-prettier'

export default [
  { files: ['**/*.{js,mjs,cjs,ts,jsx,tsx}'] },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_'
        }
      ],
      'react/react-in-jsx-scope': 'off'
    }
  }
]
