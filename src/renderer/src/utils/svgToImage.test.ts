// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { convertMermaidDiagramsToImages } from './svgToImage'
import { DOCX_EXPORT } from '../../../shared/constants'

/**
 * Comprehensive tests for SVG to PNG conversion for DOCX export
 *
 * Tests cover:
 * - Input validation (null, detached elements)
 * - Single and multiple diagram conversions
 * - Dimension scaling (width/height constraints)
 * - Failure handling (missing SVGs, zero dimensions)
 * - SVG namespace handling
 * - Canvas/Image operations
 * - Memory cleanup
 * - DOM cloning behavior
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

// Constants used in the source
const MAX_DIAGRAM_WIDTH = DOCX_EXPORT.MAX_DIAGRAM_WIDTH_PX   // 650px
const MAX_DIAGRAM_HEIGHT = DOCX_EXPORT.MAX_DIAGRAM_HEIGHT_PX // 744px
const RESOLUTION_SCALE = DOCX_EXPORT.PNG_RESOLUTION_SCALE     // 2.5

// Mock factories for DOM elements

interface MockSVGOptions {
  width: number
  height: number
  hasXmlns?: boolean
  hasXmlnsXlink?: boolean
}

/**
 * Creates a mock SVG element with getBoundingClientRect
 */
function createMockSVG(options: MockSVGOptions): SVGSVGElement {
  const { width, height, hasXmlns = false, hasXmlnsXlink = false } = options

  const attributes = new Map<string, string>()
  if (hasXmlns) attributes.set('xmlns', 'http://www.w3.org/2000/svg')
  if (hasXmlnsXlink) attributes.set('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  const cloneAttributes = new Map(attributes)

  const svg = {
    getBoundingClientRect: vi.fn(() => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() { return {} }
    })),
    hasAttribute: vi.fn((attr: string) => attributes.has(attr)),
    setAttribute: vi.fn((attr: string, value: string) => {
      attributes.set(attr, value)
    }),
    cloneNode: vi.fn(() => {
      const clone = {
        ...svg,
        hasAttribute: vi.fn((attr: string) => cloneAttributes.has(attr)),
        setAttribute: vi.fn((attr: string, value: string) => {
          cloneAttributes.set(attr, value)
        }),
        cloneNode: vi.fn(() => clone)
      }
      return clone
    }),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => [])
  }

  return svg as unknown as SVGSVGElement
}

interface DiagramConfig {
  width: number
  height: number
  hasSvg?: boolean
  hasDiagramWrapper?: boolean
}

/**
 * Creates a mock container with Mermaid diagram wrappers
 */
function createMockContainer(diagrams: DiagramConfig[]): Element {
  const mermaidWrappers = diagrams.map(config => {
    const { width, height, hasSvg = true, hasDiagramWrapper = true } = config

    const svg = hasSvg ? createMockSVG({ width, height }) : null

    const diagramEl = {
      querySelector: vi.fn((selector: string) => {
        if (selector === 'svg') return svg
        return null
      })
    }

    const wrapper = {
      querySelector: vi.fn((selector: string) => {
        if (selector === '.mermaid-diagram') {
          return hasDiagramWrapper ? diagramEl : null
        }
        if (selector === 'svg') return svg
        return null
      }),
      remove: vi.fn(),
      replaceWith: vi.fn()
    }

    return wrapper
  })

  const clonedWrappers = mermaidWrappers.map(wrapper => ({
    ...wrapper,
    remove: vi.fn(),
    replaceWith: vi.fn()
  }))

  let innerHTML = '<div>mock content</div>'

  const container = {
    ownerDocument: document,
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === '.mermaid-wrapper') {
        return mermaidWrappers as unknown as NodeListOf<Element>
      }
      return [] as unknown as NodeListOf<Element>
    }),
    querySelector: vi.fn(() => null),
    cloneNode: vi.fn(() => ({
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '.mermaid-wrapper') {
          return clonedWrappers as unknown as NodeListOf<Element>
        }
        return [] as unknown as NodeListOf<Element>
      }),
      get innerHTML() { return innerHTML },
      set innerHTML(value: string) { innerHTML = value }
    })),
    get innerHTML() { return innerHTML },
    set innerHTML(value: string) { innerHTML = value }
  }

  return container as unknown as Element
}

// Global mocks

interface MockImage {
  onload: ((this: HTMLImageElement, ev: Event) => any) | null
  onerror: ((this: HTMLImageElement, ev: string | Event) => any) | null
  src: string
  width: number
  height: number
}

let mockImages: MockImage[] = []
let mockCanvas: any = null
let mockContext: any = null
let mockXMLSerializer: any = null

/**
 * Setup global DOM API mocks
 */
function setupGlobalMocks() {
  // Reset arrays
  mockImages = []

  // Mock Image constructor - creates new instance each time
  global.Image = vi.fn(() => {
    const img: MockImage = {
      onload: null,
      onerror: null,
      src: '',
      width: 0,
      height: 0
    }
    mockImages.push(img)
    return img as any
  }) as any

  // Mock canvas context
  mockContext = {
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn()
  }

  // Mock canvas - track width/height before cleanup
  let _width = 0
  let _height = 0
  mockCanvas = {
    get width() { return _width },
    set width(val: number) { _width = val },
    get height() { return _height },
    set height(val: number) { _height = val },
    getContext: vi.fn(() => mockContext),
    toDataURL: vi.fn(() => 'data:image/png;base64,mock-png-data')
  }

  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'canvas') return mockCanvas
    if (tagName === 'img') {
      return {
        src: '',
        alt: '',
        width: 0,
        height: 0
      } as HTMLImageElement
    }
    return originalCreateElement(tagName)
  })

  // Mock XMLSerializer
  mockXMLSerializer = {
    serializeToString: vi.fn(() => '<svg></svg>')
  }
  global.XMLSerializer = vi.fn(() => mockXMLSerializer) as any

  // Mock btoa/atob
  global.btoa = vi.fn((str: string) => Buffer.from(str, 'binary').toString('base64'))
  global.atob = vi.fn((str: string) => Buffer.from(str, 'base64').toString('binary'))
}

/**
 * Cleanup global mocks
 */
function cleanupGlobalMocks() {
  vi.restoreAllMocks()
  mockImages = []
  mockCanvas = null
  mockContext = null
  mockXMLSerializer = null
}

/**
 * Simulate successful image load - triggers immediately (not async)
 */
function triggerImageLoad() {
  // Find the next image waiting to load
  const img = mockImages.find(i => i.onload !== null && i.src !== '')
  if (img && img.onload) {
    img.onload.call(img as any, new Event('load'))
  }
}

/**
 * Simulate image load error
 */
function triggerImageError(message = 'Failed to load') {
  const img = mockImages.find(i => i.onerror !== null && i.src !== '')
  if (img && img.onerror) {
    img.onerror.call(img as any, message)
  }
}

describe('convertMermaidDiagramsToImages', () => {
  beforeEach(() => {
    setupGlobalMocks()
  })

  afterEach(() => {
    cleanupGlobalMocks()
  })

  describe('input validation', () => {
    it('throws for null container', async () => {
      await expect(
        convertMermaidDiagramsToImages(null as any)
      ).rejects.toThrow('Container must be a valid DOM element attached to a document')
    })

    it('throws for undefined container', async () => {
      await expect(
        convertMermaidDiagramsToImages(undefined as any)
      ).rejects.toThrow('Container must be a valid DOM element attached to a document')
    })

    it('throws for element without ownerDocument', async () => {
      const detachedElement = {
        ownerDocument: null,
        querySelectorAll: vi.fn(() => [])
      } as unknown as Element

      await expect(
        convertMermaidDiagramsToImages(detachedElement)
      ).rejects.toThrow('Container must be a valid DOM element attached to a document')
    })
  })

  describe('no diagrams', () => {
    it('returns original HTML when no .mermaid-wrapper found', async () => {
      const container = createMockContainer([])

      const result = await convertMermaidDiagramsToImages(container)

      expect(result).toEqual({
        html: container.innerHTML,
        totalDiagrams: 0,
        failedDiagrams: 0
      })
    })

    it('does not call Image or canvas APIs when no diagrams present', async () => {
      const container = createMockContainer([])

      await convertMermaidDiagramsToImages(container)

      expect(global.Image).not.toHaveBeenCalled()
      expect(document.createElement).not.toHaveBeenCalledWith('canvas')
    })
  })

  describe('single diagram conversion', () => {
    it('converts one diagram successfully', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      const result = await promise

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(0)
      expect(global.Image).toHaveBeenCalled()
    })

    it('replaces .mermaid-wrapper with <img>', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      expect(wrappers[0].replaceWith).toHaveBeenCalled()
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]
      expect(imgArg.src).toContain('data:image/png')
    })

    it('img has alt="Mermaid diagram"', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.alt).toBe('Mermaid diagram')
    })

    it('img has width and height attributes', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.width).toBe(400)
      expect(imgArg.height).toBe(300)
    })

    it('img src is PNG data URL', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.src).toMatch(/^data:image\/png/)
    })
  })

  describe('multiple diagrams', () => {
    it('converts all diagrams', async () => {
      const container = createMockContainer([
        { width: 300, height: 200 },
        { width: 400, height: 250 },
        { width: 500, height: 350 }
      ])

      // Set up auto-trigger: when src is set, immediately trigger onload
      vi.spyOn(global, 'Image').mockImplementation(() => {
        const img: MockImage = {
          onload: null,
          onerror: null,
          _src: '',
          get src() { return this._src },
          set src(val: string) {
            this._src = val
            if (this.onload) {
              queueMicrotask(() => this.onload!.call(this as any, new Event('load')))
            }
          },
          width: 0,
          height: 0
        } as any
        return img as any
      })

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(3)
      expect(result.failedDiagrams).toBe(0)
    })

    it('replaces all containers with images', async () => {
      const container = createMockContainer([
        { width: 300, height: 200 },
        { width: 400, height: 250 }
      ])

      // Auto-trigger image loads
      vi.spyOn(global, 'Image').mockImplementation(() => {
        const img: MockImage = {
          onload: null,
          onerror: null,
          _src: '',
          get src() { return this._src },
          set src(val: string) {
            this._src = val
            if (this.onload) {
              queueMicrotask(() => this.onload!.call(this as any, new Event('load')))
            }
          },
          width: 0,
          height: 0
        } as any
        return img as any
      })

      await convertMermaidDiagramsToImages(container)

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      expect(wrappers[0].replaceWith).toHaveBeenCalled()
      expect(wrappers[1].replaceWith).toHaveBeenCalled()
    })
  })

  describe('dimension scaling', () => {
    it('does not scale diagrams under limits', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      // Should keep original dimensions
      expect(imgArg.width).toBe(400)
      expect(imgArg.height).toBe(300)
    })

    it('scales down wide diagrams (>650px width)', async () => {
      const originalWidth = 800
      const originalHeight = 400
      const expectedScale = MAX_DIAGRAM_WIDTH / originalWidth // 650/800 = 0.8125

      const container = createMockContainer([
        { width: originalWidth, height: originalHeight }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.width).toBe(Math.round(originalWidth * expectedScale))
      expect(imgArg.height).toBe(Math.round(originalHeight * expectedScale))
    })

    it('scales down tall diagrams (>744px height)', async () => {
      const originalWidth = 400
      const originalHeight = 900
      const expectedScale = MAX_DIAGRAM_HEIGHT / originalHeight // 744/900 = 0.8266...

      const container = createMockContainer([
        { width: originalWidth, height: originalHeight }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.width).toBe(Math.round(originalWidth * expectedScale))
      expect(imgArg.height).toBe(Math.round(originalHeight * expectedScale))
    })

    it('scales proportionally when both exceed limits (uses smaller scale)', async () => {
      const originalWidth = 1000  // Would need 0.65 scale
      const originalHeight = 900  // Would need 0.8266 scale
      const expectedScale = MAX_DIAGRAM_WIDTH / originalWidth // 0.65 is smaller

      const container = createMockContainer([
        { width: originalWidth, height: originalHeight }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.width).toBe(MAX_DIAGRAM_WIDTH)
      expect(imgArg.height).toBe(Math.round(originalHeight * expectedScale))
    })

    it('preserves aspect ratio during scaling', async () => {
      const originalWidth = 800
      const originalHeight = 400
      const aspectRatio = originalWidth / originalHeight

      const container = createMockContainer([
        { width: originalWidth, height: originalHeight }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      const scaledAspectRatio = imgArg.width / imgArg.height
      expect(Math.abs(scaledAspectRatio - aspectRatio)).toBeLessThan(0.01)
    })
  })

  describe('failure handling', () => {
    it('counts diagrams with no SVG as failed', async () => {
      const container = createMockContainer([
        { width: 400, height: 300, hasSvg: false }
      ])

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(1)
    })

    it('counts diagrams with zero width as failed', async () => {
      const container = createMockContainer([
        { width: 0, height: 300 }
      ])

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(1)
    })

    it('counts diagrams with zero height as failed', async () => {
      const container = createMockContainer([
        { width: 400, height: 0 }
      ])

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(1)
    })

    it('removes failed container from output HTML', async () => {
      const container = createMockContainer([
        { width: 400, height: 300, hasSvg: false }
      ])

      await convertMermaidDiagramsToImages(container)

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      expect(wrappers[0].remove).toHaveBeenCalled()
      expect(wrappers[0].replaceWith).not.toHaveBeenCalled()
    })

    it('correctly handles mixed success/failure (2 success, 1 fail)', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 },           // Success
        { width: 0, height: 0 },               // Fail
        { width: 500, height: 350 }            // Success
      ])

      // Auto-trigger image loads
      vi.spyOn(global, 'Image').mockImplementation(() => {
        const img: MockImage = {
          onload: null,
          onerror: null,
          _src: '',
          get src() { return this._src },
          set src(val: string) {
            this._src = val
            if (this.onload) {
              queueMicrotask(() => this.onload!.call(this as any, new Event('load')))
            }
          },
          width: 0,
          height: 0
        } as any
        return img as any
      })

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(3)
      expect(result.failedDiagrams).toBe(1)
    })

    it('still includes successful conversions when some fail', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 },
        { width: 0, height: 0 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      // First should be replaced
      expect(wrappers[0].replaceWith).toHaveBeenCalled()
      // Second should be removed
      expect(wrappers[1].remove).toHaveBeenCalled()
    })
  })

  describe('nested structure tests', () => {
    it('finds SVG in .mermaid-diagram child element', async () => {
      const container = createMockContainer([
        { width: 400, height: 300, hasDiagramWrapper: true }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      const result = await promise

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(0)
    })

    it('falls back to wrapper if no .mermaid-diagram', async () => {
      const container = createMockContainer([
        { width: 400, height: 300, hasDiagramWrapper: false }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      const result = await promise

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(0)
    })
  })

  describe('SVG namespace tests', () => {
    it('adds xmlns if missing', async () => {
      let clonedSvg: any = null

      const svg = {
        getBoundingClientRect: vi.fn(() => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 })),
        hasAttribute: vi.fn(() => false),
        setAttribute: vi.fn(),
        cloneNode: vi.fn(() => {
          clonedSvg = {
            hasAttribute: vi.fn((attr: string) => attr !== 'xmlns' && attr !== 'xmlns:xlink'),
            setAttribute: vi.fn()
          }
          return clonedSvg
        })
      } as any

      const container = createMockContainer([{ width: 400, height: 300 }])
      const wrappers = container.querySelectorAll('.mermaid-wrapper')
      const wrapper = wrappers[0] as any
      wrapper.querySelector = vi.fn((selector: string) => {
        if (selector === '.mermaid-diagram') return { querySelector: vi.fn(() => svg) }
        if (selector === 'svg') return svg
        return null
      })

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(clonedSvg.setAttribute).toHaveBeenCalledWith('xmlns', 'http://www.w3.org/2000/svg')
    })

    it('adds xmlns:xlink if missing', async () => {
      let clonedSvg: any = null

      const svg = {
        getBoundingClientRect: vi.fn(() => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 })),
        hasAttribute: vi.fn(() => false),
        setAttribute: vi.fn(),
        cloneNode: vi.fn(() => {
          clonedSvg = {
            hasAttribute: vi.fn((attr: string) => attr !== 'xmlns' && attr !== 'xmlns:xlink'),
            setAttribute: vi.fn()
          }
          return clonedSvg
        })
      } as any

      const container = createMockContainer([{ width: 400, height: 300 }])
      const wrappers = container.querySelectorAll('.mermaid-wrapper')
      const wrapper = wrappers[0] as any
      wrapper.querySelector = vi.fn((selector: string) => {
        if (selector === '.mermaid-diagram') return { querySelector: vi.fn(() => svg) }
        if (selector === 'svg') return svg
        return null
      })

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(clonedSvg.setAttribute).toHaveBeenCalledWith('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    })

    it('does not duplicate existing xmlns', async () => {
      let clonedSvg: any = null

      const svg = {
        getBoundingClientRect: vi.fn(() => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 })),
        hasAttribute: vi.fn(() => false),
        setAttribute: vi.fn(),
        cloneNode: vi.fn(() => {
          clonedSvg = {
            hasAttribute: vi.fn((attr: string) => attr === 'xmlns'), // Has xmlns
            setAttribute: vi.fn()
          }
          return clonedSvg
        })
      } as any

      const container = createMockContainer([{ width: 400, height: 300 }])
      const wrappers = container.querySelectorAll('.mermaid-wrapper')
      const wrapper = wrappers[0] as any
      wrapper.querySelector = vi.fn((selector: string) => {
        if (selector === '.mermaid-diagram') return { querySelector: vi.fn(() => svg) }
        if (selector === 'svg') return svg
        return null
      })

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const xmlnsCalls = clonedSvg.setAttribute.mock.calls.filter(
        (call: any[]) => call[0] === 'xmlns'
      )
      expect(xmlnsCalls.length).toBe(0)
    })

    it('does not duplicate existing xmlns:xlink', async () => {
      let clonedSvg: any = null

      const svg = {
        getBoundingClientRect: vi.fn(() => ({ width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300 })),
        hasAttribute: vi.fn(() => false),
        setAttribute: vi.fn(),
        cloneNode: vi.fn(() => {
          clonedSvg = {
            hasAttribute: vi.fn((attr: string) => attr === 'xmlns:xlink'), // Has xmlns:xlink
            setAttribute: vi.fn()
          }
          return clonedSvg
        })
      } as any

      const container = createMockContainer([{ width: 400, height: 300 }])
      const wrappers = container.querySelectorAll('.mermaid-wrapper')
      const wrapper = wrappers[0] as any
      wrapper.querySelector = vi.fn((selector: string) => {
        if (selector === '.mermaid-diagram') return { querySelector: vi.fn(() => svg) }
        if (selector === 'svg') return svg
        return null
      })

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const xlinkCalls = clonedSvg.setAttribute.mock.calls.filter(
        (call: any[]) => call[0] === 'xmlns:xlink'
      )
      expect(xlinkCalls.length).toBe(0)
    })
  })

  describe('canvas/image tests', () => {
    it('uses default resolution scale (2.5)', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      let capturedWidth = 0
      let capturedHeight = 0
      const originalGetContext = mockCanvas.getContext
      mockCanvas.getContext = vi.fn(() => {
        // Capture canvas dimensions before they're reset
        capturedWidth = mockCanvas.width
        capturedHeight = mockCanvas.height
        return mockContext
      })

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      // Restore original
      mockCanvas.getContext = originalGetContext

      expect(capturedWidth).toBe(400 * RESOLUTION_SCALE)
      expect(capturedHeight).toBe(300 * RESOLUTION_SCALE)
    })

    it('fills white background', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(mockContext.fillStyle).toBe('white')
      expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, 1000, 750)
    })

    it('disables image smoothing', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(mockContext.imageSmoothingEnabled).toBe(false)
    })

    it('draws image to canvas with correct dimensions', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const firstImage = mockImages[0]
      expect(mockContext.drawImage).toHaveBeenCalledWith(
        firstImage,
        0, 0, 400, 300,  // Source dimensions (original)
        0, 0, 1000, 750  // Destination dimensions (scaled by resolution)
      )
    })
  })

  describe('memory cleanup tests', () => {
    it('clears img.src after conversion', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(mockImages[0].src).toBe('')
    })

    it('sets canvas dimensions to 0 after conversion', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      expect(mockCanvas.width).toBe(0)
      expect(mockCanvas.height).toBe(0)
    })

    it('cleanup happens even on canvas context error', async () => {
      mockCanvas.getContext = vi.fn(() => null)

      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()

      // Error is caught and counted as failed, not thrown
      const result = await promise

      expect(result.failedDiagrams).toBe(1)

      // Cleanup should still happen
      expect(mockImages[0].src).toBe('')
      expect(mockCanvas.width).toBe(0)
      expect(mockCanvas.height).toBe(0)
    })

    it('cleanup happens even if drawImage throws', async () => {
      // Simulate drawImage throwing an error
      mockContext.drawImage = vi.fn(() => {
        throw new Error('Draw failed')
      })

      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()

      const result = await promise

      // Error should be caught and counted as failed
      expect(result.failedDiagrams).toBe(1)

      // Cleanup should still happen in finally block
      expect(mockImages[0].src).toBe('')
      expect(mockCanvas.width).toBe(0)
      expect(mockCanvas.height).toBe(0)
    })
  })

  describe('clone behavior tests', () => {
    it('does not modify original container', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])
      const originalHTML = container.innerHTML

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      // Original should be unchanged
      expect(container.innerHTML).toBe(originalHTML)
    })

    it('modifications only apply to clone', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      // Original wrappers should not have replaceWith called
      const originalWrappers = container.querySelectorAll('.mermaid-wrapper')
      expect((originalWrappers[0] as any).replaceWith).not.toHaveBeenCalled()

      // Clone wrappers should have replaceWith called
      const clone = container.cloneNode(true) as any
      const cloneWrappers = clone.querySelectorAll('.mermaid-wrapper')
      expect(cloneWrappers[0].replaceWith).toHaveBeenCalled()
    })
  })

  describe('error handling tests', () => {
    it('counts image load errors as failed', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageError('Network error')

      const result = await promise

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(1)
    })

    it('counts canvas context errors as failed', async () => {
      mockCanvas.getContext = vi.fn(() => null)

      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()

      const result = await promise

      expect(result.totalDiagrams).toBe(1)
      expect(result.failedDiagrams).toBe(1)
    })

    it('removes failed diagram containers from output', async () => {
      mockCanvas.getContext = vi.fn(() => null)

      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()

      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      // Failed conversion should be removed
      expect(wrappers[0].remove).toHaveBeenCalled()
      expect(wrappers[0].replaceWith).not.toHaveBeenCalled()
    })
  })

  describe('integration tests', () => {
    it('handles complex scenario with multiple diagrams of varying sizes', async () => {
      const container = createMockContainer([
        { width: 300, height: 200 },     // Small, no scaling
        { width: 800, height: 400 },     // Wide, needs scaling
        { width: 0, height: 0 },         // Failed
        { width: 400, height: 1000 },    // Tall, needs scaling
        { width: 500, height: 350, hasSvg: false } // No SVG, failed
      ])

      // Auto-trigger image loads
      vi.spyOn(global, 'Image').mockImplementation(() => {
        const img: MockImage = {
          onload: null,
          onerror: null,
          _src: '',
          get src() { return this._src },
          set src(val: string) {
            this._src = val
            if (this.onload) {
              queueMicrotask(() => this.onload!.call(this as any, new Event('load')))
            }
          },
          width: 0,
          height: 0
        } as any
        return img as any
      })

      const result = await convertMermaidDiagramsToImages(container)

      expect(result.totalDiagrams).toBe(5)
      expect(result.failedDiagrams).toBe(2)

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')

      // Diagrams 1, 2, 4 should be replaced
      expect(wrappers[0].replaceWith).toHaveBeenCalled()
      expect(wrappers[1].replaceWith).toHaveBeenCalled()
      expect(wrappers[3].replaceWith).toHaveBeenCalled()

      // Diagrams 3, 5 should be removed
      expect(wrappers[2].remove).toHaveBeenCalled()
      expect(wrappers[4].remove).toHaveBeenCalled()
    })

    it('generates valid PNG data URLs', async () => {
      const container = createMockContainer([
        { width: 400, height: 300 }
      ])

      const promise = convertMermaidDiagramsToImages(container)
      triggerImageLoad()
      await promise

      const clone = container.cloneNode(true) as any
      const wrappers = clone.querySelectorAll('.mermaid-wrapper')
      const imgArg = wrappers[0].replaceWith.mock.calls[0][0]

      expect(imgArg.src).toBe('data:image/png;base64,mock-png-data')
      expect(typeof imgArg.src).toBe('string')
      expect(imgArg.src.length).toBeGreaterThan(0)
    })
  })
})
