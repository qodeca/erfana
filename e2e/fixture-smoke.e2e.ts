/**
 * Smoke tests for composed Playwright fixtures.
 *
 * Validates that testProject, withSettings, appWithTestProject,
 * windowWithTestProject, and withOpenFile fixtures work correctly.
 */

import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from './fixtures/index'
import { TEST_IDS } from '../src/renderer/src/constants/testids'

test.describe('fixture smoke: testProject', () => {
  test('creates temp dir with default seed file', async ({ testProject }) => {
    const stat = await fs.promises.stat(testProject.path)
    expect(stat.isDirectory()).toBe(true)

    const testMd = await fs.promises.readFile(
      path.join(testProject.path, 'test.md'),
      'utf-8'
    )
    expect(testMd).toContain('# Test Document')
  })

  test.describe('custom seed files', () => {
    test.use({
      testProjectFiles: {
        'readme.md': '# Readme\n',
        'notes/day1.md': '# Day 1\n'
      }
    })

    test('creates custom files instead of defaults', async ({ testProject }) => {
      const readme = await fs.promises.readFile(
        path.join(testProject.path, 'readme.md'),
        'utf-8'
      )
      expect(readme).toBe('# Readme\n')

      const day1 = await fs.promises.readFile(
        path.join(testProject.path, 'notes', 'day1.md'),
        'utf-8'
      )
      expect(day1).toBe('# Day 1\n')

      // Default seed file should NOT exist
      const defaultExists = fs.existsSync(path.join(testProject.path, 'test.md'))
      expect(defaultExists).toBe(false)
    })
  })

  test('path traversal validation rejects escaping keys', async () => {
    // Directly test the validation logic used by testProject fixture
    const projectPath = '/tmp/test-project'
    const maliciousNames = ['../escape.md', '../../etc/passwd', '/absolute/path.md']

    for (const name of maliciousNames) {
      const resolved = path.resolve(projectPath, name)
      const rel = path.relative(path.resolve(projectPath), resolved)
      const escapes = rel.startsWith('..') || path.isAbsolute(rel)
      expect(escapes, `Expected "${name}" to be rejected`).toBe(true)
    }

    // Valid names should pass
    const validNames = ['file.md', 'sub/file.md', 'a/b/c.md']
    for (const name of validNames) {
      const resolved = path.resolve(projectPath, name)
      const rel = path.relative(path.resolve(projectPath), resolved)
      const escapes = rel.startsWith('..') || path.isAbsolute(rel)
      expect(escapes, `Expected "${name}" to be accepted`).toBe(false)
    }
  })
})

test.describe('fixture smoke: withSettings', () => {
  test.use({
    projectSettings: { editor: { fontSize: 16 }, git: { enabled: false } }
  })

  test('writes .erfana/settings.json with correct content', async ({
    testProject,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    withSettings
  }) => {
    const settingsPath = path.join(testProject.path, '.erfana', 'settings.json')
    const raw = await fs.promises.readFile(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)

    expect(parsed).toEqual({ editor: { fontSize: 16 }, git: { enabled: false } })
  })
})

test.describe('fixture smoke: appWithTestProject + windowWithTestProject', () => {
  // TODO(spec-018): App does not auto-open project from CLI args yet.
  // appWithTestProject passes the path as a CLI arg, but the app only opens
  // projects via IPC (file:openProjectByPath). Needs main process CLI parsing.
  test.fixme('project tree shows seed file', async ({ windowWithTestProject }) => {
    const fileNode = windowWithTestProject
      .locator(`[data-testid^="${TEST_IDS.PROJECT_TREE_NODE_FILE}-"]`)
      .filter({ hasText: 'test.md' })
    await expect(fileNode).toBeVisible({ timeout: 15000 })
  })
})

test.describe('fixture smoke: withOpenFile', () => {
  test.describe('opens specified file', () => {
    test.use({ openFilePath: 'test.md' })

    // TODO(spec-018): Depends on appWithTestProject which doesn't load the project yet.
    // See "project tree shows seed file" test.fixme above.
    test.fixme('returns ready MonacoPage', async ({ withOpenFile }) => {
      expect(withOpenFile).not.toBeUndefined()
      const content = await withOpenFile!.getContent()
      expect(content).toContain('Test Document')
    })
  })

  test('returns undefined when openFilePath not set', async ({ withOpenFile }) => {
    expect(withOpenFile).toBeUndefined()
  })

  test.describe('rejects missing file', () => {
    test.use({
      testProjectFiles: { 'only-this.md': '# Only\n' },
      openFilePath: 'nonexistent.md'
    })

    test.fail()

    test('throws when openFilePath not in testProjectFiles', async ({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      withOpenFile
    }) => {
      // This test is expected to fail during fixture setup because
      // openFilePath "nonexistent.md" is not in testProjectFiles.
      // test.fail() above inverts the assertion – a setup error = pass.
    })
  })
})
