import type { InjectionKey } from 'vue'
import type { CanvasRuntime } from './CanvasRuntime'

export const CanvasRuntimeKey: InjectionKey<CanvasRuntime> = Symbol('canvasRuntime')