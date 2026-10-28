/**
 * bindings —— 把 apply(ctx) 里的上下文数据收成组件可用的窄接口。
 *
 * 为什么单独一层：
 * - 插件只认 Context：ui 目录、doc、command 全从 ctx 取，不 import 主题包 / 渲染包；
 * - 组件只收 props：.vue 里不出现取件钩子、不读 window 全局；
 * - 这里不碰 Vue 组件树，纯数据 + 订阅，Node 单测可直接跑。
 *
 * 生命周期：apply 里用 ctx.effect 挂 dispose；插件卸载时订阅一起摘掉。
 */
import { shallowRef, type Component, type ShallowRef } from 'vue'

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

/** createBindings 需要的上下文服务；doc/command 缺失时降级（节点数 0 / 按钮 no-op） */
export interface ShellDemoServices {
  ui: UiField
  doc?: DocField
  command?: CommandField
}

export interface ShellDemoBindings {
  /** 当前主题登记的 button（换主题时跟着变） */
  readonly button: Readonly<ShallowRef<Component | undefined>>
  /** 当前节点数（doc 变化时更新） */
  readonly nodeCount: Readonly<ShallowRef<number>>
  /** 打开左侧抽屉：走命令，不反向依赖宿主 UI 包 */
  openDrawer(): void
  /** 摘订阅（幂等；apply 里挂到 ctx.effect） */
  dispose(): void
}

export function createBindings(services: ShellDemoServices): ShellDemoBindings {
  // 主题按钮：先读一次，之后订阅 ui 场。换主题 / 热装主题都会走到这里。
  const button = shallowRef<Component | undefined>(
    services.ui.top('button')?.value as Component | undefined,
  )
  const offUi = services.ui.subscribe(() => {
    button.value = services.ui.top('button')?.value as Component | undefined
  })

  // 节点数：doc 是可选的（极简宿主 / 单测里可能没有画布基础服务）。
  const nodeCount = shallowRef(0)
  const doc = services.doc
  let offDoc: (() => void) | undefined
  if (doc) {
    const sync = (): void => {
      nodeCount.value = doc.getNodes().length
    }
    sync()
    offDoc = doc.subscribe(sync)
  }

  let disposed = false
  return {
    button,
    nodeCount,
    openDrawer() {
      services.command?.execute('shell:open-drawer')
    },
    dispose() {
      if (disposed) return
      disposed = true
      offUi.dispose()
      offDoc?.()
    },
  }
}
