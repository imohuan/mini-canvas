/**
 * approval —— 工具的审批策略（纯函数，可单测）。
 *
 * 用户口径：
 * - **默认全放行**（相当于参考项目的「协作模式」开启）。
 * - 但**部分工具要手动审批** —— 由一份规则列表决定哪些要问（例如某些 MCP 的动作）。
 * - 规则列表要能在界面上看与改（点击开关）。
 *
 * 特意不按「工具名看起来像不像危险」猜：参考项目试过，结果是模型调个只读工具也被拒，
 * 然后它跟用户说自己的工具坏了。所以规则只有一份显式清单，由用户配置。
 */
export interface ApprovalRule {
  /** 规则 id（界面里作稳定身份） */
  id: string
  /** 通配模式：精确名 / mcp__smart__* / *.generate* */
  pattern: string
  /** 命中这条规则时是否要问用户（true=问，false=直接放行） */
  ask: boolean
  /** 给人看的说明（界面列表里显示） */
  label?: string
}

export interface ApprovalPolicy {
  /** 是否启用「按规则询问」（关掉 = 全放行） */
  enabled: boolean
  rules: ApprovalRule[]
}

export type ApprovalDecision = 'allow' | 'ask' | 'deny'

/**
 * 默认策略。
 *
 * 默认只对「本地命令 / 写文件」这类要问：用户说过不会让 Agent 跑命令脚本。
 * 其余（画布工具、MCP 的读取类）直接放行 —— 默认要能顺畅干活。
 */
export const DEFAULT_POLICY: ApprovalPolicy = {
  enabled: true,
  rules: [
    { id: 'exec', pattern: 'exec_command', ask: true, label: '执行命令' },
    { id: 'input', pattern: 'input_command', ask: true, label: '向命令写入' },
    { id: 'write', pattern: 'write_file', ask: true, label: '写文件' },
    { id: 'edit', pattern: 'edit_file', ask: true, label: '改文件' },
  ],
}

/** 通配匹配：只支持 *（匹配任意长度），大小写敏感（工具名本来就大小写敏感） */
export function matchesPattern(pattern: string, toolName: string): boolean {
  if (!pattern.includes('*')) return pattern === toolName
  const parts = pattern.split('*').filter((s) => s.length > 0)
  if (parts.length === 0) return true
  let cursor = 0
  for (let i = 0; i < parts.length; i++) {
    const idx = toolName.indexOf(parts[i], cursor)
    if (idx < 0) return false
    if (i === 0 && !pattern.startsWith('*') && idx !== 0) return false
    cursor = idx + parts[i].length
  }
  if (!pattern.endsWith('*') && cursor !== toolName.length) return false
  return true
}

/**
 * 判定一次工具调用该怎么处理。
 *
 * 第一条命中的规则说了算（顺序即优先级）：命中 ask=true → 问；ask=false → 放行。
 * 一条都没命中 → 放行（默认不打扰）。
 */
export function decideTool(policy: ApprovalPolicy, toolName: string): ApprovalDecision {
  if (!policy.enabled) return 'allow'
  for (const rule of policy.rules) {
    if (matchesPattern(rule.pattern, toolName)) return rule.ask ? 'ask' : 'allow'
  }
  return 'allow'
}

/** 规则列表的健壮性：丢掉空 pattern、去掉重复 pattern（后者保留） */
export function normalizePolicy(raw: unknown): ApprovalPolicy {
  const fallback = DEFAULT_POLICY
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as { enabled?: unknown; rules?: unknown }
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled
  const rules: ApprovalRule[] = []
  const seen = new Set<string>()
  if (Array.isArray(obj.rules)) {
    for (const r of obj.rules) {
      if (!r || typeof r !== 'object') continue
      const rr = r as { pattern?: unknown; ask?: unknown; label?: unknown; id?: unknown }
      const pattern = typeof rr.pattern === 'string' ? rr.pattern.trim() : ''
      if (!pattern || seen.has(pattern)) continue
      seen.add(pattern)
      rules.push({
        id: typeof rr.id === 'string' && rr.id ? rr.id : pattern,
        pattern,
        ask: rr.ask !== false,
        ...(typeof rr.label === 'string' && rr.label ? { label: rr.label } : {}),
      })
    }
  }
  return { enabled, rules }
}
