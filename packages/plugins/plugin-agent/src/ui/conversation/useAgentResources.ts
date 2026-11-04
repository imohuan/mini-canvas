/**
 * 画布节点引用、@ 资源清单，以及用户消息片段与点击派发。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Box, Sparkles, WandSparkles } from 'lucide-vue-next'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import {
  skillResources,
  mcpResources,
  nodeResources,
  assetResource,
  assetResources,
  type AssetRefOpen,
  type CanvasNodeRow,
} from '../../ui/shared/agentResources.js'
import { parseUserSegments, assetRefInputOf, type UserSegment } from '../../model/userSegments.js'
import { stripUserSteering } from '../../model/userSteering.js'
import { REF_CLICK_EVENT, refClickPayloadOf } from '../../plugin/refClickEvents.js'
import type { AgentService } from '../../service/types.js'
import type { AgentServiceState } from '../../service/types.js'
import type { ProseMirrorEditorExposed } from './editorTypes.js'

export function useAgentResources(
  agent: AgentService,
  s: AgentServiceState,
  deps: {
    ctx: CanvasRenderContext['ctx']
    editorRef: { value: ProseMirrorEditorExposed | null }
    prompt: { value: string }
    ICON_COMPACT: string
  },
) {
const { prompt } = deps
const editorRef = deps.editorRef
const { ctx } = deps
const { ICON_COMPACT } = deps

/**
 * 画布节点 → @ 候选（节点标记 + 点击聚焦）。
 *
 * 节点从 doc 现取、并**订阅 doc 变化**：用户加/删/改节点后，@ 菜单要跟着变，
 * 不能只在挂载时取一次快照（否则新节点 @ 不出来）。
 */
const nodeList = ref<CanvasNodeRow[]>([])
let nodeSub: { dispose?: () => void } | null = null
/**
 * 节点显示名：**只认节点自己的名字 data.label**（建节点时由数据层按类型模板生成，如「图片 1」）。
 *
 * 为什么不再按 imageName / text 首行之类去猜：那是以前没有统一命名时的权宜，
 * 结果同一节点在标题条 / @ 菜单 / 左侧树三处显示三个名字。名字只有一个来源 —— data.label。
 */
function nodeNameOf(
  n: { id: string; type: string; data?: Record<string, unknown> },
  typeLabelOf: (t: string) => string | undefined,
): string {
  const label = n.data?.label
  if (typeof label === 'string' && label.trim()) return label.trim().split('\n')[0].slice(0, 40)
  // 没有 label（改动前建的旧节点）：回落类型中文名（与标题条 / 左侧树同一套兜底），最后才用 id。
  const d = n.data ?? {}
  const t = (typeof d.nodeType === 'string' && d.nodeType) || n.type
  return typeLabelOf(t) || n.id
}
function syncNodes(): void {
  const doc = ctx.tryGet<{
    getNodes(): Array<{ id: string; type: string; data?: Record<string, unknown>; parentId?: string | null }>
    types?: Map<string, { label?: string }>
  }>('doc')
  if (!doc) return
  const typeLabelOf = (t: string): string | undefined => doc.types?.get(t)?.label
  nodeList.value = doc
    .getNodes()
    .filter((n) => n.type !== 'group') // 分组只当容器，不作为内容引用
    .map((n) => ({ id: n.id, name: nodeNameOf(n, typeLabelOf), type: n.type }))
}
syncNodes()
onMounted(() => {
  // 告诉服务当前画布 id（节点标记要写 `画布id#节点id`）。
  // 认法跟 cloud-client 的 canvasId() 一致：URL `?canvas=` 优先，其次 hash 路由 `#/canvas/<id>`。
  try {
    const q = new URLSearchParams(window.location.search).get('canvas')
    const h = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)?.[1]
    const id = q || h
    if (id) agent.setCanvasId(id)
  } catch {
    /* 取不到 URL → 用默认画布 id */
  }
  const doc = ctx.tryGet<{ subscribe(cb: () => void): unknown }>('doc')
  // subscribe 返回取消句柄（与本仓其它插件同款）；形状不确定时按 off/dispose 兜底
  const off = doc?.subscribe(() => syncNodes()) as { dispose?: () => void } | (() => void) | undefined
  if (typeof off === 'function') nodeSub = { dispose: off }
  else if (off) nodeSub = off
})
onBeforeUnmount(() => nodeSub?.dispose?.())

/** 点节点标签 = 让画布聚焦到该节点（用户要的「点标签跳到节点」） */
function focusNode(nodeId: string): void {
  // 保留当前缩放、只平移；节点不存在时 fitTo 返回 false，不抛。
  ctx.tryGet<{ fitTo(target: string[], opts?: { keepZoom?: boolean }): boolean }>('view')
    ?.fitTo([nodeId], { keepZoom: true })
}

/**
 * @ 下拉候选 + **回填复用清单**：画布节点 + 已装技能 + 已配 MCP + 资产。
 *
 * 为什么要含资产：编辑回填时按名字从这份清单里复用现成 item —— 只有清单里的 item
 * 带 renderEditor（图标 + 标签外观），回填出来的标签才和右键插入的长得一样。
 * 资产清单用于「回填复用」；@ 下拉里按名字过滤也能顺带搜到资产，是加分项。
 */
const editorResources = computed<ResourceItem[]>(() => [
  // **命令组排最前**（用户口径 2026-10-11 的截图反馈）：@ 菜单打开时"能做什么"先于
  // "引用谁" —— 不用滚到列表最底下才能按到「压缩」。
  ...compactActionItems(),
  ...nodeResources(nodeList.value, s.canvasId, focusNode),
  ...skillResources(s.skills),
  ...mcpResources(s.mcpServers),
])

/**
 * @ 菜单里的「压缩」动作项。
 *
 * 为什么用 category「命令」单独一组：它和节点 / 技能 / MCP 不是一类东西
 * （那些是"引用谁"，这个是"现在做什么"），混在一组里读起来会错。
 */
function compactActionItems(): ResourceItem[] {
  return [
    {
      id: 'command:compact',
      name: '压缩上下文',
      category: '命令',
      value: '把历史总结成摘要，腾出上下文空间',
      renderItem: () =>
        h('span', { class: 'ac-mrow' }, [
          h('span', { class: 'ac-mrow-icon', innerHTML: ICON_COMPACT }),
          h('span', { class: 'ac-mrow-text' }, [
            h('span', { class: 'ac-mrow-name' }, '压缩上下文'),
            h('span', { class: 'ac-mrow-hint' }, '把历史总结成摘要，腾出上下文空间'),
          ]),
        ]),
      // 动作项：onPick 一给，编辑器就**不往正文插任何东西**（见 useEditor 的说明）
      onPick: () => void agent.compact(),
    },
  ]
}

/**
 * 「引用到 Agent」→ 把那些节点插成标签（两个入口共用：右键菜单给一个、多选上控制栏给一批）。
 *
 * 命令在插件上下文里执行、输入框在这里，服务是唯一共享通道：命令只往 state.pendingNodeRefs
 * 写一句「引用这些 id」，组件看见就插标签并清掉（见 agentPlugin 的 agent:reference-node）。
 */
function insertPendingNodeRefs(): void {
  const nodeIds = s.pendingNodeRefs
  if (!nodeIds || !nodeIds.length) return
  syncNodes()
  // 节点可能刚被删：拿不到的跳过，不插半截东西
  const all = nodeResources(nodeList.value, s.canvasId, focusNode)
  const items = nodeIds.map((id) => all.find((x) => x.id === 'node:' + id)).filter((x) => Boolean(x))
  if (items.length) void nextTick(() => { for (const item of items) editorRef.value?.insertResource(item!) })
  agent.clearNodeRefs()
}
// 两条路都要覆盖：
//   · 面板已开着 → 命令只改 state，watch 触发；
//   · 面板本来关着 → 命令会 show()，组件此刻才挂载，onMounted 补上这一次（watch 非 immediate，
//     挂载前设的值它收不到）。onMounted 跑在子组件挂载之后，editorRef 已就绪。
watch(() => s.pendingNodeRefs, () => insertPendingNodeRefs())
onMounted(() => insertPendingNodeRefs())

/**
 * 资产「添加到 Agent」：服务只记**资产数据**（state.pendingAsset），这里用 assetResource
 * 现造成完整标签再插 —— 与「引用到 Agent」完全同一条路（那边也是只传 id、组件现造标签）。
 * 面板关着时先记下，组件挂载/打开后补插。
 */
function insertPendingResource(): void {
  const asset = s.pendingAsset
  if (!asset) return
  // 带上 onClick：插进输入框的 chip 点一下也发同一条事件（与气泡里的标签同一件事）
  const item = assetResource(asset, emitRefClick)
  void nextTick(() => editorRef.value?.insertResource(item))
  agent.clearPendingResource()
}
watch(() => s.pendingAsset, () => insertPendingResource())
onMounted(() => insertPendingResource())

/**
 * 批量插资产标签（多选工具栏「加入资产库」→ referenceAssets）。
 * 每张与单张同形；插完一次清空（clearPendingResources）。
 */
function insertPendingResources(): void {
  const assets = s.pendingAssets
  if (!assets || !assets.length) return
  const items = assetResources(assets, emitRefClick)
  void nextTick(() => { for (const item of items) editorRef.value?.insertResource(item) })
  agent.clearPendingResources()
}
watch(() => s.pendingAssets, () => insertPendingResources())
onMounted(() => insertPendingResources())

/** 往输入框插一个标签（点下拉里的一项 = 插 chip，不切开关），插完就收起下拉 */
function insertRef(item: ResourceItem, close: () => void): void {
  editorRef.value?.insertResource(item)
  close()
}

/**
 * 「压缩」的两个入口（+ 菜单 / @ 菜单）共用这一个动作。
 *
 * 为什么收成一处：压缩是有前置条件的长动作（没有会话 / 正在跑 / 正在压都要有交代），
 * 两个入口各写一遍必然漂移 —— 用户会看到一个入口能点、另一个点了没反应。
 */
function compactNow(): void {
  void agent.compact()
}

/** 空态下的三行建议（照参考图；点了就填进输入框） */
const SUGGESTIONS = [
  { icon: Box, text: '感知画布开始创作' },
  { icon: Sparkles, text: '从爆款预设开始剧本原创' },
  { icon: WandSparkles, text: '上传故事来改编' },
]
function useSuggestion(text: string): void {
  // 走编辑器的 setText（整体覆盖）而不是 `prompt.value = text`：
  // 后者会被编辑器当成「外部变更」走 watch 的纯文本恢复分支，实测那条分支会在前面
  // 多留一个空段落 —— 表现就是「点预设提示词，文本前面多一个换行」（用户报的 bug）。
  editorRef.value?.setText(text)
  // setText 会回吐 update:modelValue，正常情况下这里已经同步过了；
  // 编辑器还没挂好（ref 为空）时才退回直接写，至少按钮不是死的。
  if (!editorRef.value) prompt.value = text
}

/**
 * 把用户消息的纯文本切成「文字 / 标签」两种片段。
 *
 * 解析本身住在 ../userSegments.ts（纯函数，有单测）—— 这里只做「按段渲染 + 点击派发」。
 * 转录里存的是 `<ref … />` XML 原文（后端不翻译），字段自带完整信息，不再靠名字回推。
 */
const userSegments = parseUserSegments

/**
 * 用户气泡的显示文本：剥掉 [user_steering] 块的标记只留内文（用户口径 2026-10-15）。
 * 为什么不动 t.text 本身：编辑回填、复制消息要走原文（复制带标记无意义时再看，
 * 先保证显示干净 —— 复制也走这里更符合直觉，一并处理）。
 */
function displayUserText(text: string): string {
  return stripUserSteering(text)
}

/**
 * 点对话里的标签：
 *   · 节点 → 让画布聚焦到它（读起来最自然，也是老行为）；
 *   · 资产（文件或文件夹）→ 发一条 `agent:ref-click` 系统事件，由应用层决定怎么响应。
 *
 * 为什么用事件而不是服务（用户口径 2026-10-08）：预览与资产管理弹窗属于成品应用，
 * 本插件按依赖方向 import 不到它。走服务时两边被一个**服务名**绑住（还要满足注入先后）；
 * 走事件则三方互不认识 —— 本插件只负责「有人点了这个引用」，谁想响应谁 ctx.on 监听。
 */
function onSegClick(seg: UserSegment): void {
  if (seg.nodeId) { focusNode(seg.nodeId); return }
  emitRefClick(assetRefInputOf(seg))
}

/**
 * 把「某条引用被点了」广播出去（`agent:ref-click`）。
 *
 * 只发**引用自带的字段**，不做翻译：怎么响应（预览 / 打开资产管理 / 别的）是监听方的事。
 * 没人监听也不报错（事件是广播，不是调用）。
 */
function emitRefClick(ref: AssetRefOpen): void {
  const payload = refClickPayloadOf({ ...ref, refType: 'asset' })
  if (payload) ctx.emit(REF_CLICK_EVENT, payload)
}

return {
  ctx,
  nodeList,
  nodeSub,
  nodeNameOf,
  syncNodes,
  focusNode,
  editorResources,
  compactActionItems,
  insertPendingNodeRefs,
  insertPendingResource,
  insertPendingResources,
  insertRef,
  compactNow,
  SUGGESTIONS,
  useSuggestion,
  userSegments,
  displayUserText,
  onSegClick,
  emitRefClick,
}
}

