import { inject } from 'vue'
import { CanvasRuntimeKey } from './CanvasRuntimeKey'
import type { CanvasRuntime } from './CanvasRuntime'

export function useCanvasRuntime(): CanvasRuntime {
  const runtime = inject(CanvasRuntimeKey)
  if (!runtime) throw new Error('useCanvasRuntime() must be used inside CanvasRuntimeProvider')
  return runtime
}