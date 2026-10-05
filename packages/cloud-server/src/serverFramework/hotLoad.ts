/**
 * hotLoad —— 运行期热装/热卸外挂后台插件（从 NPM 现装、或手工丢文件后不必重启）。
 *
 * ## 为什么可行
 *
 * 1. 内核支持运行期装载；2. 路由代理每次请求现查注册场；3. Hono 路由表冻死靠 catch-all 兜底。
 *
 * ## 为什么要经 ctx.runtime（而不是直接 ctx.installPlugin）
 *
 * 插件从 ctx 拿到的是**作用域 ctx**（deriveScope 产物），上面没有 installPlugin/uninstallPlugin
 * ——那是根 Context 的方法。host 把它们经能力段的 ctx.runtime 暴露出来（见 capabilityLayer.ts）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PluginScope } from '@mini-canvas/kernel'
import { isValidServerPlugin } from './pluginLoader.js'

/** id（文件名）→ 内核真实插件名。装的时候记下，卸的时候按它摘（两者可能不同名）。 */
const installedNames = new Map<string, string>()

/**
 * 运行期热装进来的 id → 插件名（loaded 现算用）。
 *
 * 为什么留 id：卸载时按 id 精确摘掉自己的那条，避免"卸了还在列表里"的幽灵项（用户实测）。
 */
const hotLoaded = new Map<string, string>()
/** 取"运行期热装且仍活着"的插件名（server-plugins 路由的 loaded 用） */
export function hotLoadedNames(): string[] { return [...hotLoaded.values()] }

/** 按 id 摘掉热装记录（卸载时用；同时返回它的插件名供内核卸载） */
export function hotLoadedNameOf(id: string): string | undefined { return hotLoaded.get(id) }
export function hotLoadedForget(id: string): void { hotLoaded.delete(id) }

export interface HotLoadResult {
  ok: boolean
  error?: string
  /** 装载成功时：插件在内核里的真实名字（卸载要用它，可能与文件名不同） */
  name?: string
}

/** 从作用域 ctx 取 runtime 能力（可能不存在：老 host / 未开该能力段） */
function runtimeOf(ctx: PluginScope): { install: (m: unknown) => void; uninstall: (n: string) => boolean } | undefined {
  return (ctx as unknown as { runtime?: { install: (m: unknown) => void; uninstall: (n: string) => boolean } }).runtime
}

/**
 * 运行时装载一个已落盘的后台插件（按 id = 文件名去 .js）。
 *
 * 直接读那个文件并 import，不扫全目录：插件名（如 showcase）与文件名（如
 * imohuan__plugin-showcase）不必同名 —— 扫全目录再按名匹配会错配（实测踩过）。
 */
export async function hotInstallServerPlugin(
  ctx: PluginScope,
  dir: string,
  id: string,
): Promise<HotLoadResult> {
  const runtime = runtimeOf(ctx)
  if (!runtime) return { ok: false, error: "宿主未提供运行期装卸能力（ctx.runtime）" }
  try {
    const file = path.join(dir, id + '.js')
    const text = await fs.readFile(file, 'utf8')
    const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as Record<string, unknown>
    const candidate = (mod.default ?? mod) as unknown
    if (!isValidServerPlugin(candidate)) return { ok: false, error: "不是合法后台插件（需导出 name 与 apply/setup）" }
    runtime.install(candidate)
    installedNames.set(id, candidate.name)
    hotLoaded.set(id, candidate.name)
    return { ok: true, name: candidate.name }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 运行时卸载一个后台插件。
 *
 * 插件名与文件名可能不同（包 @imohuan/plugin-showcase 的 name 是 showcase），
 * 故按"内核里当前登记的插件名"逐个试：先用装时记下的真名，再退化为 id 的几种归一形态。
 */
export function hotUninstallServerPlugin(ctx: PluginScope, id: string, knownName?: string): HotLoadResult {
  const runtime = runtimeOf(ctx)
  if (!runtime) return { ok: false, error: "宿主未提供运行期装卸能力（ctx.runtime）" }
  const candidates = [
    knownName,
    hotLoaded.get(id), // 热装时记下的真名（最准）
    installedNames.get(id),
    id,
    id.replace(/^[^_]*__/, ""),
    id.replace(/__/g, "-"),
    // 兜底：去掉常见包前缀后剩下的部分（mini-canvas-plugin-showcase → showcase）
    id.replace(/^mini-canvas-plugin-/, ""),
    id.replace(/^mini-canvas-/, ""),
  ].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  )
  try {
    for (const name of candidates) {
      if (runtime.uninstall(name)) {
        installedNames.delete(id)
        hotLoaded.delete(id)
        return { ok: true }
      }
    }
    // 内核里确实没有：仍要清掉加载记录，否则列表留幽灵项
    installedNames.delete(id)
    hotLoaded.delete(id)
    return { ok: false, error: "内核里没有该插件（可能从未装载）：" + id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
