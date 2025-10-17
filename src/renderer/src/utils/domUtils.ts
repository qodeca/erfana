export function isElementVisible(el: HTMLElement | null): boolean {
  if (!el) return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  // If element or parent chain is display:none, offsetParent may be null
  // But in jsdom offsetParent is often null; rely primarily on rect
  return true
}

