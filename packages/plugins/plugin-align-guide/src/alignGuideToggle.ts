/**
 * alignGuideToggle —— 对齐辅助线「总开关」的装卸接线（纯逻辑：只认 ctx + 一个 attach 回调，零 Vue）。
 *
 * 为什么不写在 apply 里：apply 所在的模块 import 了 .vue 浮层，单测就得起 Vue 编译链；
 * 而"开/关怎么装卸"恰是本插件唯一有分支的逻辑，值得直接单测。故抽成这里：
 *   - 装配时按当前开关决定要不要 attach；
 *   - 订阅 settings，开关一变就 attach / detach（实时生效，无需重载画布）；
 *   - 返回清理函数，由 apply 交给 ctx.effect 随插件 fiber 回收。
 *
 * attach 的语义（浮层组件即全部实现）：挂载 = 订阅拖拽、吸附、画线；卸载 = 三者一起停。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { alignGuideConfigFrom } from './alignGuideConfig'

/** settings 的最小订阅面（与内核 SettingsStore / ctx.settings 能力对齐） */
interface SettingsLike {
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

/**
 * 按开关接好装卸：开启时 attach、关闭时 detach，之后跟随设置面板变化实时切换。
 * @param attach 真正装配浮层，返回撤销函数
 * @returns 清理函数（退订 + 停掉当前装配）
 */
export function bindAlignGuideToggle(ctx: Context, attach: () => () => void): () => void {
  let detach: (() => void) | undefined = alignGuideConfigFrom(ctx).alignGuideEnabled ? attach() : undefined

  const settings = ctx.get<SettingsLike | undefined>('settings')
  const off = settings?.onChange((key) => {
    if (key !== 'alignGuideEnabled') return
    if (alignGuideConfigFrom(ctx).alignGuideEnabled) {
      if (!detach) detach = attach()
    } else {
      detach?.()
      detach = undefined
    }
  })

  return () => {
    off?.dispose()
    detach?.()
    detach = undefined
  }
}
