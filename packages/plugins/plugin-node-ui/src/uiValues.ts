/**
 * uiValues —— 把「声明的输入参数」变成 AI 真能读到的值（纯函数，Node 可单测）。
 *
 * ## 取值的三条来源（按优先级，先命中先用）
 *
 *   1. **手工填的值**（节点 data.uiValues[键]）—— 用户自己敲的，最权威；
 *   2. **名字对得上的上游素材**（引用名 === 键），例如声明了 `sales` 而画布上有张表叫 sales；
 *   3. **同类型的第一条上游素材** —— 声明了 image 类型、画布上连了一张图，就用它。
 *
 * ## 为什么要有第 3 条
 *
 * 用户的真实用法是「连一张图过来，让它画出来」。若只认「名字对得上」，
 * 用户还得先把上游节点改名成与键一致 —— 那等于把「连线」这件已经做了的事再要求做一遍。
 * 所以类型相同就直接用：这是**兜底**，不是覆盖（前两条仍然优先）。
 *
 * ## 认不出就如实留空
 *
 * 取不到值的参数**仍然出现在清单里**（键 + 类型），只是值为 null —— AI 看到「这个参数
 * 存在但这次没数据」，就能画一个空态（例如「暂无数据」），比整段界面不出现要好。
 */
import type { UiInputDecl, UpstreamItem } from './uiData'

/** 节点 data.uiValues 的形状：键 → 值（只收能进 JSON 的标量） */
export type UiManualValues = Record<string, string | number | boolean>

/** 把节点 data 里那份手工值归一（非标量一律丢掉，不猜） */
export function normalizeManualValues(raw: unknown): UiManualValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: UiManualValues = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

/** 声明类型 → 能接受的素材 kind（image 也收 3D 预览这类给地址的素材） */
const KINDS_OF_TYPE: Record<string, readonly string[]> = {
  image: ['image'],
  video: ['video'],
  audio: ['audio'],
  text: ['text'],
  number: ['text'],
  boolean: ['text'],
  json: ['text'],
  table: ['text'],
}

function matchesType(decl: UiInputDecl, item: UpstreamItem): boolean {
  const kinds = KINDS_OF_TYPE[decl.type] ?? ['text']
  return kinds.includes(item.kind)
}

/**
 * 按上面三条优先级算出每个参数的实际值。
 *
 * @returns 键 → 值（取不到的键给 null）。这个对象就是要注入进生成页面
 *   的 `window.__CANVAS_INPUTS__`。
 */
export function resolveInputValues(
  inputs: readonly UiInputDecl[],
  upstream: readonly UpstreamItem[],
  manual: UiManualValues = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  /** 已经被用掉的素材（一个素材不该同时喂给多个参数 —— 那会让界面出现重复内容） */
  const used = new Set<string>()

  for (const decl of inputs) {
    // ① 手工填的
    if (decl.key in manual) {
      out[decl.key] = manual[decl.key]
      continue
    }
    // ② 引用名对得上的上游素材
    const byName = upstream.find((u) => u.refName === decl.key)
    if (byName) {
      used.add(byName.refName)
      out[decl.key] = valueOf(byName, decl)
      continue
    }
    // ③ 同类型的第一条（还没被用掉的）
    const byKind = upstream.find((u) => matchesType(decl, u) && !used.has(u.refName))
    if (byKind) {
      used.add(byKind.refName)
      out[decl.key] = valueOf(byKind, decl)
      continue
    }
    // 取不到：如实留空（见文件头说明）
    out[decl.key] = null
  }
  return out
}

/** 一条素材 → 该参数该拿到的值（媒体给地址、文本给内容） */
function valueOf(item: UpstreamItem, decl: UiInputDecl): unknown {
  if (decl.type === 'image' || decl.type === 'video' || decl.type === 'audio') return item.url ?? null
  const text = item.value ?? item.url ?? ''
  if (decl.type === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  if (decl.type === 'boolean') return /^(true|1|yes|是)$/i.test(text.trim())
  if (decl.type === 'json' || decl.type === 'table') {
    // 文本类素材若是合法 JSON 就解析成结构，AI 用起来更顺手；解析不了就给原文本
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

/** 界面上的取值来源提示（给参数编辑器显示「这一条的值从哪来」） */
export function valueSourceOf(
  decl: UiInputDecl,
  upstream: readonly UpstreamItem[],
  manual: UiManualValues,
): { from: 'manual' | 'upstream' | 'none'; label: string } {
  if (decl.key in manual) return { from: 'manual', label: '手工填' }
  const byName = upstream.find((u) => u.refName === decl.key)
  if (byName) return { from: 'upstream', label: byName.refName }
  const byKind = upstream.find((u) => matchesType(decl, u))
  if (byKind) return { from: 'upstream', label: byKind.refName + '（同类型）' }
  return { from: 'none', label: '暂无数据' }
}

