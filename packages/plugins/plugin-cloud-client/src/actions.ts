/**
 * 清单 → 底栏动作的注册（**这就是"注册 UI"的全部**：注册的是数据，画的是底栏）。
 *
 * 三个关键点：
 * 1. **字段名要换算**：后端用 nodeTypes，底栏用 types。漏了这一步，
 *    底栏会认为"所有节点类型都适用" —— 图片模型会出现在文本节点上。
 * 2. **刷新用全量重建**：重拉清单后先按上次的 id 集合把**已消失**的动作摘掉，再注册新的。
 * 3. 不做第 2 步的话，后台删掉的模型会永远留在下拉里、点下去必然失败。
 *
 * 零 Vue：底栏的皮（NodeBottomBar）本来就订阅了 node/bar 场，一广播它自己就重画。
 */
import type { ServerAction } from './apiTypes.js'

/** 底栏动作的形状（只用得到的那几个字段） */
export interface BarActionLike {
  id: string
  /** 底栏字段名（后端叫 nodeTypes） */
  types?: string[]
  title: string
  description?: string
  group?: string
  order?: number
  needsPrompt?: boolean
  promptBinding?: 'none' | 'text'
  fields?: unknown[]
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /** 状态由外部管（后台会写节点进度）—— 底栏据此不写本地 runState */
  externalRunState?: boolean
  run?: (...args: never[]) => unknown
  resume?: (...args: never[]) => unknown
  onCancel?: (...args: never[]) => unknown
}

/**
 * 换算一条动作。
 *
 * run / resume / onCancel 由调用方注入（它们要发 HTTP，是插件的事；
 * 这里只管把"声明"翻译成底栏认识的形状）。
 */
export function toBarAction(
  def: ServerAction,
  handlers: Pick<BarActionLike, 'run' | 'resume' | 'onCancel'>,
): BarActionLike {
  const out: BarActionLike = {
    id: def.id,
    title: def.title,
    ...(def.description !== undefined ? { description: def.description } : {}),
    ...(def.group !== undefined ? { group: def.group } : {}),
    ...(def.order !== undefined ? { order: def.order } : {}),
    ...(def.needsPrompt !== undefined ? { needsPrompt: def.needsPrompt } : {}),
    ...(def.promptBinding !== undefined ? { promptBinding: def.promptBinding } : {}),
    ...(Array.isArray(def.fields) ? { fields: def.fields } : {}),
  }
  // 字段名换算：nodeTypes → types
  if (Array.isArray(def.nodeTypes) && def.nodeTypes.length > 0) out.types = [...def.nodeTypes]
  // 后端动作自己声明的轮询节奏（长视频不能被共享的短超时误杀）
  if (typeof def.pollIntervalMs === 'number') out.pollIntervalMs = def.pollIntervalMs
  if (typeof def.pollTimeoutMs === 'number') out.pollTimeoutMs = def.pollTimeoutMs
  if (def.externalRunState === true) out.externalRunState = true
  return { ...out, ...handlers }
}

/**
 * 算"这次要摘掉哪些、要注册哪些"。
 *
 * toRemove 是**上次有、这次没有**的 id（必须摘掉，否则是幽灵菜单项）；
 * toRegister 是这次全部的动作（同 id 注册 = 替换，所以不必区分"新增"与"改了"）。
 */
export function diffActions(
  previousIds: readonly string[],
  next: readonly ServerAction[],
): { toRemove: string[]; toRegister: ServerAction[] } {
  const nextIds = new Set(next.map((a) => a.id))
  const toRemove = previousIds.filter((id) => !nextIds.has(id))
  return { toRemove, toRegister: [...next] }
}

/** 把动作按节点类型分组（诊断 / 测试用）；没声明 types 的归到 *（全类型） */
export function groupByNodeType(actions: readonly ServerAction[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const a of actions) {
    const types = a.nodeTypes && a.nodeTypes.length > 0 ? a.nodeTypes : ['*']
    for (const t of types) {
      if (!out[t]) out[t] = []
      out[t].push(a.id)
    }
  }
  return out
}

/**
 * 算出"要清掉的同名族动作"。
 *
 * 为什么需要它：本地插件（plugin-web2api-tools）注册的动作 id 与后台来的**同名**
 * （这正是让"同一道菜只出现一次"的约定）。同 id 注册 = 替换，所以正常顺序下云插件
 * 后注册就把本地的顶掉了。但本地插件有个"等底栏装好再试一次"的重试路径 ——
 * 万一它在云插件之后又注册了一遍，后台的就被顶回去了。
 *
 * 所以云插件每次核对清单时顺手把**该家族里不在清单中的**摘掉：
 * 既清掉"重试路径留下的"，也清掉"后台已经删掉、但本地插件还在"的。
 */
export function staleActionIds(
  existingIds: readonly string[],
  serverIds: readonly string[],
  families: readonly string[] = ['web2api:'],
): string[] {
  const keep = new Set(serverIds)
  return existingIds.filter((id) => !keep.has(id) && families.some((f) => id.startsWith(f)))
}
