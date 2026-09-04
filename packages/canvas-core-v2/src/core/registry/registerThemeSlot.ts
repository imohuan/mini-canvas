/**
 * registerThemeSlot —— 主题插件"替换一块画布 UI"的注册入口。
 *
 * 用法（主题插件 setup 里）：
 *   registerThemeSlot(ctx, 'edge', MyEdge)          // 换连线
 *   registerThemeSlot(ctx, 'background', MyBg)      // 换背景
 *   registerThemeSlot(ctx, 'nodeShell', MyShell)    // 换节点外壳(可选)
 *   registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
 *
 * 返回的 revoke 自动挂进当前插件 scope：插件被 uninstallPlugin/stop 时该槽位自动回退默认(注销)。
 */
import type { PluginScope } from '../types'
import type { ThemeRegistry, ThemeSlot } from './themeRegistry'

/**
 * 注册一个主题槽位组件/值。
 * @param ctx 插件 setup 拿到的 ctx（真会 ctx.get('themeRegistry')）
 * @param slot 槽位名
 * @param value 组件句柄(opaque) 或 edgeDefaultType 的字面值
 * @returns revoke
 */
export function registerThemeSlot(ctx: PluginScope, slot: ThemeSlot, value: unknown): () => void {
  const theme = safeGet<ThemeRegistry>(ctx, 'themeRegistry')
  if (theme) theme.register(slot, value)
  const revoke = () => theme?.unregister(slot)
  ctx.effect(() => revoke)
  return revoke
}

/** 尽力取一个 ctx 服务：取不到返回 undefined（不抛，便于纯 Node 测试不注入时跳过）。 */
function safeGet<T>(ctx: PluginScope, name: string): T | undefined {
  try {
    return ctx.get<T>(name)
  } catch {
    return undefined
  }
}
