/**
 * useShellDemo —— 组件侧取上下文的小钩子。
 *
 * 组件自己调用 useCanvasContext()，不再让主脚本把 ctx 数据一层层传下来。
 * 订阅随组件卸载自动摘除（onBeforeUnmount）。
 */
import { onBeforeUnmount, type ShallowRef } from 'vue'
import { useCanvasContext } from '@mini-canvas/canvas-render'
import {
  openDrawer,
  readNodeCount,
  readThemedButton,
  type CommandField,
  type DocField,
  type UiField,
} from './bindings'

/** 当前主题登记的按钮（换主题时跟着变） */
export function useThemedButton(): ShallowRef<unknown> {
  const { ctx } = useCanvasContext()
  const handle = readThemedButton(ctx.registryOf<unknown>('ui') as unknown as UiField)
  onBeforeUnmount(handle.dispose)
  return handle.button
}

/** 当前节点数（doc 变化时刷新） */
export function useNodeCount(): ShallowRef<number> {
  const { ctx } = useCanvasContext()
  const handle = readNodeCount(ctx.tryGet<DocField>('doc'))
  onBeforeUnmount(handle.dispose)
  return handle.count
}

/** 打开左侧抽屉的动作（经 command 服务） */
export function useOpenDrawer(): () => void {
  const { ctx } = useCanvasContext()
  return () => openDrawer(ctx.tryGet<CommandField>('command'))
}
