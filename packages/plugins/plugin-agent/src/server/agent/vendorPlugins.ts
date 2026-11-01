/**
 * 随包自带的插件（vendor/plugins/**）—— 目标 hook 的**仓库内**来源。
 *
 * 为什么需要它（用户口径 2026-10-11）：
 * 目标功能靠 SDK 自带插件 `@penguinharness/goal` 里的 start.mjs / stop.mjs，
 * 而那个包是**外部 npm 依赖**：
 *   · cloud-server 打包时 penguin-core 是 external（不打进产物）；
 *   · SDK 按**它自己的** package.json 去 node_modules 里找 `@penguinharness/goal`；
 *   · 那脚本就是一堆独立的 .mjs 文件，不在我们的 JS 里。
 * 于是「换个环境 / 只发打包产物 / node_modules 里没有它」⇒ 脚本找不到 ⇒ 目标功能缺席。
 *
 * 做法：把 goal 插件的内容**签进本仓库**（`vendor/plugins/goal/`），启动时优先从这里装；
 * 这样它跟着代码走、可 review、可改，不再依赖 node_modules 里那份。
 *
 * 目录形状与 SDK 的插件目录**完全一致**（plugin.json + icon.svg + hooks/*.mjs），
 * 只是少了 package.json（那是 npm 打包用的，安装 hook 不需要）。
 *
 * 落点叫 `vendor-plugins/`（不是 `vendor/`）：仓库根有另一条 `vendor/` 忽略规则
 * （分析 VueFlow 源码用的浅克隆），同名会撞上 —— 本目录是**要入库的源码**。
 */
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HookManifest } from '@prismshadow/penguin-core'

/**
 * vendor 目录的落点（**由宿主注入**）。
 *
 * 为什么不再相对 `import.meta.url` 算：本文件会被打成**单文件后台产物**（data: URL 加载，
 * 没有包根概念），也可能被 esbuild 内联进别的包 —— 两种情况下相对路径都会指到一个不存在
 * 的目录，goal hook 于是静默装不上。改成装配时显式告诉它「资产在哪」，只留一个 getter。
 */
let vendorDir = ''

/**
 * 源码直跑（tsx / vitest）时的缺省落点：`plugin-agent/vendor-plugins/`。
 *
 * 打包成单文件后台产物时 `import.meta.url` 不是真实文件路径，算出来会是一个不存在的目录；
 * 那种场景必须由启动器 `setVendorPluginsDir()` 显式告知。这里只负责「没告知时也别崩」。
 */
function defaultVendorDir(): string {
  try {
    // 两种落点都要认：
    //   · 源码直跑：<pkg>/src/server/agent/vendorPlugins.ts  → <pkg>/vendor-plugins
    //   · 单文件产物：<pkg>/dist/server.js                  → <pkg>/dist/vendor-plugins
    // 先看产物旁边那份（打包后的真实位置），没有再回落到源码布局。
    const near = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'vendor-plugins')
    if (existsSync(near)) return near
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vendor-plugins')
  } catch {
    return ''
  }
}

/** 装配时调一次：把 vendor 资产目录交给本模块。 */
export function setVendorPluginsDir(dir: string): void {
  vendorDir = dir
}

/** vendor 根目录 */
export function vendorPluginsDir(): string {
  return vendorDir || defaultVendorDir()
}

/** 一个 vendor 插件：SDK 形状的 manifest + 脚本文件（相对路径 → 文本） */
export interface VendoredPlugin {
  name: string
  version: string
  manifest: HookManifest
  /** hooks/ 下的文件（`start.mjs` / `stop.mjs` / `lib.mjs` …），key 是相对 hooks/ 的路径 */
  files: Record<string, string>
  icon?: string
}

/**
 * 读一个 vendor 插件（`vendor-plugins/<name>/`）。
 *
 * 读不到 / 形状不对一律返回 null（调用方据此回落到 SDK 那份）—— 绝不抛错：
 * vendor 缺失只是「这个来源不可用」，不该把服务拖崩。
 *
 * 形状与 SDK 的 `readPluginDir` 对齐：plugin.json 里 hooks.{user_prompt,stop,pre_tool_use}，
 * 脚本在 hooks/ 下（**递归**收，与 SDK 的 readDirFiles 同款）。
 */
export async function readVendoredPlugin(name: string): Promise<VendoredPlugin | null> {
  const dir = path.join(vendorPluginsDir(), name)
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8')) as {
      description?: unknown
      description_zh?: unknown
      version?: unknown
      hooks?: { user_prompt?: unknown; stop?: unknown; pre_tool_use?: unknown }
    }
    const version = typeof raw.version === 'string' ? raw.version : ''
    if (!version) return null
    const files = await readDirText(path.join(dir, 'hooks'))
    if (!Object.keys(files).length) return null
    const manifest: HookManifest = {
      name,
      description: typeof raw.description === 'string' ? raw.description : name,
      ...(typeof raw.description_zh === 'string' ? { description_zh: raw.description_zh } : {}),
      version,
      // 只透传 SDK 认的三个 hook 点（plugin.json 里可能还有 category 等其它字段）
      stop: asCommandList(raw.hooks?.stop),
      pre_tool_use: asCommandList(raw.hooks?.pre_tool_use),
      user_prompt: asCommandList(raw.hooks?.user_prompt),
    }
    let icon: string | undefined
    try {
      icon = await fs.readFile(path.join(dir, 'icon.svg'), 'utf8')
    } catch {
      /* 图标可选 */
    }
    return { name, version, manifest, files, ...(icon !== undefined ? { icon } : {}) }
  } catch {
    return null
  }
}

/** SDK 的 HookCommand 形状：{command, timeout?}。坏数据一律丢，不瞎猜。 */
function asCommandList(raw: unknown): Array<{ command: string; timeout?: number }> {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c) => {
    const o = c as { command?: unknown; timeout?: unknown }
    if (!o || typeof o.command !== 'string' || !o.command) return []
    return [{ command: o.command, ...(typeof o.timeout === 'number' ? { timeout: o.timeout } : {}) }]
  })
}

/** 递归读一个目录下的所有文件（相对路径 → utf8 文本）；目录不存在返回空对象 */
async function readDirText(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(abs, { withFileTypes: true })
    for (const e of entries) {
      const childRel = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) await walk(path.join(abs, e.name), childRel)
      else if (e.isFile()) out[childRel] = await fs.readFile(path.join(abs, e.name), 'utf8')
    }
  }
  try {
    await walk(dir, '')
  } catch {
    return {}
  }
  return out
}
