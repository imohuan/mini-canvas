/**
 * bindings —— 从 ctx 取数据的纯逻辑（不依赖 Vue 组件树）。
 *
 * 组件里先 useCanvasContext() 拿 ctx，再把 ui/doc/command 交给这里；
 * 这里只做“读 + 订阅 + 返回 Ref”，所以 Node 单测可以直接跑。
 */
import { shallowRef, type ShallowRef } from 'vue'

/** ui 注册场的最小读取面（ctx.registryOf('ui') 的子集） */
export interface UiField {
  top(name: string): { value: unknown } | undefined
  subscribe(fn: () => void): { dispose(): void }
}

/** doc 服务的最小读取面（ctx.get('doc') 的子集） */
export interface DocField {
  getNodes(): unknown[]
  subscribe(fn: () => void): () => void
}

/** command 服务的最小执行面（ctx.get('command') 的子集） */
export interface CommandField {
  execute(id: string, payload?: unknown): unknown
}

/** 主题按钮：当前 ui 场里 button 的赢家；换主题时 Ref 跟着变 */
export function readThemedButton(ui?: UiField): {
  button: ShallowRef<unknown>
  dispose(): void
} {
  const button = shallowRef<unknown>(ui?.top('button')?.value)
  const sub = ui?.subscribe(() => {
    button.value = ui.top('button')?.value
  })
  let disposed = false
  return {
    button,
    dispose() {
      if (disposed) return
      disposed = true
      sub?.dispose()
    },
  }
}

/** 节点数：doc 变化时刷新；没有 doc 的极简宿主保持 0 */
export function readNodeCount(doc?: DocField): {
  count: ShallowRef<number>
  dispose(): void
} {
  const count = shallowRef(0)
  const sync = (): void => {
    count.value = doc ? doc.getNodes().length : 0
  }
  sync()
  const off = doc?.subscribe(sync)
  let disposed = false
  return {
    count,
    dispose() {
      if (disposed) return
      disposed = true
      off?.()
    },
  }
}

/** 打开左侧抽屉：走宿主外壳命令，不反向依赖 UI 包 */
export function openDrawer(command?: CommandField): void {
  command?.execute('shell:open-drawer')
}
