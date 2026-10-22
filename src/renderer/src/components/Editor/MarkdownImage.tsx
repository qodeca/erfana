// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown preview's image element (#71).
 *
 * - A remote (`http:` / `https:`) image renders exactly as before.
 * - A project-relative image renders from the preview's
 *   {@link MarkdownImageStore}: a `data:` URL the main process read, confined
 *   to the project. Always as an `<img>` – an SVG is never inlined, so its
 *   scripts cannot run and it cannot fetch anything.
 * - Anything else, and anything the store could not show, renders its alt
 *   text in a placeholder, with the reason as a tooltip.
 *
 * Both a finished image and a placeholder replacing "loading" change the
 * preview's height, so each announces itself with a bubbling
 * {@link MARKDOWN_IMAGE_SETTLED_EVENT}; the preview turns that into an
 * `onRendered` call, which scroll sync re-measures on. While an image is
 * loading it counts as outstanding preview work, so an export's `flush()`
 * waits for it.
 *
 * @module components/Editor/MarkdownImage
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from 'react'
import {
  MARKDOWN_IMAGE_MAX_BYTES,
  MAX_MARKDOWN_IMAGES_PER_DOCUMENT
} from '../../../../shared/ipc/markdown-image-schema'
import { classifyImageSource } from './markdownImageSource'
import type { MarkdownImageStore, MarkdownImageUnavailableReason, MarkdownImageView } from './markdownImageStore'
import { PreviewWorkContext } from './previewWork'

/** Bubbles from an image element whose size may just have changed. */
export const MARKDOWN_IMAGE_SETTLED_EVENT = 'markdown-image:settled'

/** Provided by `MarkdownPreview`: the image store of that preview panel. */
export const MarkdownImageStoreContext = createContext<MarkdownImageStore | null>(null)

/** Why a placeholder is shown: the store's reasons, or a `src` that is never loaded. */
export type MarkdownImagePlaceholderReason = MarkdownImageUnavailableReason | 'blocked'

/** Tooltip for each placeholder. Never names a path. */
export const MARKDOWN_IMAGE_MESSAGES: Readonly<Record<MarkdownImagePlaceholderReason | 'loading', string>> = {
  loading: 'Loading image…',
  blocked: 'Image not shown: only images inside the project, linked by a relative path, are shown',
  'outside-project': 'Image not shown: it is outside the project',
  'not-found': 'Image not found',
  'unsupported-type': 'Image not shown: only PNG, JPEG, GIF, WebP and SVG images are shown',
  'too-large': `Image not shown: it is larger than ${MARKDOWN_IMAGE_MAX_BYTES / (1024 * 1024)} MB`,
  unreadable: 'Image could not be read',
  undecodable: 'Image could not be displayed',
  limit: `Image not shown: a preview shows at most ${MAX_MARKDOWN_IMAGES_PER_DOCUMENT} images`,
  budget: 'Image not shown: open previews already hold as many images as they can'
}

/** Props the preview's `img` renderer passes on. */
export interface MarkdownImageProps {
  src?: string
  alt?: string
  title?: string
  width?: number | string
  height?: number | string
  lineStart?: number
  lineEnd?: number
  /** Remaining sanitized attributes (aria-*, longDesc…) */
  rest?: Record<string, unknown>
}

/** Shown before the store has an answer, or when no store is provided. */
const NO_STORE_VIEW: MarkdownImageView = Object.freeze({ status: 'unavailable', reason: 'unreadable' })

/** Tell the preview this element may have changed size. */
function announce(element: Element | null): void {
  element?.dispatchEvent(new CustomEvent(MARKDOWN_IMAGE_SETTLED_EVENT, { bubbles: true }))
}

function lineAttributes(lineStart?: number, lineEnd?: number): Record<string, number | undefined> {
  return { 'data-line-start': lineStart, 'data-line-end': lineEnd, 'data-line': lineStart }
}

/** The alt text in a box, with the reason as tooltip. */
function ImagePlaceholder({
  state,
  alt,
  lineStart,
  lineEnd
}: {
  state: MarkdownImagePlaceholderReason | 'loading'
  alt?: string
  lineStart?: number
  lineEnd?: number
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const message = MARKDOWN_IMAGE_MESSAGES[state]
  const label = alt ? `${alt} – ${message}` : message
  // A placeholder replacing "loading" (or an image) may change the height
  useEffect(() => {
    if (state !== 'loading') announce(ref.current)
  }, [state])
  return (
    <span
      ref={ref}
      className="markdown-image-placeholder"
      role="img"
      aria-label={label}
      title={message}
      data-image-state={state}
      {...lineAttributes(lineStart, lineEnd)}
    >
      {alt || 'Image'}
    </span>
  )
}

/** A project-relative image, read through the preview's store. */
function ProjectImage({
  path,
  alt,
  title,
  width,
  height,
  lineStart,
  lineEnd,
  rest
}: Omit<MarkdownImageProps, 'src'> & { path: string }): JSX.Element {
  const store = useContext(MarkdownImageStoreContext)
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(path, listener) : () => {}),
    [store, path]
  )
  const getSnapshot = useCallback(() => (store ? store.getView(path) : NO_STORE_VIEW), [store, path])
  const view = useSyncExternalStore(subscribe, getSnapshot)

  // Loading counts as outstanding preview work, so an export waits for it.
  // A layout effect, so a flush waiting on this commit already sees it.
  const { tracker } = useContext(PreviewWorkContext)
  const isLoading = view.status === 'loading'
  useLayoutEffect(() => {
    if (!isLoading || !tracker) return
    return tracker.begin()
  }, [isLoading, tracker])

  if (view.status !== 'ready') {
    return (
      <ImagePlaceholder
        state={view.status === 'loading' ? 'loading' : view.reason}
        alt={alt}
        lineStart={lineStart}
        lineEnd={lineEnd}
      />
    )
  }
  return (
    <img
      {...rest}
      src={view.url}
      alt={alt}
      title={title}
      width={width}
      height={height}
      data-image-state="ready"
      onLoad={(event) => announce(event.currentTarget)}
      {...lineAttributes(lineStart, lineEnd)}
    />
  )
}

/**
 * One image in the preview. Remote images pass through; project-relative ones
 * are read through the store; everything else is a placeholder.
 */
export function MarkdownImage({ src, ...props }: MarkdownImageProps): JSX.Element {
  const source = useMemo(() => classifyImageSource(src), [src])
  if (source.kind === 'remote') {
    return (
      <img
        {...props.rest}
        src={src}
        alt={props.alt}
        title={props.title}
        width={props.width}
        height={props.height}
        {...lineAttributes(props.lineStart, props.lineEnd)}
      />
    )
  }
  if (source.kind === 'blocked') {
    return (
      <ImagePlaceholder state="blocked" alt={props.alt} lineStart={props.lineStart} lineEnd={props.lineEnd} />
    )
  }
  return <ProjectImage key={source.path} path={source.path} {...props} />
}
