/**
 * turnBlocks —— 把助手一轮里的**步骤**折成界面上的一行行（纯逻辑，零 Vue）。
 *
 * 用户口径（2026-10-05）：
 * 1. 文字与工具**有先后顺序**：一段文字、三个工具、再一段文字，就按这个顺序排；
 * 2. 中间**没有文字**隔开的多个工具要**合并成一组**（照 codex-base-ui 的 useGroups 逻辑）。
 *
 * 做法与参考项目一致：按到达顺序扫一遍，遇到文字就开新行，连续的同类（思考 / 工具）并到一起。
 * 这里只算「哪些块」，具体长什么样（单个工具画一行、多个工具折叠）由组件决定。
 */
import type { ToolCard, TurnStep } from './sessionModel.js'

/** 一行的三种形态 */
export type TurnBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; tool: ToolCard }

/** 折完的一行（tools / text / thinking），带 Vue :key 用的稳定 key */
export type TurnRow =
  | { type: 'text'; key: string; text: string }
  | { type: 'thinking'; key: string; text: string }
  | { type: 'tools'; key: string; tools: ToolCard[] }

/**
 * 把「按顺序的步骤」折成行。
 *
 * 规则：
 * - 文字**是分界线** —— 它自占一行，且把它前后的工具分成两组；
 * - **思考不是分界线**（用户报 2026-10-06）：UI 把整轮思考并进顶部「思考过程」折叠块统一
 *   展示，中间不渲染 —— 若思考拆组，用户看到的就是「三个连续的工具」却没合并。
 *   所以思考夹在工具中间**不拆组**，内容只累计进 thinking 块；
 * - 连续的工具并成一组（哪怕只有一个也成一组，数量交给调用方）。
 */
export function groupTurnBlocks(steps: TurnStep[], tools: ToolCard[]): TurnRow[] {
  const byId = new Map(tools.map((t) => [t.id, t]))
  const rows: TurnRow[] = []
  /** 各行里累计的思考文本（key → 文本），最后统一把 thinking 行归位到最前 */
  const thinkText: string[] = []
  let thinkKey: string | null = null
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    // key 用**该行第一块的下标**：同一个数组里唯一，且随内容稳定（重渲染不跳）。
    const key = 'b' + i
    if (step.type === 'tool') {
      const tool = byId.get(step.id)
      // 找不到对应工具（正在落盘 / 数据不一致）就跳过，不画半截行
      if (!tool) continue
      const last = rows[rows.length - 1]
      if (last && last.type === 'tools') last.tools.push(tool)
      else rows.push({ type: 'tools', key, tools: [tool] })
      continue
    }
    if (step.type === 'thinking') {
      // 思考不占一行：文本累计起来，最后统一作为**最前面**的一块（UI 顶部折叠展示）
      if (thinkKey === null) thinkKey = key
      thinkText.push(step.text)
      continue
    }
    rows.push({ type: 'text', key, text: step.text })
  }
  // 思考行**始终排最前**（UI 的「思考过程」折叠块在顶部）；有思考才插
  if (thinkKey !== null) rows.unshift({ type: 'thinking', key: thinkKey, text: thinkText.join('') })
  return rows
}
