export class TypedEventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<(payload: any) => void>>()

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler as any)
    return () => this.off(event, handler)
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.handlers.get(event)?.delete(handler as any)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload)
  }

  clear(): void {
    this.handlers.clear()
  }
}