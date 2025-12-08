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
async function svgToPng(svgElement: SVGSVGElement, resolutionScale = 2.5): Promise<SvgToPngResult> {
  // Get dimensions from bounding rect
  const rect = svgElement.getBoundingClientRect()
  let width = rect.width
  let height = rect.height

  console.log(`[svgToPng] Original dimensions: ${width}x${height}`)

  // Scale down diagrams to fit within page constraints while preserving aspect ratio
  // Use the smaller scale factor to ensure diagram fits BOTH width and height limits
  const widthScale = width > MAX_DIAGRAM_WIDTH ? MAX_DIAGRAM_WIDTH / width : 1
  const heightScale = height > MAX_DIAGRAM_HEIGHT ? MAX_DIAGRAM_HEIGHT / height : 1
  const diagramScale = Math.min(widthScale, heightScale)

  if (diagramScale < 1) {
    width = Math.round(width * diagramScale)
    height = Math.round(height * diagramScale)
    console.log(`[svgToPng] Scaled to fit page: ${width}x${height} (scale: ${diagramScale.toFixed(3)})`)
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

  console.log(`[svgToPng] Serialized SVG length: ${svgString.length}`)

  // Use base64 data URL instead of blob URL to avoid security restrictions
  const base64Svg = btoa(unescape(encodeURIComponent(svgString)))
  const svgDataUrl = `data:image/svg+xml;base64,${base64Svg}`

  console.log(`[svgToPng] Created SVG data URL, length: ${svgDataUrl.length}`)

  // Load SVG into an image
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      console.log(`[svgToPng] Image loaded: ${image.naturalWidth}x${image.naturalHeight}`)
      resolve(image)
    }
    image.onerror = (e) => {
      console.error('[svgToPng] Image load error:', e)
      reject(new Error(`Failed to load SVG: ${e}`))
    }
    image.src = svgDataUrl
  })

  // Create canvas with final dimensions (scaled down if needed) * resolution scale
  const canvas = document.createElement('canvas')
  canvas.width = width * resolutionScale
  canvas.height = height * resolutionScale

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
  console.log(`[svgToPng] Generated PNG ${width}x${height} (canvas: ${canvas.width}x${canvas.height}), length: ${pngDataUrl.length}`)

  return { dataUrl: pngDataUrl, width, height }
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
 * @returns Modified HTML string with Mermaid diagrams as PNG images
 */
export async function convertMermaidDiagramsToImages(
  container: Element
): Promise<string> {
  console.log('[convertMermaidDiagrams] Starting conversion')
  console.log('[convertMermaidDiagrams] Container:', container.tagName, container.className)

  // Find all Mermaid containers in the ORIGINAL DOM (while attached)
  const mermaidContainers = container.querySelectorAll(
    '.mermaid-wrapper, .mermaid-container'
  )

  console.log(`[convertMermaidDiagrams] Found ${mermaidContainers.length} Mermaid containers`)

  // If no Mermaid diagrams, return HTML as-is
  if (mermaidContainers.length === 0) {
    console.log('[convertMermaidDiagrams] No diagrams found, returning original HTML')
    return container.innerHTML
  }

  // Extract and convert each diagram
  const conversions: Array<DiagramConversion | null> = []

  for (let i = 0; i < mermaidContainers.length; i++) {
    const mermaidContainer = mermaidContainers[i]
    console.log(`[convertMermaidDiagrams] Processing diagram ${i + 1}/${mermaidContainers.length}`)
    console.log(`[convertMermaidDiagrams] Container classes: ${mermaidContainer.className}`)

    // Target the inner diagram element if available
    const diagramEl = mermaidContainer.querySelector('.mermaid-diagram') || mermaidContainer
    console.log(`[convertMermaidDiagrams] Diagram element: ${diagramEl.tagName}, classes: ${diagramEl.className}`)

    try {
      // Find the SVG element inside the diagram
      const svgElement = diagramEl.querySelector('svg') as SVGSVGElement | null
      if (!svgElement) {
        console.warn('[convertMermaidDiagrams] No SVG found in mermaid diagram container')
        console.log('[convertMermaidDiagrams] Container innerHTML (first 500 chars):', diagramEl.innerHTML.substring(0, 500))
        conversions.push(null)
        continue
      }

      console.log(`[convertMermaidDiagrams] Found SVG element, viewBox: ${svgElement.getAttribute('viewBox')}`)

      // Get actual rendered dimensions
      const rect = svgElement.getBoundingClientRect()
      console.log(`[convertMermaidDiagrams] SVG bounding rect: ${rect.width}x${rect.height} at (${rect.left}, ${rect.top})`)

      if (rect.width === 0 || rect.height === 0) {
        console.warn('[convertMermaidDiagrams] Mermaid SVG has zero dimensions, skipping')
        conversions.push(null)
        continue
      }

      // Convert SVG to PNG (handles scaling for tall diagrams)
      // Uses default resolution scale (2.5 = ~240 DPI)
      console.log('[convertMermaidDiagrams] Calling svgToPng...')
      const result = await svgToPng(svgElement)

      console.log(`[convertMermaidDiagrams] Converted diagram ${i + 1}: ${result.width}x${result.height}, PNG length: ${result.dataUrl.length}`)

      conversions.push({
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height
      })
    } catch (error) {
      console.error('[convertMermaidDiagrams] Failed to convert Mermaid diagram:', error)
      conversions.push(null)
    }
  }

  console.log(`[convertMermaidDiagrams] Conversion results: ${conversions.filter(c => c !== null).length} successful, ${conversions.filter(c => c === null).length} failed`)

  // Clone the container and apply conversions
  const clone = container.cloneNode(true) as Element

  // IMPORTANT: Only target .mermaid-wrapper (top-level), not .mermaid-container
  // The selector '.mermaid-wrapper, .mermaid-container' was causing duplicates
  // because .mermaid-container is a child of .mermaid-wrapper
  //
  // Use the same selector as above, but track which elements we've replaced
  // to handle the nested structure correctly
  const clonedContainers = clone.querySelectorAll(
    '.mermaid-wrapper, .mermaid-container'
  )

  console.log(`[convertMermaidDiagrams] Found ${clonedContainers.length} containers in clone to replace`)

  // Track replaced elements to skip children of already-replaced parents
  const replaced = new Set<Element>()

  // Replace each mermaid container in the clone with the converted image
  clonedContainers.forEach((clonedContainer, index) => {
    // Skip if this element was already replaced (it was a child of a replaced parent)
    if (!clonedContainer.parentElement) {
      console.log(`[convertMermaidDiagrams] Skipping index ${index}: no parent (already removed)`)
      return
    }

    // Skip if ancestor was already replaced
    let ancestor: Element | null = clonedContainer.parentElement
    while (ancestor) {
      if (replaced.has(ancestor)) {
        console.log(`[convertMermaidDiagrams] Skipping index ${index}: ancestor was replaced`)
        return
      }
      ancestor = ancestor.parentElement
    }

    const conversion = conversions[index]

    if (!conversion) {
      // No conversion available, remove the container
      console.log(`[convertMermaidDiagrams] Removing container at index ${index} (no conversion)`)
      clonedContainer.remove()
      return
    }

    console.log(`[convertMermaidDiagrams] Replacing container at index ${index} with image (${conversion.width}x${conversion.height})`)

    // Create img element with the PNG data URL
    // Dimensions are pre-scaled in svgToPng() to fit page constraints
    const img = document.createElement('img')
    img.src = conversion.dataUrl
    img.alt = 'Mermaid diagram'
    img.width = conversion.width
    img.height = conversion.height

    // Add data attribute for the main process to recognize
    img.setAttribute('data-mermaid-diagram', 'true')

    // Wrap in a borderless centered table for reliable DOCX centering
    // Paragraph-level text-align doesn't work reliably for images in DOCX converters,
    // Using a fixed-width table with margin: 0 auto centers the table itself on the page
    const table = document.createElement('table')
    table.setAttribute('style', `width: ${conversion.width}px; border: none; border-collapse: collapse; margin: 1em auto;`)

    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.setAttribute('style', 'border: none; padding: 0;')

    td.appendChild(img)
    tr.appendChild(td)
    table.appendChild(tr)

    // Mark as replaced before replacing
    replaced.add(clonedContainer)

    // Replace the Mermaid container with the centered table
    clonedContainer.replaceWith(table)
  })

  console.log(`[convertMermaidDiagrams] Replaced ${replaced.size} containers with images`)

  // Log final HTML snippet for debugging
  const finalHtml = clone.innerHTML
  const imgCount = (finalHtml.match(/<img/g) || []).length
  console.log(`[convertMermaidDiagrams] Final HTML has ${imgCount} <img> tags, total length: ${finalHtml.length}`)

  // Return the modified HTML
  return finalHtml
}
