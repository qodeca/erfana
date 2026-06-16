// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FrontmatterTable, FrontmatterCodeBlock } from './FrontmatterTable'

describe('FrontmatterTable', () => {
  it('should render a table with key-value pairs', () => {
    const data = {
      title: 'My Document',
      author: 'John Doe',
      date: '2025-12-20'
    }

    const { container } = render(<FrontmatterTable data={data} />)

    expect(container.querySelector('.frontmatter-wrapper')).toBeTruthy()
    expect(container.querySelector('.frontmatter-table')).toBeTruthy()

    const rows = container.querySelectorAll('.frontmatter-row')
    expect(rows).toHaveLength(3)
  })

  it('should display keys and values correctly', () => {
    const data = {
      title: 'Test Title',
      version: 1.5
    }

    render(<FrontmatterTable data={data} />)

    expect(screen.getByText('title')).toBeTruthy()
    expect(screen.getByText('Test Title')).toBeTruthy()
    expect(screen.getByText('version')).toBeTruthy()
    expect(screen.getByText('1.5')).toBeTruthy()
  })

  it('should render simple arrays as inline tags', () => {
    const data = {
      tags: ['markdown', 'yaml', 'documentation']
    }

    const { container } = render(<FrontmatterTable data={data} />)

    expect(screen.getByText('tags')).toBeTruthy()
    // Check for tag elements
    const tags = container.querySelectorAll('.frontmatter-tag')
    expect(tags).toHaveLength(3)
  })

  it('should render boolean values with appropriate styling', () => {
    const data = {
      draft: true,
      published: false
    }

    const { container } = render(<FrontmatterTable data={data} />)

    const booleans = container.querySelectorAll('.frontmatter-boolean')
    expect(booleans).toHaveLength(2)
    expect(booleans[0].textContent).toBe('true')
    expect(booleans[1].textContent).toBe('false')
  })

  it('should render number values with appropriate styling', () => {
    const data = {
      count: 42,
      version: 1.5
    }

    const { container } = render(<FrontmatterTable data={data} />)

    const numbers = container.querySelectorAll('.frontmatter-number')
    expect(numbers).toHaveLength(2)
  })

  it('should render null values with appropriate styling', () => {
    const data = {
      description: null
    }

    const { container } = render(<FrontmatterTable data={data} />)

    const nullValue = container.querySelector('.frontmatter-null')
    expect(nullValue).toBeTruthy()
    expect(nullValue?.textContent).toBe('null')
  })

  it('should render nested objects recursively', () => {
    const data = {
      author: { name: 'John', email: 'john@example.com' }
    }

    const { container } = render(<FrontmatterTable data={data} />)

    // Check for nested structure
    const nested = container.querySelector('.frontmatter-nested')
    expect(nested).toBeTruthy()

    // Check nested keys are rendered
    expect(screen.getByText('name:')).toBeTruthy()
    expect(screen.getByText('John')).toBeTruthy()
    expect(screen.getByText('email:')).toBeTruthy()
    expect(screen.getByText('john@example.com')).toBeTruthy()
  })

  it('should render complex arrays with indices', () => {
    const data = {
      items: [{ name: 'Item 1' }, { name: 'Item 2' }]
    }

    const { container } = render(<FrontmatterTable data={data} />)

    // Check for array indices
    expect(screen.getByText('[0]')).toBeTruthy()
    expect(screen.getByText('[1]')).toBeTruthy()

    // Check for complex array structure
    const complexItems = container.querySelectorAll('.frontmatter-array-item-complex')
    expect(complexItems).toHaveLength(2)
  })

  it('should truncate deeply nested structures', () => {
    const data = {
      deep: {
        level1: {
          level2: {
            level3: {
              tooDeep: 'value'
            }
          }
        }
      }
    }

    const { container } = render(<FrontmatterTable data={data} />)

    // At depth 3, should show truncation indicator
    const truncated = container.querySelector('.frontmatter-truncated')
    expect(truncated).toBeTruthy()
  })

  it('should include data-line-start and data-line-end attributes', () => {
    const data = { title: 'Test' }

    const { container } = render(
      <FrontmatterTable data={data} lineStart={1} lineEnd={5} />
    )

    const wrapper = container.querySelector('.frontmatter-wrapper')
    expect(wrapper?.getAttribute('data-line-start')).toBe('1')
    expect(wrapper?.getAttribute('data-line-end')).toBe('5')
  })

  it('should use lineStart for lineEnd if lineEnd is not provided', () => {
    const data = { title: 'Test' }

    const { container } = render(<FrontmatterTable data={data} lineStart={1} />)

    const wrapper = container.querySelector('.frontmatter-wrapper')
    expect(wrapper?.getAttribute('data-line-start')).toBe('1')
    expect(wrapper?.getAttribute('data-line-end')).toBe('1')
  })

  it('should return null for empty data', () => {
    const { container } = render(<FrontmatterTable data={{}} />)

    expect(container.querySelector('.frontmatter-wrapper')).toBeFalsy()
  })

  it('should filter out undefined values', () => {
    const data = {
      title: 'Test',
      missing: undefined as unknown as string
    }

    const { container } = render(<FrontmatterTable data={data} />)

    const rows = container.querySelectorAll('.frontmatter-row')
    expect(rows).toHaveLength(1)
  })

  it('should display the frontmatter header with field count', () => {
    const data = { title: 'Test', author: 'Me', date: '2025' }

    render(<FrontmatterTable data={data} />)

    expect(screen.getByText('Frontmatter')).toBeTruthy()
    expect(screen.getByText('3 fields')).toBeTruthy()
  })

  it('should display singular "field" for single entry', () => {
    const data = { title: 'Test' }

    render(<FrontmatterTable data={data} />)

    expect(screen.getByText('1 field')).toBeTruthy()
  })

  it('should show expand button for large frontmatter (>10 entries)', () => {
    const data: Record<string, string> = {}
    for (let i = 1; i <= 15; i++) {
      data[`field${i}`] = `value${i}`
    }

    const { container } = render(<FrontmatterTable data={data} />)

    // Should show only 10 rows initially
    const rows = container.querySelectorAll('.frontmatter-row')
    expect(rows).toHaveLength(10)

    // Should have expand button
    const expandBtn = container.querySelector('.frontmatter-expand-btn')
    expect(expandBtn).toBeTruthy()
    expect(screen.getByText('Show 5 more fields')).toBeTruthy()
  })

  it('should expand/collapse when clicking expand button', () => {
    const data: Record<string, string> = {}
    for (let i = 1; i <= 15; i++) {
      data[`field${i}`] = `value${i}`
    }

    const { container } = render(<FrontmatterTable data={data} />)

    // Initially 10 rows
    expect(container.querySelectorAll('.frontmatter-row')).toHaveLength(10)

    // Click expand
    const expandBtn = container.querySelector('.frontmatter-expand-btn')!
    fireEvent.click(expandBtn)

    // Now all 15 rows visible
    expect(container.querySelectorAll('.frontmatter-row')).toHaveLength(15)
    expect(screen.getByText('Show less')).toBeTruthy()

    // Click collapse
    fireEvent.click(expandBtn)

    // Back to 10 rows
    expect(container.querySelectorAll('.frontmatter-row')).toHaveLength(10)
  })

  it('should not show expand button for small frontmatter (<=10 entries)', () => {
    const data = { title: 'Test', author: 'Me' }

    const { container } = render(<FrontmatterTable data={data} />)

    expect(container.querySelector('.frontmatter-expand-btn')).toBeFalsy()
  })

  it('should render empty array indicator', () => {
    const data = { tags: [] }

    const { container } = render(<FrontmatterTable data={data} />)

    const empty = container.querySelector('.frontmatter-empty')
    expect(empty?.textContent).toBe('[]')
  })

  it('should render empty object indicator', () => {
    const data = { meta: {} }

    const { container } = render(<FrontmatterTable data={data} />)

    const empty = container.querySelector('.frontmatter-empty')
    expect(empty?.textContent).toBe('{}')
  })
})

describe('FrontmatterCodeBlock', () => {
  it('should render raw YAML in a code block', () => {
    const rawYaml = 'invalid: yaml: syntax'

    const { container } = render(<FrontmatterCodeBlock rawYaml={rawYaml} />)

    expect(container.querySelector('.frontmatter-error-wrapper')).toBeTruthy()
    expect(container.querySelector('.frontmatter-error-code')).toBeTruthy()
    expect(screen.getByText(rawYaml)).toBeTruthy()
  })

  it('should display error header', () => {
    const rawYaml = 'bad: yaml'

    render(<FrontmatterCodeBlock rawYaml={rawYaml} />)

    expect(screen.getByText('Invalid frontmatter')).toBeTruthy()
  })

  it('should include data-line-start and data-line-end attributes', () => {
    const rawYaml = 'key: value'

    const { container } = render(
      <FrontmatterCodeBlock rawYaml={rawYaml} lineStart={1} lineEnd={3} />
    )

    const wrapper = container.querySelector('.frontmatter-error-wrapper')
    expect(wrapper?.getAttribute('data-line-start')).toBe('1')
    expect(wrapper?.getAttribute('data-line-end')).toBe('3')
  })

  it('should preserve whitespace in raw YAML', () => {
    const rawYaml = `key1: value1
  nested: value
key2: value2`

    const { container } = render(<FrontmatterCodeBlock rawYaml={rawYaml} />)

    const code = container.querySelector('.frontmatter-error-code code')
    expect(code?.textContent).toBe(rawYaml)
  })
})
