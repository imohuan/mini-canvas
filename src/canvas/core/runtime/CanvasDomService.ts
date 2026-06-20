export class CanvasDomService {
  private cleanups: Array<() => void> = []

  getPane(): HTMLElement | null {
    return document.querySelector('.vue-flow')
  }

  getViewport(): HTMLElement | null {
    return document.querySelector('.vue-flow__viewport')
  }

  onDocument<K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions): () => void {
    document.addEventListener(type, handler as EventListener, options)
    const cleanup = () => document.removeEventListener(type, handler as EventListener, options)
    this.cleanups.push(cleanup)
    return cleanup
  }

  onWindow<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions): () => void {
    window.addEventListener(type, handler as EventListener, options)
    const cleanup = () => window.removeEventListener(type, handler as EventListener, options)
    this.cleanups.push(cleanup)
    return cleanup
  }

  cleanup(): void {
    for (const fn of this.cleanups.splice(0)) fn()
  }
}