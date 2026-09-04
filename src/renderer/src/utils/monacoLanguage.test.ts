// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { getMonacoLanguage } from './monacoLanguage'

describe('getMonacoLanguage', () => {
  it.each([
    ['index.html', 'html'],
    ['page.htm', 'html'],
    ['doc.xhtml', 'html'],
    ['styles.css', 'css'],
    ['styles.scss', 'scss'],
    ['styles.less', 'less'],
    ['app.js', 'javascript'],
    ['app.mjs', 'javascript'],
    ['app.cjs', 'javascript'],
    ['app.jsx', 'javascript'],
    ['app.ts', 'typescript'],
    ['app.mts', 'typescript'],
    ['app.cts', 'typescript'],
    ['app.tsx', 'typescript'],
    ['data.json', 'json'],
    ['tsconfig.jsonc', 'json'],
    ['feed.xml', 'xml'],
    ['icon.svg', 'xml'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['readme.md', 'markdown'],
    ['readme.markdown', 'markdown']
  ])('maps %s to %s', (path, expected) => {
    expect(getMonacoLanguage(path)).toBe(expected)
  })

  it('defaults an unknown extension to markdown', () => {
    expect(getMonacoLanguage('archive.zip')).toBe('markdown')
    expect(getMonacoLanguage('binary.exe')).toBe('markdown')
  })

  it('defaults a path with no extension to markdown', () => {
    expect(getMonacoLanguage('Makefile')).toBe('markdown')
    expect(getMonacoLanguage('/Users/name/notes')).toBe('markdown')
  })

  it('treats a leading-dot dotfile as having no extension', () => {
    expect(getMonacoLanguage('.gitignore')).toBe('markdown')
  })

  it('is case-insensitive on the extension', () => {
    expect(getMonacoLanguage('INDEX.HTML')).toBe('html')
    expect(getMonacoLanguage('App.TS')).toBe('typescript')
    expect(getMonacoLanguage('Data.JSON')).toBe('json')
  })

  it('resolves the extension from a Windows-separated path', () => {
    expect(getMonacoLanguage('C:\\Users\\name\\site\\index.html')).toBe('html')
    expect(getMonacoLanguage('C:\\project\\src\\main.ts')).toBe('typescript')
  })

  it('uses the extension of the final segment for a POSIX path', () => {
    expect(getMonacoLanguage('/var/www/site/styles.css')).toBe('css')
  })
})
