/**
 * Agent 配置面共用的纯工具：密钥掩码、URL 校验、目录遍历、
 * system_config.yaml 读写、错误描述、排队锁与模板体检。
 *
 * 从 config.ts 原样搬出，供 config.ts 与 configShared.ts 共用。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadAgentState, systemConfigPath } from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID } from './agentPaths.js'

/** base_url 必须是完整 http(s) 地址 */
/**
 * 密钥的**掩码预览**：保留前缀与末 4 位，中间一律打点。
 *
 * 目的只有一个：让界面能显示「这里已经有密钥了」。不追求任何可逆性 ——
 * 明文永不出服务端（见类头「密钥只写不回读」），这里给的也只是一块"有值"的证据。
 * 太短的密钥（< 9）整串打点，避免把短密钥本身漏出去。
 */
export function maskSecret(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (s.length < 9) return '••••••'
  return s.slice(0, 3) + '…' + s.slice(-4)
}

/**
 * 判断一个串是不是 maskSecret 产出的**掩码**（而不是用户真输的密钥）。
 *
 * 为什么需要它：界面会把已存密钥的掩码显示在输入框里，保存/拉取时又会把它原样回传。
 * 若不拦住，掩码会被当成新密钥写进配置 —— 该渠道立刻变成「用错误密钥认证」→ 上游 401；
 * 或者被拿去请求上游，同样 401。两种表现用户都只会看到「编辑一次就坏了」。
 */
export function isSecretMask(value: string): boolean {
  const v = (value ?? '').trim()
  if (!v) return false
  // maskSecret 只有两种形态：短密钥的整串圆点、长密钥的 `xxx…yyyy`
  return v === '••••••' || /^.{3}….{4}$/.test(v)
}

/** base_url 必须是完整 http(s) 地址 */
export function assertHttpUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('地址必须是完整地址（例如 http://127.0.0.1:3000/v1），当前填的是「' + raw + '」')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('地址只支持 http/https，当前是「' + parsed.protocol + '」')
  }
  return raw
}

/** 递归列目录（相对路径 + 绝对路径） */
export async function walk(dir: string, prefix = ''): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = prefix ? prefix + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...(await walk(abs, rel)))
    else if (e.isFile()) out.push({ abs, rel })
  }
  return out
}

export interface SystemConfigLike {
  tools?: { mcpServers?: Array<{ name: string; config: Record<string, unknown> }> }
  [k: string]: unknown
}

/** 读 Agent 的 system_config.yaml（未初始化时带 init 建一份，避免首次进设置页就报错） */
export async function loadSystemConfig(root: string): Promise<SystemConfigLike> {
  // 不带 init：初始化由 AgentConfigService.ensureInit 串行负责（并发初始化会撞车）
  const state = await loadAgentState({ agentId: AGENT_ID, projectId: AGENT_PROJECT_ID, root })
  return state.systemConfig as unknown as SystemConfigLike
}

/** 写回 system_config.yaml（SDK 无公开写入口，直接写 YAML；形状永远是 SDK 自己加载出来的那份） */
export async function writeSystemConfig(root: string, cfg: unknown): Promise<void> {
  const yaml = await import('yaml')
  const target = systemConfigPath(root, AGENT_PROJECT_ID, AGENT_ID)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, yaml.stringify(cfg, { lineWidth: 0 }), 'utf8')
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 模型检测里的英文报错翻成人话。
 *
 * 只翻**能确定含义**的几种（缺密钥、认证失败、连不上、404）；其余原样保留 ——
 * 乱翻译会把真正的上游原因改掉，反而更难查。
 */
export function friendlyProbeError(message: string): string {
  const m = (message ?? '').trim()
  if (!m) return '请求失败（没有返回原因）'
  if (/Missing credentials|apiKey.*required|No API key/i.test(m)) {
    return '没有可用密钥：先填这个渠道的密钥，或确认它已经保存过'
  }
  if (/401|Unauthorized|invalid.*api.*key|authentication/i.test(m)) {
    return '认证失败（401）：密钥不正确或没有这个模型的权限'
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|socket hang up/i.test(m)) {
    return '连不上接口地址：检查地址、端口和网络'
  }
  if (/\b404\b/.test(m)) {
    return '接口不存在（404）：多半是地址少了 /v1 或协议选错了'
  }
  return m
}

/**
 * 通用「排队取锁」：拿当前队列尾，把自己的放行信号接在后面，等前一个放行。
 * 返回的 release 只应调用一次（调用方都在 finally 里调）。
 */
export async function acquireQueue(
  read: () => Promise<void>,
  write: (next: Promise<void>) => void,
): Promise<() => void> {
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const prior = read()
  write(prior.then(() => mine))
  await prior
  return release
}

/**
 * 模板缺了哪些「把内容送进模型」的关键记号。
 *
 * 判据只有一个：**模板里有没有 {{AGENTS_MD}}**。
 *
 * 为什么只认这一条：它是整条链路的咽喉。AGENTS.md（用户写的提示词 + 模式提示词 +
 * 引用标记说明）全靠它注入；而技能 / 记忆 / 密钥那几节的记号哪怕缺了，模型照样干活，
 * 只是少了几段背景 —— 那种缺失不该弹「恢复出厂模板」这么大的动作（恢复模板会连
 * 角色设定一起换掉）。{{AGENTS_MD}} 缺了则等于「设置里写的提示词一个字都进不去」，
 * 用户怎么改都没反应，这才是必须报警的那一种。
 *
 * 同时把 shell / 环境那几行的缺失也报出来（同样是静默失效，且恢复模板就能一起修）。
 */
export function templateMissing(template: string): string[] {
  const missing: string[] = []
  if (!template.includes('{{AGENTS_MD}}')) missing.push('{{AGENTS_MD}}')
  if (!template.includes('{{CWD}}')) missing.push('{{CWD}}')
  if (!template.includes('{{SESSION_ID}}')) missing.push('{{SESSION_ID}}')
  return missing
}

