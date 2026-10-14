/**
 * scripts —— 任务脚本目录的读与校验（**纯逻辑，不依赖后台 ctx**，可直接单测）。
 *
 * 目录约定（一条都不能松）：
 * - 只认 `.mjs`：不管包是不是 type:module，它都按 ES 模块解析；而 `.js` 在
 *   CommonJS 环境里会被当脚本直接跑，且是随手就能生成的扩展名，不该被我们扫进来。
 * - 名字只允许 `[A-Za-z0-9_-]{1,64}`：画布上写什么都会原样传到这里，
 *   不挡就是路径穿越（`name: "../../evil"`）。
 * - 目录里 `.` 开头的文件、以及 `lib/` 子目录都不算「一件事」，不进清单
 *   （但脚本自己可以 import 它们）。
 * - `_` 开头 = **未验证的在建脚本**（用户口径 2026-10-14）：不进「可用清单」，
 *   但**照样能被调用**（否则作者没法测它）。见 draftScriptName / isDraftScriptName。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 只认这一个后缀 */
export const SCRIPT_EXT = '.mjs'

/** 脚本名白名单（与 canvasResources 的槽位 id 同一套判据） */
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 不进清单的子目录名（公共小工具放这里） */
export const LIB_DIR = 'lib'

/**
 * 「未验证的在建脚本」的前缀（用户口径 2026-10-14）。
 *
 * 生产环境踩到的问题：Agent 每次写脚本前先拿清单看"之前有什么"，但那份清单里
 * 混着**半成品**和**老 API 版本的脚本** —— 拿起来一调就失败，白费一轮。
 * 所以定三条约定的第一条：**新脚本先用下划线打头**；跑通了再把下划线去掉。
 *
 *   _scale.mjs  →  在建（不进清单，只能按名字直接调来测）
 *   scale.mjs   →  已验证（进清单，别人可以放心用）
 */
export const DRAFT_PREFIX = '_'

/** 这个脚本名是不是「在建」（下划线打头） */
export function isDraftScriptName(name: string): boolean {
  return typeof name === 'string' && name.startsWith(DRAFT_PREFIX)
}

/** 把「已验证的名字」变成「在建的名字」（已经在建就原样返回） */
export function toDraftName(name: string): string {
  return isDraftScriptName(name) ? name : DRAFT_PREFIX + name
}

export function isSafeScriptName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name)
}

/**
 * 名字 → 绝对路径；不合法返回 undefined。
 *
 * 两道保险：白名单先挡一次，`startsWith(base + sep)` 再挡一次 ——
 * 后者是防「将来白名单被放宽」时悄悄漏出目录外。
 */
export function resolveScriptPath(dir: string, name: unknown): string | undefined {
  if (!isSafeScriptName(name)) return undefined
  const base = path.resolve(dir)
  const abs = path.resolve(base, name + SCRIPT_EXT)
  return abs.startsWith(base + path.sep) ? abs : undefined
}

/** 某个目录下有哪些脚本名（已排序；目录不存在 → 空数组，不是错误） */
export async function listScriptNames(dir: string): Promise<string[]> {
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const names: string[] = []
  for (const e of entries) {
    if (!e.isFile()) continue // 软链/目录一律跳过（软链能把扫描带出目录）
    const n = e.name
    if (!n.endsWith(SCRIPT_EXT)) continue
    // `.` 开头的是隐藏文件（.DS_Store 这类），一律不看。
    // `_` 开头的是**在建脚本**：也不进这份「可用清单」—— 但它没被禁止存在，
    // 作者仍可按 `_名字` 直接调它来测（见 listAllScriptNames）。
    if (n.startsWith('.') || n.startsWith(DRAFT_PREFIX)) continue
    const base = n.slice(0, -SCRIPT_EXT.length)
    if (!isSafeScriptName(base)) continue
    names.push(base)
  }
  return names.sort()
}

/**
 * 目录里**全部**脚本名（含下划线打头的在建脚本；不含隐藏文件与 lib/）。
 *
 * 为什么要单独一个函数：`listScriptNames` 是给 AI 看的那份**可用清单**（只含已验证），
 * 而作者要调试自己的在建脚本、canvas_fn_call 要能按名字调到它 —— 那些地方需要全量。
 */
export async function listAllScriptNames(dir: string): Promise<string[]> {
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const names: string[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    const n = e.name
    if (!n.endsWith(SCRIPT_EXT)) continue
    if (n.startsWith('.')) continue
    const base = n.slice(0, -SCRIPT_EXT.length)
    if (!isSafeScriptName(base)) continue
    names.push(base)
  }
  return names.sort()
}

/** 一个模块导出里有哪些**函数**（清单与报错里那句「可用的：…」都用它） */
export function exportedFunctions(mod: Record<string, unknown>): string[] {
  return Object.keys(mod)
    .filter((k) => typeof (mod as Record<string, unknown>)[k] === 'function')
    .sort()
}

/**
 * 「这个脚本里没有那个函数」的报错文案。
 * 把可用的函数名一起带出来 —— 否则调用方只能猜自己写错了哪个字母。
 */
export function missingMethodMessage(scriptName: string, methods: unknown, available: string[]): string {
  return (
    '脚本 ' + scriptName + ' 里没有导出函数 ' + String(methods) +
    (available.length ? '（可用的：' + available.join('、') + '）' : '（这个脚本一个函数都没导出）')
  )
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
