/**
 * 依赖声明 —— 读节点声明 / 算出「写完界面后声明该长什么样」。
 *
 * ## 为什么不再自己去读 doc（2026-10-13 踩到的坑）
 *
 * 第一版让这个模块自己去 `ctx.tryGet("doc")` 读节点、再写回。真机上它**静默什么都不做**：
 * 提示词里那条路（canvas_ui_write）拿得到节点，这条却拿不到 —— 两条路读的不是同一个东西。
 * 症状极难查：界面照写、返回值正常、日志干净，只有节点上少了声明，
 * 而少声明的后果要等到"用户点一下被 403"才暴露。
 *
 * 所以现在改成：**调用方把节点数据传进来，本模块只做纯计算**，
 * 写完声明也走调用方那条**已经证明可用**的写入路径（与写 uiHtml 同一次写）。
 */
import { detectScriptCalls, mergeDeclared, type ScriptDecl } from './declare.js'
import { listAllScriptNames, listScriptNames, resolveScriptPath } from './scripts.js'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

/** 节点 data 上那个字段名（与 declare/authorize 同一套约定） */
export const UI_SCRIPTS_KEY = 'uiScripts'

/** 脚本文件内容的 sha256（拿不到就 undefined —— 声明允许只有名字） */
async function shaOf(dir: string, name: string): Promise<string | undefined> {
  const abs = resolveScriptPath(dir, name)
  if (!abs) return undefined
  try {
    return createHash('sha256').update(await fs.readFile(abs)).digest('hex')
  } catch {
    return undefined
  }
}

export interface DeclarePlan {
  /** 这次**新补进去**的脚本名（AI 自己已经声明过的不算） */
  added: string[]
  /** 合并后的完整声明（写回时用它） */
  next: Record<string, ScriptDecl>
}

/**
 * 按"界面 HTML + 节点现有声明"算出写回用的声明。
 *
 * @returns null = **不需要改**（没扫到东西 / 已经全都声明过了）
 *   —— 返回 null 时调用方一个字都别写，"顺手补"绝不能变成"顺手改数据"。
 */
export async function planDeclared(
  html: string,
  existing: unknown,
  dir: string,
  now: number,
): Promise<DeclarePlan | null> {
  let names: string[]
  try {
    names = await listScriptNames(dir)
  } catch {
    return null
  }
  // 只认机器上真实存在的脚本名：界面里满地是 name: "xxx"，不过滤就是噪音
  const found = detectScriptCalls(html, names)
  if (found.length === 0) return null

  const beforeSet = new Set(Object.keys((existing as Record<string, unknown>) ?? {}))
  const shas = new Map<string, string | undefined>()
  for (const n of found) shas.set(n, await shaOf(dir, n))
  const next = mergeDeclared(existing, found, (n) => shas.get(n), now)
  const added = found.filter((n) => !beforeSet.has(n))
  if (added.length === 0) return null
  return { added, next }
}

/**
 * 把**已知要跑**的脚本名补进声明（不扫 HTML）。
 *
 * 用在哪：`canvas_fn_call` 是 Agent 直接点名一个脚本去跑，没有界面可扫；
 * 但跑完产物要落到这个节点上，节点就必须先声明它（否则界面之后调它会被 403，
 * 打包也带不上这份脚本）。
 *
 * 与 `planDeclared` 同样只做纯计算：已有的声明一条都不丢，只把缺的名字补上。
 *
 * @returns null = 已经声明过（调用方一个字都别写）
 */
export async function planDeclaredForScripts(
  names: readonly string[],
  existing: unknown,
  dir: string,
  now: number,
): Promise<DeclarePlan | null> {
  const valid: string[] = []
  // 用**全量**清单：在建脚本（`_名字`）同样是真实存在的脚本，跑完这一趟当然要记进声明。
  // 用可用清单（listScriptNames）的话，下划线脚本永远补不进去 —— 真机踩到的就是这个：
  // `_pixelize` 跑成功了，节点上却还是空的声明，界面之后一调它就被 403。
  let known: Set<string>
  try {
    known = new Set(await listAllScriptNames(dir))
  } catch {
    return null
  }
  for (const n of names) {
    // 只认机器上真实存在的脚本名（在建脚本带下划线也算存在）
    if (typeof n === 'string' && known.has(n)) valid.push(n)
  }
  if (valid.length === 0) return null

  const beforeSet = new Set(Object.keys((existing as Record<string, unknown>) ?? {}))
  const added = [...new Set(valid)].filter((n) => !beforeSet.has(n))
  if (added.length === 0) return null

  const shas = new Map<string, string | undefined>()
  for (const n of added) shas.set(n, await shaOf(dir, n))
  return { added, next: mergeDeclared(existing, added, (n) => shas.get(n), now) }
}

