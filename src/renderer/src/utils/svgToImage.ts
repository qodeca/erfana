// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mermaid Diagram to Image Conversion
 *
 * Extracts SVG content from Mermaid diagrams and converts to PNG for DOCX export.
 * Uses direct SVG serialization + canvas rendering instead of DOM-to-image libraries
 * because html-to-image cannot handle SVG content added via innerHTML.
 *
 * @see Issue #65 - DOCX export with Mermaid diagram support
 */

import { DOCX_EXPORT } from '../../../shared/constants'

/**
 * Result of diagram conversion including dimensions
 */
interface DiagramConversion {
  dataUrl: string
  width: number
  height: number
}

/**
 * Result of converting Mermaid diagrams to images
 */
export interface MermaidConversionResult {
  /** Modified HTML with diagrams as images */
  html: string
  /** Total number of diagrams found */
  totalDiagrams: number
  /** Number of diagrams that failed to convert */
  failedDiagrams: number
}

/**
 * Maximum dimensions for diagrams in DOCX export
 * Diagrams are scaled proportionally to fit within these bounds
 */
const MAX_DIAGRAM_WIDTH = DOCX_EXPORT.MAX_DIAGRAM_WIDTH_PX   // 650px (100% of A4 work area)
const MAX_DIAGRAM_HEIGHT = DOCX_EXPORT.MAX_DIAGRAM_HEIGHT_PX // 744px (80% of A4 work area)

/**
 * Result from SVG to PNG conversion including final dimensions
 */
interface SvgToPngResult {
  dataUrl: string
  width: number
  height: number
}

/**
 * Convert an SVG element to a PNG data URL using canvas
 *
 * Uses base64 data URL instead of blob URL to avoid Electron/Chromium
 * security restrictions that can cause silent failures when loading
 * blob URLs into Image elements.
 *
 * Diagrams are scaled proportionally to fit within page constraints:
 * - MAX_DIAGRAM_WIDTH (650px) = 100% of A4 work area
 * - MAX_DIAGRAM_HEIGHT (744px) = 80% of A4 work area
 *
 * Resolution scale determines output DPI (at 96 DPI base):
 * - scale 2 = 192 DPI (good for screen)
 * - scale 2.5 = 240 DPI (balanced quality/size, exceeds Word's PDF export cap)
 * - scale 3 = 288 DPI (near print quality, larger files)
 *
 * @param svgElement - The SVG element to convert
 * @param resolutionScale - Scale factor for higher resolution (default: 2.5 for ~240 DPI)
 * @returns Promise resolving to PNG data URL with dimensions
 */
async function svgToPng(svgElement: SVGSVGElement, resolutionScale = DOCX_EXPORT.PNG_RESOLUTION_SCALE): Promise<SvgToPngResult> {
  // Get dimensions from bounding rect
  const rect = svgElement.getBoundingClientRect()
  let width = rect.width
  let height = rect.height

  // Scale down diagrams to fit within page constraints while preserving aspect ratio
  // Use the smaller scale factor to ensure diagram fits BOTH width and height limits
  const widthScale = width > MAX_DIAGRAM_WIDTH ? MAX_DIAGRAM_WIDTH / width : 1
  const heightScale = height > MAX_DIAGRAM_HEIGHT ? MAX_DIAGRAM_HEIGHT / height : 1
  const diagramScale = Math.min(widthScale, heightScale)

  if (diagramScale < 1) {
    width = Math.round(width * diagramScale)
    height = Math.round(height * diagramScale)
  }

  // Clone SVG to avoid modifying original
  const svgClone = svgElement.cloneNode(true) as SVGSVGElement

  // Ensure SVG has xmlns attribute (required for standalone SVG)
  if (!svgClone.hasAttribute('xmlns')) {
    svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }

  // Add xlink namespace for any xlink:href attributes (common in Mermaid SVGs)
  if (!svgClone.hasAttribute('xmlns:xlink')) {
    svgClone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }

  // Set explicit dimensions on SVG (original size for proper rendering)
  svgClone.setAttribute('width', String(rect.width))
  svgClone.setAttribute('height', String(rect.height))

  // Serialize SVG to string
  const serializer = new XMLSerializer()
  const svgString = serializer.serializeToString(svgClone)

  // Use base64 data URL instead of blob URL to avoid security restrictions
  const base64Svg = btoa(unescape(encodeURIComponent(svgString)))
  const svgDataUrl = `data:image/svg+xml;base64,${base64Svg}`

  // Load SVG into an image
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = (e) => reject(new Error(`Failed to load SVG: ${e}`))
    image.src = svgDataUrl
  })

  // Create canvas with final dimensions (scaled down if needed) * resolution scale
  const canvas = document.createElement('canvas')
  canvas.width = width * resolutionScale
  canvas.height = height * resolutionScale

  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context')
    }

    // Disable image smoothing to preserve sharp SVG vector edges
    // SVG is internally rendered at high quality by the browser;
    // additional smoothing during canvas draw can blur sharp edges
    ctx.imageSmoothingEnabled = false

    // Fill with white background
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw the image scaled to final dimensions
    // Source: full SVG image, Destination: scaled canvas
    ctx.drawImage(img, 0, 0, rect.width, rect.height, 0, 0, canvas.width, canvas.height)

    // Export as PNG
    const pngDataUrl = canvas.toDataURL('image/png')

    return { dataUrl: pngDataUrl, width, height }
  } finally {
    // Cleanup to prevent memory leaks in long-running renderer process
    // Release image data URL reference
    img.src = ''
    // Release canvas memory by setting dimensions to 0
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Process HTML content and convert Mermaid diagrams to PNG images
 *
 * Finds all Mermaid diagram containers, extracts their SVG content,
 * converts to PNG via canvas, and replaces them with <img> tags.
 *
 * This approach works because:
 * 1. We extract the actual rendered SVG from the DOM
 * 2. We serialize it and load it into a new Image element
 * 3. We draw it to a canvas and export as PNG
 * 4. This bypasses the issues with html-to-image and innerHTML SVGs
 *
 * @param container - The HTML element containing the content (attached to DOM)
 * @returns Result object with HTML, total diagrams, and failed count
 */
export async function convertMermaidDiagramsToImages(
  container: Element
): Promise<MermaidConversionResult> {
  // Validate input
  if (!container || !container.ownerDocument) {
    throw new Error('Container must be a valid DOM element attached to a document')
  }

  // Target only top-level .mermaid-wrapper elements to avoid duplicate processing
  // (.mermaid-container is a child of .mermaid-wrapper)
  const MERMAID_SELECTOR = '.mermaid-wrapper'
  const mermaidContainers = container.querySelectorAll(MERMAID_SELECTOR)

  // If no Mermaid diagrams, return HTML as-is
  if (mermaidContainers.length === 0) {
    return {
      html: container.innerHTML,
      totalDiagrams: 0,
      failedDiagrams: 0
    }
  }

  // Extract and convert each diagram
  const conversions: Array<DiagramConversion | null> = []

  for (const mermaidContainer of mermaidContainers) {
    // Target the inner diagram element if available
    const diagramEl = mermaidContainer.querySelector('.mermaid-diagram') || mermaidContainer

    try {
      // Find the SVG element inside the diagram
      const svgElement = diagramEl.querySelector('svg') as SVGSVGElement | null
      if (!svgElement) {
        conversions.push(null)
        continue
      }

      // Get actual rendered dimensions
      const rect = svgElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        conversions.push(null)
        continue
      }

      // Convert SVG to PNG (handles scaling for tall diagrams)
      const result = await svgToPng(svgElement)

      conversions.push({
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height
      })
    } catch {
      conversions.push(null)
    }
  }

  // Clone the container and apply conversions
  const clone = container.cloneNode(true) as Element
  const clonedContainers = clone.querySelectorAll(MERMAID_SELECTOR)

  // Replace each mermaid container in the clone with the converted image
  clonedContainers.forEach((clonedContainer, index) => {
    const conversion = conversions[index]

    if (!conversion) {
      // No conversion available, remove the container
      clonedContainer.remove()
      return
    }

    // Create img element with the PNG data URL
    // Dimensions are pre-scaled in svgToPng() to fit page constraints
    const img = document.createElement('img')
    img.src = conversion.dataUrl
    img.alt = 'Mermaid diagram'
    img.width = conversion.width
    img.height = conversion.height

    // Replace the Mermaid container with the image
    clonedContainer.replaceWith(img)
  })

  // Calculate results
  const finalHtml = clone.innerHTML
  const totalDiagrams = conversions.length
  const failedDiagrams = conversions.filter(c => c === null).length

  return {
    html: finalHtml,
    totalDiagrams,
    failedDiagrams
  }
}
