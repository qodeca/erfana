import { useEffect, useRef, useState } from 'react'
import './ResizableDivider.css'

interface ResizableDividerProps {
  onResize: (leftPercentage: number) => void
}

export function ResizableDivider({ onResize }: ResizableDividerProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dividerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)

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
      const containerWidth = containerRect.width

      // Calculate mouse position relative to container
      const mouseX = e.clientX - containerRect.left

      // Calculate percentage (clamped between 20% and 80% for usability)
      let percentage = (mouseX / containerWidth) * 100
      percentage = Math.max(20, Math.min(80, percentage))

      onResize(percentage)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    // Set cursor globally during drag
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, onResize])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  return (
    <div
      ref={dividerRef}
      className={`resizable-divider ${isDragging ? 'dragging' : ''}`}
      onMouseDown={handleMouseDown}
    >
      <div className="divider-handle" />
    </div>
  )
}
