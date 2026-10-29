import { useCanvasRuntime } from './useCanvasRuntime'

export function usePluginApi<T = unknown>(name: string): T | null {
  return useCanvasRuntime().getPluginAPI<T>(name)
}