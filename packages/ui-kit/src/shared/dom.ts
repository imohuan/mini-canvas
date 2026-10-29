const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    return el.offsetParent !== null || el === document.activeElement
  })
}

export function focusFirst(root: HTMLElement | null): void {
  const preferred = root?.querySelector<HTMLElement>('[data-autofocus]')
  const target = preferred ?? focusableIn(root)[0] ?? root
  target?.focus?.()
}

export function nextTickFrame(callback: () => void): number {
  return requestAnimationFrame(() => requestAnimationFrame(callback))
}

export function isElement(value: unknown): value is HTMLElement {
  return typeof value === 'object' && value !== null && 'nodeType' in value
}
