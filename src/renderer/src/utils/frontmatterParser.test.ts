// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { extractFrontmatter, formatFrontmatterValue } from './frontmatterParser'

describe('frontmatterParser', () => {
  describe('extractFrontmatter', () => {
    it('should extract valid YAML frontmatter', () => {
      const content = `---
title: My Document
author: John Doe
date: 2025-12-20
---

# Main Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        title: 'My Document',
        author: 'John Doe',
        date: '2025-12-20'
      })
      expect(result.body).toBe('\n# Main Content')
      expect(result.parseError).toBe(false)
      expect(result.frontmatterLineCount).toBe(5) // 3 YAML lines + 2 delimiters (--- lines)
    })

    it('should handle arrays in frontmatter', () => {
      const content = `---
tags:
  - markdown
  - yaml
  - documentation
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        tags: ['markdown', 'yaml', 'documentation']
      })
      expect(result.parseError).toBe(false)
    })

    it('should handle inline arrays in frontmatter', () => {
      const content = `---
tags: [one, two, three]
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        tags: ['one', 'two', 'three']
      })
    })

    it('should handle nested objects in frontmatter', () => {
      const content = `---
author:
  name: John Doe
  email: john@example.com
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        author: {
          name: 'John Doe',
          email: 'john@example.com'
        }
      })
    })

    it('should handle boolean values', () => {
      const content = `---
draft: true
published: false
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        draft: true,
        published: false
      })
    })

    it('should handle numeric values', () => {
      const content = `---
version: 1.5
count: 42
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        version: 1.5,
        count: 42
      })
    })

    it('should handle null values', () => {
      const content = `---
description: null
notes: ~
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        description: null,
        notes: null
      })
    })

    it('should return null frontmatter for content without frontmatter', () => {
      const content = `# Just a heading

Regular paragraph.`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toBeNull()
      expect(result.body).toBe(content)
      expect(result.parseError).toBe(false)
      expect(result.frontmatterLineCount).toBe(0)
    })

    it('should return null frontmatter for content with only dashes', () => {
      const content = `---

Regular paragraph.`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toBeNull()
      expect(result.body).toBe(content)
    })

    it('should handle empty frontmatter block', () => {
      // Empty frontmatter (no content between delimiters) is not detected as frontmatter
      // because there's no meaningful YAML to parse
      const content = `---
---

Content`

      const result = extractFrontmatter(content)

      // Empty frontmatter block is not matched - treated as regular content
      expect(result.frontmatter).toBeNull()
      expect(result.body).toBe(content)
      expect(result.parseError).toBe(false)
      // frontmatterLineCount stays 0, so the preview body line offset is 0 here (no off-by-one).
      expect(result.frontmatterLineCount).toBe(0)
    })

    it('counts a blank-line-only frontmatter block as exactly the lines before the body', () => {
      // This block DOES match (a blank line sits between the delimiters):
      // 1 ---, 2 (blank), 3 ---, 4 Content  -> body starts at file line 4.
      const content = `---

---
Content`

      const result = extractFrontmatter(content)

      expect(result.body).toBe('Content')
      // The body offset relies on this equalling the number of lines preceding the body (3),
      // so a body element at body-relative line 1 maps back to file line 4.
      expect(result.frontmatterLineCount).toBe(3)
    })

    it('should handle invalid YAML and set parseError', () => {
      const content = `---
invalid: yaml: syntax
  bad indentation
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toBeNull()
      expect(result.parseError).toBe(true)
      expect(result.rawFrontmatter).toContain('invalid: yaml: syntax')
      expect(result.body).toBe('\nContent')
    })

    it('should preserve raw frontmatter for error display', () => {
      const content = `---
key1: value1
key2: value2
---

Body`

      const result = extractFrontmatter(content)

      expect(result.rawFrontmatter).toBe('key1: value1\nkey2: value2')
    })

    it('should handle frontmatter with Windows line endings', () => {
      const content = '---\r\ntitle: Test\r\n---\r\n\r\nContent'

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({ title: 'Test' })
      expect(result.body).toBe('\r\nContent')
    })

    it('should handle frontmatter at end of file without trailing content', () => {
      const content = `---
title: End of file
---`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({ title: 'End of file' })
      expect(result.body).toBe('')
    })

    it('should handle special characters in values', () => {
      const content = `---
title: "Hello: World!"
emoji: "🎉"
path: "/path/to/file"
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toEqual({
        title: 'Hello: World!',
        emoji: '🎉',
        path: '/path/to/file'
      })
    })

    it('should not match dashes that are not at the start', () => {
      const content = `Some content first

---
not: frontmatter
---

More content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toBeNull()
      expect(result.body).toBe(content)
    })

    it('should handle multiline string values', () => {
      const content = `---
description: |
  This is a long
  multiline description
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter?.description).toBe('This is a long\nmultiline description\n')
    })

    it('should reject frontmatter exceeding size limit (100KB)', () => {
      // Create frontmatter larger than 100KB
      const largeValue = 'x'.repeat(101_000)
      const content = `---
large: ${largeValue}
---

Content`

      const result = extractFrontmatter(content)

      expect(result.frontmatter).toBeNull()
      expect(result.parseError).toBe(true)
      expect(result.rawFrontmatter).toContain('truncated')
      expect(result.rawFrontmatter).toContain('exceeds 100KB limit')
      expect(result.body).toBe('\nContent')
    })
  })

  describe('formatFrontmatterValue', () => {
    it('should format string values', () => {
      expect(formatFrontmatterValue('hello')).toBe('hello')
    })

    it('should format number values', () => {
      expect(formatFrontmatterValue(42)).toBe('42')
      expect(formatFrontmatterValue(3.14)).toBe('3.14')
    })

    it('should format boolean values', () => {
      expect(formatFrontmatterValue(true)).toBe('true')
      expect(formatFrontmatterValue(false)).toBe('false')
    })

    it('should format null values', () => {
      expect(formatFrontmatterValue(null)).toBe('')
    })

    it('should format arrays', () => {
      expect(formatFrontmatterValue(['one', 'two', 'three'])).toBe('one, two, three')
    })

    it('should format nested arrays', () => {
      expect(formatFrontmatterValue([['a', 'b'], ['c', 'd']])).toBe('a, b, c, d')
    })

    it('should format objects as JSON', () => {
      const obj = { name: 'John', age: 30 }
      expect(formatFrontmatterValue(obj)).toBe('{"name":"John","age":30}')
    })

    it('should handle mixed arrays', () => {
      expect(formatFrontmatterValue(['text', 42, true])).toBe('text, 42, true')
    })
  })
})
