/**
 * importPack —— 把包落回画布：写脚本 + 还原节点 + **版本化**（用户 2026-10-13 拍板）。
 *
 * ## 什么时候升版本
 *
 * 逐个脚本与本机同名文件比 sha256：
 *   · 本机没有          → 直接写入（不升版本）
 *   · 同名 + 内容一样    → 用本机那份（不写、不升版本）
 *   · 同名 + 内容不同    → **冲突 → 整包升版本**
 *
 * **只要有一个冲突就整包升**。不搞"一半改名一半不改"：一个节点的界面和它的脚本是
 * 配套的一套东西，只换一半就会出现"v2 的界面调着 v1 的脚本"——看着能跑、行为是混的。
 *
 * ## 升版本要改哪四处（一处不能漏）
 *
 *   ① 脚本文件   scale.mjs        → scale_v2.mjs
 *   ② 依赖声明   { scale: … }     → { scale_v2: … }
 *   ③ 界面引用   name: "scale"    → name: "scale_v2"
 *   ④ 节点标题   视频可视化        → 视频可视化_v2
 *
 * 产物就是用户那句"一个全新的 V2 节点系统"：自带一整套脚本，与 v1 各跑各的。
 */
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolveScriptPath, isSafeScriptName } from './scripts.js'
import { UI_SCRIPTS_KEY } from './declarePlan.js'
import type { UnpackedPack } from './pack.js'

/** 版本后缀的写法（与脚本名同一套：下划线，无空格） */
export const VERSION_SEP = '_v'

/** 冲突怎么处理（用户口径：不用点确认，直接整包升版本） */
export type ImportMode = 'auto'

/** 要落盘的一个脚本 */
export interface ScriptWrite {
  /** 脚本名（已按版本改好） */
  name: string
  text: string
}

/** 导入计划（**只算，不写** —— 这样能先体检再落地，也能单测） */
export interface ImportPlan {
  /** as-is = 原样导入；bump = 整包升版本 */
  action: 'as-is' | 'bump'
  /** bump 时的版本号（2 就是 _v2） */
  version?: number
  /** 改名对照表（bump 时非空） */
  renames: Array<{ from: string; to: string }>
  /** 要写进脚本目录的 */
  write: ScriptWrite[]
  /** 已存在且内容一样 → 跳过（幂等） */
  skip: string[]
  /** 包里的脚本名（原样） */
  scripts: string[]
  /** 还原出来的节点数据（声明已按版本改写） */
  data: Record<string, unknown>
  /** 界面代码（引用已按版本改写） */
  html: string
  /** 节点标题（bump 时带 _vN） */
  title: string
}

/** 算一段文本的 sha256（与打包那侧同一算法，否则永远对不上） */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 读本机某个脚本的内容（不存在 / 名字非法 → undefined） */
async function readLocal(dir: string, name: string): Promise<string | undefined> {
  const abs = resolveScriptPath(dir, name)
  if (!abs) return undefined
  try {
    return await fs.readFile(abs, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * 找第一个没被占用的版本号。
 *
 * 从 2 起（v1 就是原来那个，没有后缀）；每个脚本名都要检查，
 * 取"所有脚本都能用的最小公共版本"——**整包同一个版本号**，不各升各的。
 */
async function findVersion(dir: string, names: readonly string[]): Promise<number> {
  for (let v = 2; v < 1000; v++) {
    let free = true
    for (const n of names) {
      if (await readLocal(dir, n + VERSION_SEP + v)) {
        free = false
        break
      }
    }
    if (free) return v
  }
  return 1000
}

/**
 * 把界面里对脚本的引用改名。
 *
 * 只改**这次真的改过名的那些**脚本（按名字精确替换），别的 name: "xxx" 一个字不动 ——
 * 界面里到处是 name，乱改会把用户的东西改坏。
 */
export function rewriteHtmlRefs(html: string, renames: ReadonlyArray<{ from: string; to: string }>): string {
  if (renames.length === 0) return html
  const renameOf = new Map(renames.map((r) => [r.from, r.to]))
  // 一次扫完所有「name 后面跟 : 或 =，再跟一个（可带引号的）值」的地方，按名字查表改。
  //
  // 为什么要一次扫而不是"每个改名各跑一遍 replace"：
  //   ① 四种写法要一起覆盖（`name: "x"`、`'name': 'x'`、`name=x`、`name='x'`）——
  //      逐写法写正则容易漏一种（第一版就漏了 `name='x'`）；
  //   ② 只改**这次真的改名了**的那些：界面里满地是 name，无条件替换会改坏用户的东西。
  // \bname 保证 `filename:` 不会被误伤（前面是字母，词边界不成立）。
  const re = /(\bname["\']?\s*[=:]\s*)(["\']?)([A-Za-z0-9_-]{1,64})\2(?![A-Za-z0-9_-])/g
  return html.replace(re, (whole, pre: string, quote: string, name: string) => {
    const to = renameOf.get(name)
    return to ? pre + quote + to + quote : whole
  })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 标题加版本后缀；已经带 _vN 的就换掉（不叠成 _v2_v2） */
export function titledWithVersion(title: string, version: number): string {
  const base = title.replace(new RegExp(VERSION_SEP + '\\d+$'), '')
  return base + VERSION_SEP + version
}

/**
 * 算一份导入计划。
 *
 * @param pack 已解开的包
 * @param dir 脚本目录
 */
export async function planImport(pack: UnpackedPack, dir: string): Promise<ImportPlan> {
  const names = Object.keys(pack.scripts).filter(isSafeScriptName)
  const data = { ...((pack.node.data as Record<string, unknown>) ?? {}) }
  const baseTitle = typeof data.label === 'string' && data.label ? data.label : '可视化节点'

  // ⚠️ **界面代码只放一处**（data.uiHtml）。
  //
  // 第一版把改写后的界面放在 plan.html，而 plan.data 里还留着包里那份**未改写**的 uiHtml ——
  // 而落地时前端只用了 node.data，于是升版本之后：脚本叫 scale_v2、声明写 scale_v2、
  // **界面还在调 scale** → 导入完点一下就是 403。
  // 「一个值放两处、其中一处没人读」就是这类 bug 的温床，所以这里只认 data.uiHtml。
  const withHtml = (html: string): Record<string, unknown> => ({ ...data, uiHtml: html })

  // 逐个比：本机没有 → 要写；内容一样 → 跳过；内容不同 → 冲突
  const toWrite: ScriptWrite[] = []
  const skip: string[] = []
  let conflicted = false
  for (const name of names) {
    const text = pack.scripts[name]!
    const local = await readLocal(dir, name)
    if (local === undefined) {
      toWrite.push({ name, text })
      continue
    }
    if (sha256(local) === sha256(text)) {
      skip.push(name)
      continue
    }
    conflicted = true
  }

  if (!conflicted) {
    return {
      action: 'as-is',
      renames: [],
      write: toWrite,
      skip,
      scripts: names,
      data: withHtml(pack.html),
      html: pack.html,
      title: baseTitle,
    }
  }

  // 冲突 → 整包升版本：所有脚本（含"本机没有"的那些）统一改名
  const version = await findVersion(dir, names)
  const renames = names.map((from) => ({ from, to: from + VERSION_SEP + version }))
  const renameOf = new Map(renames.map((r) => [r.from, r.to]))

  const decl: Record<string, unknown> = {}
  const declared = data[UI_SCRIPTS_KEY]
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const [k, v] of Object.entries(declared as Record<string, unknown>)) {
      const to = renameOf.get(k)
      if (to) decl[to] = v
      else decl[k] = v
    }
  } else {
    // 没声明过也要把新名字写进去（否则升版本之后节点反而调不动自己的脚本）
    for (const r of renames) decl[r.to] = {}
  }

  return {
    action: 'bump',
    version,
    renames,
    write: names.map((from) => ({ name: renameOf.get(from)!, text: pack.scripts[from]! })),
    skip: [],
    scripts: names,
    data: {
      ...withHtml(rewriteHtmlRefs(pack.html, renames)),
      [UI_SCRIPTS_KEY]: decl,
      label: titledWithVersion(baseTitle, version),
    },
    html: rewriteHtmlRefs(pack.html, renames),
    title: titledWithVersion(baseTitle, version),
  }
}

