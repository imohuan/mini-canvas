/**
 * MCP 下拉：检测状态、工具清单、多选引用与展开态。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, ref } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { AgentService } from '../../agent-service/types.js'
import type { AgentServiceState } from '../../agent-service/types.js'
import { mcpResources, mcpToolResource } from '../../agentResources.js'

type McpToolRow = { name: string; description: string; fullName: string }

export function useAgentMcpPanel(
  agent: AgentService,
  s: AgentServiceState,
  editorRef: { value: { insertResource(item: ResourceItem): void } | null },
) {
/**
 * MCP 实时检测（下拉里那个「检测」按钮）。
 *
 * 为什么要它：SDK 的 MCP 是**懒连接**的 —— 每开一条会话，第一次 run 时才去连，
 * 连完只在那条会话里出声（原来就是消息流里那句「已连接 MCP：…」，现在隐藏了）。
 * 于是「现在到底连没连上、有哪些工具」没有一个常驻的地方能看。这里补上：
 * 点一下主动探一次（服务端走独立连接，探完就关），结果直接标在下拉每一行上。
 */
const mcpProbing = ref(false)
const mcpProbeHint = ref('')
/** 服务名 → 检测结果（好没好 / 一句说明 / 工具数） */
const mcpStatus = ref<Record<string, { ok: boolean; text: string; tools: number }>>({})
/** 服务名 → 探测到的工具清单（点「重新检测」后填；面板据此展开工具行） */
const mcpTools = ref<Record<string, Array<{ name: string; description: string; fullName: string }>>>({})

function mcpStatusOf(name: string): { ok: boolean; text: string; tools: number } | null {
  return mcpStatus.value[name] ?? null
}

/** MCP 卡片副行：优先显示地址 / 命令（区分同名服务），没有就显示传输方式 */
function mcpServerDesc(item: { id: string; value?: string }): string {
  if (item.value) return item.value
  const row = s.mcpServers.find((m) => 'mcp:' + m.name === item.id)
  const cfg = row?.config ?? {}
  return String(cfg.type ?? (cfg.command ? 'stdio' : '内置'))
}

/** MCP 卡片右侧的传输方式（还没检测过时显示，代替工具数） */
function mcpTransport(item: { id: string }): string {
  const row = s.mcpServers.find((m) => 'mcp:' + m.name === item.id)
  if (!row) return '服务'
  if (row.builtin) return '内置'
  const cfg = row.config ?? {}
  return String(cfg.type ?? (cfg.command ? 'stdio' : '服务'))
}

/** 某个服务探测到的工具数（「重新检测」后才有；没有就给 0） */
function mcpToolCount(name: string): number {
  return mcpStatusOf(name)?.tools ?? 0
}

/** 某服务展开的工具行（没探测过 / 探测失败时是空数组，卡片就不画展开区） */
function mcpToolsOf(name: string): Array<{ name: string; description: string; fullName: string }> {
  return mcpTools.value[name] ?? []
}

/** 展开的 MCP 卡片（存服务名；DEMO 的 expandedMcp） */
const mcpExpanded = ref<Set<string>>(new Set())
function toggleMcpExpand(name: string): void {
  const next = new Set(mcpExpanded.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  mcpExpanded.value = next
}

/**
 * MCP 的**待确认选择**（用户口径 2026-10-30：跟参考 HTML 一样支持多选，选完点确认才插入）。
 *
 * 为什么不在点击时直接插：服务和工具是两级、都能多选，点一下就插等于逼着用户
 * 「开面板 → 点一个 → 再开 → 再点」，中间的勾选态也没地方显示。
 * 所以这里只记「选了什么」，真正落标签在底栏那个「确认引用」上。
 */
const mcpPickedServers = ref<Set<string>>(new Set())
const mcpPickedTools = ref<Set<string>>(new Set())

function mcpToolKey(server: string, toolName: string): string {
  return server + '/' + toolName
}

function toggleMcpServer(name: string): void {
  const next = new Set(mcpPickedServers.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  mcpPickedServers.value = next
}

function toggleMcpTool(server: string, toolName: string): void {
  const key = mcpToolKey(server, toolName)
  const next = new Set(mcpPickedTools.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  mcpPickedTools.value = next
}

/** 某个服务选了几个工具（卡片上显示「已选 N 个工具」） */
function pickedToolCountOf(server: string): number {
  let n = 0
  for (const key of mcpPickedTools.value) if (key.startsWith(server + '/')) n++
  return n
}

const mcpPickTotal = computed(() => mcpPickedServers.value.size + mcpPickedTools.value.size)

/** 把勾选的服务 + 工具一次性插成标签（插之前不清勾选，插完清） */
function confirmMcpPicks(close: () => void): void {
  const items: ResourceItem[] = []
  const allServers = mcpResources(s.mcpServers)
  for (const name of mcpPickedServers.value) {
    const item = allServers.find((x) => x.name === name)
    if (item) items.push(item)
  }
  for (const key of mcpPickedTools.value) {
    const cut = key.indexOf('/')
    if (cut < 0) continue
    const server = key.slice(0, cut)
    const toolName = key.slice(cut + 1)
    const tool = mcpToolsOf(server).find((t) => t.name === toolName)
    items.push(mcpToolResource(server, toolName, tool?.description ?? ''))
  }
  if (!items.length) return
  for (const item of items) editorRef.value?.insertResource(item)
  mcpPickedServers.value = new Set()
  mcpPickedTools.value = new Set()
  close()
}

/**
 * 探测 MCP（全部一次探完）。
 *
 * reconnect=true 时先把**当前会话**的旧连接丢掉（修「外部关了再开、连接已废」的那种），
 * 面板打开时的自动检测用 false —— 用户只是看一眼工具列表，不该顺手重建会话连接。
 */
async function probeMcpServers(reconnect: boolean): Promise<void> {
  if (mcpProbing.value) return
  mcpProbing.value = true
  mcpProbeHint.value = '正在连接…'
  try {
    // 先让当前会话丢掉旧的 MCP 连接，再探测。
    //
    // 顺序很重要，两步解决的是不同问题：
    //   · reconnect：修**正在用的那条会话** —— SDK 的连接建在会话上、且不会自己重连，
    //     外部把 MCP 关了再开，那条旧连接就废了；丢掉它，下一句 resume 时会重新连。
    //   · probe：给**用户看**当前到底连得上什么（独立连接，不碰会话）。
    // 先 reconnect 再 probe，用户看到的结果就是"修好之后"的状态。
    if (reconnect) await agent.reconnectMcp()
    const r = await agent.probeMcp()
    const next: Record<string, { ok: boolean; text: string; tools: number }> = {}
    const tools: Record<string, Array<{ name: string; description: string; fullName: string }>> = {}
    for (const sv of r.servers) {
      const ok = sv.status === 'completed'
      next[sv.name] = { ok, text: ok ? sv.tools + ' 个工具' : (sv.error || sv.status || '连接失败'), tools: sv.tools }
      if (ok) tools[sv.name] = r.tools.filter((t) => t.server === sv.name).map((t) => ({ name: t.name, description: t.description, fullName: t.fullName }))
    }
    mcpStatus.value = next
    mcpTools.value = tools
    if (r.error) mcpProbeHint.value = r.error
    else if (!r.servers.length) mcpProbeHint.value = '没有任何 MCP 返回结果'
    else {
      const bad = r.servers.filter((x) => x.status !== 'completed').length
      mcpProbeHint.value = bad ? bad + ' 个连不上（旁边标了原因）' : '全部正常'
    }
  } catch (err) {
    mcpProbeHint.value = err instanceof Error ? err.message : String(err)
  } finally {
    mcpProbing.value = false
  }
}

function runMcpProbe(): void {
  void probeMcpServers(true)
}

/** 首开自动检测：没有工具数据时才探一次（探过就记住，别每次开面板都连一遍） */
const mcpProbedOnce = ref(false)
function ensureMcpProbed(): void {
  if (mcpProbedOnce.value) return
  mcpProbedOnce.value = true
  void probeMcpServers(false)
}

return {
  mcpProbing,
  mcpProbeHint,
  mcpStatus,
  mcpTools,
  mcpStatusOf,
  mcpServerDesc,
  mcpTransport,
  mcpToolCount,
  mcpToolsOf,
  mcpExpanded,
  toggleMcpExpand,
  mcpPickedServers,
  mcpPickedTools,
  mcpToolKey,
  toggleMcpServer,
  toggleMcpTool,
  pickedToolCountOf,
  mcpPickTotal,
  confirmMcpPicks,
  probeMcpServers,
  runMcpProbe,
  mcpProbedOnce,
  ensureMcpProbed,
}
}
