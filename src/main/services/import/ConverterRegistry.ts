// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import type { IConverter, FileTypeCategory } from './types'
import { LiteParseConverter } from './converters/LiteParseConverter'
import { TextConverter } from './converters/TextConverter'
import { AudioConverter } from './converters/AudioConverter'
import { VideoConverter } from './converters/VideoConverter'
import { isCodeExtension, LITEPARSE_EXCLUDED_EXTENSIONS } from './extensions'
import { logger } from '../LoggingService'
import { transcriptionService } from '../TranscriptionService'
import { audioMetadataService } from '../AudioMetadataService'
import { audioExtractionService } from '../AudioExtractionService'

/**
 * Converter Registry
 *
 * Central registry for all file converters. Maps file extensions
 * to their appropriate converters using the Strategy Pattern.
 *
 * Usage:
 *   const registry = createConverterRegistry()
 *   const converter = registry.getConverter('pdf')
 *   if (converter) {
 *     const result = await converter.convert(filePath)
 *   }
 *
 * Extensibility:
 *   To add a new converter (e.g., AudioConverter):
 *   1. Create the converter implementing IConverter
 *   2. Register it in registerBuiltInConverters()
 */
export class ConverterRegistry {
  private converters: Map<string, IConverter> = new Map()
  private extensionToConverter: Map<string, IConverter> = new Map()

  /**
   * Register a converter for its supported extensions
   *
   * @param converter - Converter instance implementing IConverter
   */
  register(converter: IConverter): void {
    // Store converter by category
    this.converters.set(converter.category, converter)

    // Map each extension to the converter
    for (const ext of converter.supportedExtensions) {
      this.extensionToConverter.set(ext.toLowerCase(), converter)
    }
  }

  /**
   * Get converter for a file extension
   *
   * @param extension - File extension (with or without dot, case-insensitive)
   * @returns Converter instance or undefined if not supported
   */
  getConverter(extension: string): IConverter | undefined {
    const normalizedExt = extension.replace(/^\./, '').toLowerCase()
    return this.extensionToConverter.get(normalizedExt)
  }

  /**
   * Get converter by category
   *
   * @param category - File type category
   * @returns Converter instance or undefined
   */
  getConverterByCategory(category: FileTypeCategory): IConverter | undefined {
    return this.converters.get(category)
  }

  /**
   * Check if an extension is supported
   *
   * @param extension - File extension (with or without dot, case-insensitive)
   * @returns true if the extension has a registered converter
   */
  isSupported(extension: string): boolean {
    return this.getConverter(extension) !== undefined
  }

  /**
   * Get all supported extensions
   *
   * @returns Array of supported extensions (lowercase, without dot)
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensionToConverter.keys())
  }

  /**
   * Get extensions grouped by whether they require conversion
   *
   * Useful for building file dialog filters
   */
  getExtensionsByConversionType(): {
    requiresConversion: string[]
    passthrough: string[]
  } {
    const requiresConversion: string[] = []
    const passthrough: string[] = []

    for (const [ext, converter] of this.extensionToConverter) {
      if (converter.requiresConversion) {
        requiresConversion.push(ext)
      } else {
        passthrough.push(ext)
      }
    }

    return { requiresConversion, passthrough }
  }

  /**
   * Get all registered categories
   */
  getCategories(): FileTypeCategory[] {
    return Array.from(this.converters.keys()) as FileTypeCategory[]
  }

  /**
   * Attempt to detect if a file is likely text-based
   * even if its extension isn't in the supported list
   *
   * This enables the "any UTF-8 file" requirement
   *
   * @param extension - File extension
   * @returns true if the file might be text-based
   */
  mightBeTextFile(extension: string): boolean {
    const normalizedExt = extension.replace(/^\./, '').toLowerCase()

    // First check if explicitly supported
    const converter = this.extensionToConverter.get(normalizedExt)
    if (converter) {
      return converter.category === 'text'
    }

    // Check against code file extensions (likely text but not in primary list)
    return isCodeExtension(normalizedExt)
  }

  /**
   * Dynamically add extensions to an existing converter's mapping.
   * Used by DependencyDetector to add Office/image extensions after startup.
   *
   * Extensions already mapped to another converter are overwritten (last-write-wins).
   * Extensions in the exclusion set (csv, tsv, svg) are silently skipped.
   *
   * @param category - Category of the converter to extend
   * @param extensions - New extensions to map
   */
  updateConverterExtensions(category: FileTypeCategory, extensions: string[]): void {
    const converter = this.converters.get(category)
    if (!converter) return

    for (const ext of extensions) {
      const normalized = ext.toLowerCase()
      if (LITEPARSE_EXCLUDED_EXTENSIONS.has(normalized)) continue

      const existing = this.extensionToConverter.get(normalized)
      if (existing && existing !== converter) {
        logger.info(`Extension .${normalized} reassigned from ${existing.category} to ${converter.category}`)
      }
      this.extensionToConverter.set(normalized, converter)
    }
  }
}

/**
 * Register built-in converters
 */
function registerBuiltInConverters(registry: ConverterRegistry): void {
  // Document converter – PDF only at startup; Office/image extensions added
  // dynamically by DependencyDetector after async detection completes
  registry.register(new LiteParseConverter())

  // Text converters
  registry.register(new TextConverter())

  // Audio converters (Issue #75)
  registry.register(new AudioConverter(transcriptionService, audioMetadataService))

  // Video converters (Issue #110)
  registry.register(new VideoConverter(transcriptionService, audioExtractionService))
}

/**
 * Factory function to create a configured ConverterRegistry
 */
export function createConverterRegistry(): ConverterRegistry {
  const registry = new ConverterRegistry()
  registerBuiltInConverters(registry)
  return registry
}

// Singleton instance for convenience
export const converterRegistry = createConverterRegistry()
