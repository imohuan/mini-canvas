/**
 * authorize —— 「这次调用有没有被这个节点授权」的判定（纯逻辑，可单测）。
 *
 * ## 为什么要有它（用户 2026-10-13 的强制约束）
 *
 * 界面里写一段 `fetch("/api/task/call", { name: "scale" })` 谁都会写，但"这个节点
 * 到底该不该能调 scale"只有**节点自己的声明**说了算。没有这一关：
 *   · AI 忘了声明，界面照样能调 —— 声明就成了一张没人看的纸；
 *   · 谁往界面里塞一段脚本，就能顺手套用机器上任何脚本。
 *
 * 判定两步（就是用户描述的那两步）：
 *   ① 按 canvasId + nodeId 把节点读出来（拿声明）；
 *   ② 看声明里有没有这次要跑的脚本名。
 *
 * ## 为什么"节点不存在"也要拦
 *
 * nodeId 是调用方**自己填的**。允许空 nodeId 等于开一个后门：不填就能绕过所有校验。
 * 所以缺 nodeId / 节点查不到，一律拒。
 */

/** 把节点 data 里的声明读成"有哪些脚本名"（形状不对就当空） */
export function declaredNames(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const raw = (data as Record<string, unknown>).uiScripts
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  return Object.keys(raw as Record<string, unknown>)
}

export interface AuthorizeInput {
  /** 这次要跑的脚本名 */
  scriptName: string
  /** 节点 data（读声明用） */
  nodeData: unknown
  /** 节点是否存在（不存在 = 拒绝） */
  nodeExists: boolean
  /** 画布 id（报错文案里要说出"哪张画布的哪个节点"，便于排查） */
  canvasId: string
  nodeId: string
}

export type AuthorizeResult = { ok: true } | { ok: false; error: string }

/**
 * 判定这次调用是否被授权。
 *
 * 报错文案刻意带上**怎么改**：AI 看到 403 之后不该去猜，而该照着那句话去补声明 ——
 * 这是"能自愈"与"卡死"的分界。
 */
export function authorizeScriptCall(input: AuthorizeInput): AuthorizeResult {
  const { scriptName, nodeData, nodeExists, canvasId, nodeId } = input
  if (!nodeId) {
    return {
      ok: false,
      error:
        '缺少 nodeId：任务脚本是"某个节点要干的活"，必须带上调用它的节点。' +
        '界面里从 __CANVAS_UI__.nodeId 取（不要写死）。',
    }
  }
  if (!nodeExists) {
    return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId + '，拒绝执行。' }
  }
  const names = declaredNames(nodeData)
  if (!names.includes(scriptName)) {
    return {
      ok: false,
      error:
        '节点 ' + nodeId + ' 没有声明脚本 "' + scriptName + '"（已声明：' +
        (names.length ? names.join('、') : '无') +
        '）。任务脚本要先在节点上声明才能调用：用 canvas_ui_write 时把它写进节点的' +
        ' data.uiScripts（形如 { "' + scriptName + '": {} }，后台也会在写界面时自动补）。',
    }
  }
  return { ok: true }
}

