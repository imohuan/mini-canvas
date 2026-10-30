/**
 * bindTypeDefaultSize —— 把一个「数值型设置」实时绑到某节点类型的**默认尺寸**。
 *
 * 用户口径（2026-10-06）：节点默认尺寸要能在设置面板里配，且**改完实时生效** ——
 * 已经存在的、**没被 resize 过**的节点也要立刻跟着变（有自己尺寸的节点不动）。
 *
 * 做法：apply 时按设置里的值调一次 `doc.updateTypeSize`（写进类型表），并订阅 settings.onChange
 * 在改动时再调一次。类型表里那份是**响应式**的，卡片尺寸会实时跟随 —— 所以旧节点不用刷新就变。
 * 「只影响没 resize 过的节点」由尺寸回落链天然保证：`实测 > node.size > type.defaultSize`，
 * 有自己尺寸的节点取不到默认值。
 *
 * 放在 canvas-base（作者薄入口）而不是各节点插件里复制四遍：规则只有一套，抄四份必然漂移。
 */
import type { Context } from '@mini-canvas/canvas-data'

/** 两个设置 key（宽 / 高），都是 number */
export interface TypeSizeConfigKeys {
  widthKey: string
  heightKey: string
}

/** 只认正有限数；读到坏值（0 / NaN / 负数 / 非数字）就保留上一个可用值，不把尺寸改坏 */
function positive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * 绑定类型默认尺寸到设置项。在插件 apply 里调一次即可。
 *
 * @param ctx         插件 apply 的 ctx
 * @param type        节点类型名（如 'image'）
 * @param defaults    schema 默认值（settings 未就绪 / 未设置时用它）
 * @param keys        两个设置 key
 */
export function bindTypeDefaultSize(
  ctx: Context,
  type: string,
  defaults: { w: number; h: number },
  keys: TypeSizeConfigKeys,
): void {
  const doc = ctx.tryGet<{ updateTypeSize(type: string, size: { w: number; h: number }): void }>('doc')
  if (!doc || typeof doc.updateTypeSize !== 'function') return

  const settings = ctx.tryGet<{
    get(key: string): unknown
    onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  }>('settings')

  /** 读当前设置值（拿不到就回落 schema 默认），两项独立回落 */
  const read = (): { w: number; h: number } => {
    const gw = positive(settings?.get(keys.widthKey))
    const gh = positive(settings?.get(keys.heightKey))
    return { w: gw ?? defaults.w, h: gh ?? defaults.h }
  }

  // 首次：把设置里的值写进类型表（覆盖作者注册时的字面量）
  doc.updateTypeSize(type, read())

  if (settings) {
    const off = settings.onChange((key) => {
      if (key !== keys.widthKey && key !== keys.heightKey) return
      doc.updateTypeSize(type, read())
    })
    // 随插件 scope 回收，不留悬挂监听
    ctx.effect(() => () => off.dispose())
  }
}

/**
 * bindTypeResizeMode —— 把「允许拖拽调整尺寸 + 拖拽方式」的设置实时绑到某节点类型的 resizable 能力。
 *
 * 设置面板改「拖拽方式」（select：free/width/height/aspect）或「允许拖拽调整尺寸」（boolean 开关）时，
 * 经 doc.updateTypeResizability 写回类型表 —— 类型表是响应式的，画布上已有节点立刻跟着变。
 *
 * @param ctx       插件 apply 的 ctx
 * @param type      节点类型名（如 'image'）
 * @param modeKey   拖拽方式的设置 key（select；值 'free'|'width'|'height'|'aspect'）
 * @param enableKey 可选的布尔总开关 key：false = 关掉 resize（resizable=false），
 *                  true/缺省 = 按方式生效。只声明方式、不要开关时省略。
 * @param fallback  设置读不到时的回落值（注册时声明的那份）；缺省 'free'（true 的等价形式）
 */
export function bindTypeResizeMode(
  ctx: Context,
  type: string,
  modeKey: string,
  enableKey?: string,
  fallback: 'width' | 'height' | 'aspect' | 'free' = 'free',
): void {
  const doc = ctx.tryGet<{
    updateTypeResizability(type: string, resizable: boolean | 'width' | 'height' | 'aspect'): void
  }>('doc')
  if (!doc || typeof doc.updateTypeResizability !== 'function') return

  const settings = ctx.tryGet<{
    get(key: string): unknown
    onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  }>('settings')

  const MODES = ['free', 'width', 'height', 'aspect'] as const
  const read = (): boolean | 'width' | 'height' | 'aspect' => {
    if (enableKey && settings?.get(enableKey) === false) return false
    const v = settings?.get(modeKey)
    if (typeof v === 'string' && (MODES as readonly string[]).includes(v)) {
      return v === 'free' ? true : (v as 'width' | 'height' | 'aspect')
    }
    return fallback === 'free' ? true : fallback
  }

  // 首次：把设置里的值写进类型表（覆盖作者注册时的字面量）
  doc.updateTypeResizability(type, read())

  if (settings) {
    const off = settings.onChange((key) => {
      if (key !== modeKey && key !== enableKey) return
      doc.updateTypeResizability(type, read())
    })
    ctx.effect(() => () => off.dispose())
  }
}
