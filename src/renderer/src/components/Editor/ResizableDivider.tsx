// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useRef, useState } from 'react'
import './ResizableDivider.css'

interface ResizableDividerProps {
  onResize: (percentage: number) => void
  onResizeEnd?: (percentage: number) => void
  orientation?: 'vertical' | 'horizontal'
}

export function ResizableDivider({ onResize, onResizeEnd, orientation = 'vertical' }: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const lastPercentageRef = useRef<number>(50)

  useEffect(() => {
    // Find the parent container (.editor-content) to calculate relative position
    if (dividerRef.current) {
      containerRef.current = dividerRef.current.closest('.editor-content')
    }
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()

      let percentage: number

      if (orientation === 'horizontal') {
        // For horizontal divider: track vertical position
        const containerHeight = containerRect.height
        const mouseY = e.clientY - containerRect.top

        // Calculate percentage (clamped between 20% and 80% for usability)
        percentage = (mouseY / containerHeight) * 100
      } else {
        // For vertical divider: track horizontal position (original behavior)
        const containerWidth = containerRect.width
        const mouseX = e.clientX - containerRect.left

        // Calculate percentage (clamped between 20% and 80% for usability)
        percentage = (mouseX / containerWidth) * 100
      }

      // Clamp between 20% and 80% for usability
      percentage = Math.max(20, Math.min(80, percentage))

      lastPercentageRef.current = percentage
      onResize(percentage)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Notify resize end with the last computed percentage
      if (onResizeEnd) {
        onResizeEnd(lastPercentageRef.current)
      }
    }

    // Set cursor globally during drag based on orientation
    const cursor = orientation === 'horizontal' ? 'row-resize' : 'col-resize'
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, onResize, orientation])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  return (
    <div
      ref={dividerRef}
      className={`resizable-divider ${orientation} ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <div className="divider-handle" />
    </div>
  )
}
