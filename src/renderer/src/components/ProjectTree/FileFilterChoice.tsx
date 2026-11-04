// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileFilterChoice – the project tree's "Show" filter (#452).
 *
 * A one-of-two choice drawn as the Segmented control card's radio group
 * (docs/designs/project-tree/toolbar-icons.html, option A): role="radiogroup"
 * named by its visible "Show" label, each cell role="radio" with aria-checked,
 * one tab stop (roving tabindex), and the arrow keys move and check.
 */

import { useId, useRef } from 'react'
import { FolderTree, FileText } from 'lucide-react'
import type { FilterMode } from '../../types/filters'

interface FilterOption {
  mode: FilterMode
  label: string
  title: string
  Icon: typeof FileText
}

const FILTER_OPTIONS: readonly FilterOption[] = [
  { mode: 'all', label: 'All files', title: 'Show all files and folders', Icon: FolderTree },
  { mode: 'markdown', label: 'Markdown only', title: 'Show only markdown files and their folders', Icon: FileText }
]

const ARROW_STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

interface FileFilterChoiceProps {
  filterMode: FilterMode
  onFilterModeChange: (mode: FilterMode) => void
}

export function FileFilterChoice({ filterMode, onFilterModeChange }: FileFilterChoiceProps) {
  const labelId = useId()
  const cellRefs = useRef<Partial<Record<FilterMode, HTMLButtonElement | null>>>({})

  const choose = (mode: FilterMode): void => {
    if (mode !== filterMode) onFilterModeChange(mode)
    cellRefs.current[mode]?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    const step = ARROW_STEP[event.key]
    if (step === undefined) return
    event.preventDefault()
    const at = FILTER_OPTIONS.findIndex(option => option.mode === filterMode)
    const next = FILTER_OPTIONS[(at + step + FILTER_OPTIONS.length) % FILTER_OPTIONS.length]
    choose(next.mode)
  }

  return (
    <div className="file-filter">
      <span id={labelId} className="file-filter__label">Show</span>
      <div className="file-filter__cells" role="radiogroup" aria-labelledby={labelId} onKeyDown={handleKeyDown}>
        {FILTER_OPTIONS.map(({ mode, label, title, Icon }) => {
          const checked = filterMode === mode
          return (
            <button
              key={mode}
              ref={node => {
                cellRefs.current[mode] = node
              }}
              type="button"
              role="radio"
              className="file-filter__cell"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={title}
              onClick={() => choose(mode)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
