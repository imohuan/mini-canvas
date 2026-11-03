/**
 * 输入区的模型 / 技能 / MCP 菜单状态：搜索、分栏、平台过滤与选中项滚动定位。
 *
 * 纯拆分：从 useAgentConversation 原样搬出，语句与顺序不变。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { brandName, brandSvg, detectPlatform } from '../../modelBrandIcons.js'
import { scrollTopForVisibleItem } from '../../selectionScroll.js'
import { mcpResources, skillResources } from '../../agentResources.js'
import type { AgentService } from '../../agent-service/types.js'
import type { AgentServiceState } from '../../agent-service/types.js'

export function useAgentMenus(
  agent: AgentService,
  s: AgentServiceState,
  deps: {
    modelOpen: { value: boolean }
    mcpOpen: { value: boolean }
    mcpToolsOf: (name: string) => Array<{ name: string; description: string; fullName: string }>
    ensureMcpProbed: () => void
  },
) {
const { modelOpen, mcpOpen, mcpToolsOf, ensureMcpProbed } = deps
/** 只有带密钥的模型能选 */
const usableModels = computed(() => s.models.filter((m) => m.hasKey))

/**
 * 面板化下拉（demo 同款）的本地状态：搜索词 / 视图 / 平台过滤。
 * 只放在这里，不进全局 store —— 它是菜单内部的浏览状态，关掉即重置（demo 口径）。
 */
const modelQuery = ref('')
const modelView = ref<'card' | 'split'>('card')
const modelPlatform = ref('all')
const skillQuery = ref('')
const skillView = ref<'card' | 'split'>('card')
const mcpQuery = ref('')
/** 模型 / 技能面板的卡片-分栏切换（Tabs 值来自组件库，收窄成两档） */
function setModelView(value: string | number): void {
  modelView.value = value === 'split' ? 'split' : 'card'
}
function setSkillView(value: string | number): void {
  skillView.value = value === 'split' ? 'split' : 'card'
}
/** 技能分栏的分类过滤（DEMO 的 activeCategory；卡片视图不看它，切到卡片时重置为全部） */
const skillCategory = ref('全部')

function modelNote(m: { contextWindow?: number; isVision: boolean }): string {
  if (m.contextWindow) return Math.round(m.contextWindow / 1000) + 'K'
  return m.isVision ? '视觉' : ''
}

/**
 * 这条模型是不是当前选中的那个。
 *
 * 为什么不能只比 modelId：不同 provider 可能有同名模型 ID（openrouter 的
 * `deepseek/...` 与 deepseek 官方同名尾巴），只比 ID 会把两条同时点亮。
 * provider 与 modelId 一起比才是「同一个模型」的唯一真相。
 */
function isModelPicked(m: { provider: string; modelId: string }): boolean {
  return s.model?.provider === m.provider && s.model?.modelId === m.modelId
}

/**
 * 外壳标题下要显示的「当前模型」：有 displayName 用显示名，否则 modelId。
 * 没选模型时返回空串，外壳据此显示「未选择模型」。
 */
const currentModelLabel = computed(() => {
  if (!s.model) return ''
  const hit = s.models.find((m) => m.provider === s.model!.provider && m.modelId === s.model!.modelId)
  return hit?.displayName || s.model.modelId
})

/** 模型 → 平台 key（品牌图标与分栏分组共用一把尺子） */
function platformOf(m: { provider: string; modelId: string }): string {
  return detectPlatform(m.modelId, m.provider)
}

/** 平台展示名（卡片副行第一段） */
function brandNameOf(m: { provider: string; modelId: string }): string {
  return brandName(platformOf(m))
}

/** 卡片上的品牌图标（35px 托里 22px svg，尺寸由 CSS 管） */
function brandSvgOf(m: { provider: string; modelId: string }): string {
  return brandSvg(platformOf(m))
}

/** 技能分栏封面：名字 hash 成稳定色相（demo 的彩色渐变封面同款思路，数据里没有 hue 就从名字算）。 */
function skillCoverStyle(name: string): Record<string, string> {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  const hue2 = (hash + 42) % 360
  return {
    '--cover-h1': String(hash),
    '--cover-h2': String(hue2),
  }
}

/**
 * 分栏左列的平台分组：按 DEMO 的「平台」聚合（不是按 provider 原样分组）。
 *
 * 为什么要聚合：真实配置里 40 个可用模型可能来自 5 个 provider（openrouter 一家就几十个
 * 模型 ID），按 provider 列出来左列只有 5 行、右边几十行混着所有平台；DEMO 的口径是
 * 「DeepSeek / OpenAI / Claude … 每个平台一行」，所以先 detectPlatform 再聚合。
 * key 用平台 key（all 表示全部），过滤时用同一把尺子。
 */
const modelPlatformGroups = computed(() => {
  const order: Array<{ key: string; label: string; count: number }> = []
  for (const m of usableModels.value) {
    const key = detectPlatform(m.modelId, m.provider)
    const hit = order.find((g) => g.key === key)
    if (hit) hit.count++
    else order.push({ key, label: brandName(key), count: 1 })
  }
  return [{ key: 'all', label: '全部平台', count: usableModels.value.length }, ...order]
})

const filteredModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return usableModels.value.filter((m) => {
    if (modelPlatform.value !== 'all' && detectPlatform(m.modelId, m.provider) !== modelPlatform.value) return false
    if (!q) return true
    const brand = brandName(detectPlatform(m.modelId, m.provider))
    return (m.modelId + ' ' + m.provider + ' ' + modelNote(m) + ' ' + brand).toLowerCase().includes(q)
  })
})

const filteredSkills = computed(() => {
  const q = skillQuery.value.trim().toLowerCase()
  const items = skillResources(s.skills)
  // 分栏视图先按分类过滤（DEMO 口径：左列分类 = 全部 / 精选 / 各分类）
  const byCategory = items.filter((item) => {
    if (skillCategory.value === '全部') return true
    if (skillCategory.value === '精选') return skillMetaOf(item.name).featured
    return skillMetaOf(item.name).category === skillCategory.value
  })
  if (!q) return byCategory
  return byCategory.filter((item) => (item.name + ' ' + item.value).toLowerCase().includes(q))
})

/**
 * 技能的展示元数据（分类 / 精选 / 色相）。
 *
 * 后端只给名字 + 描述 + 目录，没有分类与封面；DEMO 用「教育培训 / 短视频 / 专业影视…」
 * 分组并给每个技能一个色相。这里按名字稳定派生：同一技能每次进来分类与颜色都一样
 *（不能用随机 —— 切一下视图封面就换色，看着像加载错了）。
 *
 * 精选 = 目录文件数 >= 4 的那批（DEMO 的 featured 标记；真实数据里 fileCount 是唯一可用的信号）。
 */
const SKILL_CATEGORIES = ['教育培训', '短视频', '商业广告', '专业影视', '动漫游戏', '音乐 MV', '短剧漫剧'] as const
const skillMetaCache = new Map<string, { category: string; featured: boolean; hue: number }>()
function skillMetaOf(name: string): { category: string; featured: boolean; hue: number } {
  const hit = skillMetaCache.get(name)
  if (hit) return hit
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const row = s.skills.find((k) => k.name === name)
  const text = name + ' ' + (row?.description ?? '')
  let textHash = 0
  for (let i = 0; i < text.length; i++) textHash = (textHash * 31 + text.charCodeAt(i)) >>> 0
  const meta = {
    category: SKILL_CATEGORIES[textHash % SKILL_CATEGORIES.length]!,
    featured: (row?.fileCount ?? 0) >= 4,
    hue: hash % 360,
  }
  skillMetaCache.set(name, meta)
  return meta
}

/** 分栏左列的分类行（DEMO 的 skillCategories：全部 → 各分类 → 精选，带计数） */
const skillCategoryRows = computed(() => {
  const items = skillResources(s.skills)
  const rows: Array<{ name: string; count: number }> = [{ name: '全部', count: items.length }]
  for (const cat of SKILL_CATEGORIES) {
    const count = items.filter((item) => skillMetaOf(item.name).category === cat).length
    if (count) rows.push({ name: cat, count })
  }
  const featured = items.filter((item) => skillMetaOf(item.name).featured).length
  if (featured) rows.push({ name: '精选', count: featured })
  return rows
})

/** 技能的文件数（后端给了 fileCount；没有就给 0，界面上仍显示「0 文件」） */
function skillFileCount(name: string): number {
  return s.skills.find((k) => k.name === name)?.fileCount ?? 0
}

/** 技能体积：SKILL.md 的字节数，按 KB 显示（不足 1KB 显示字节） */
function skillSize(name: string): string {
  const bytes = s.skills.find((k) => k.name === name)?.size ?? 0
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

/**
 * MCP 面板的搜索结果（用户口径 2026-10-30）。
 *
 * 搜索范围要覆盖**四样东西**：服务名、服务说明（地址/命令）、工具名、工具描述。
 * 只按服务名过滤的话，用户记得「有个叫 canvas_get 的工具」却想不起它在哪个服务下，
 * 就只能一条条展开找 —— 那正是这里要省掉的动作。
 * 命中工具、但服务名本身没命中时，这批工具单独收窄（toolHits），卡片自动展开只露命中项。
 */
const filteredMcpResources = computed(() => {
  const q = mcpQuery.value.trim().toLowerCase()
  const items = mcpResources(s.mcpServers)
  type McpToolRow = { name: string; description: string; fullName: string }
  if (!q) return items.map((item) => ({ ...item, toolHits: null as null | McpToolRow[] }))
  const hit = (text: string): boolean => text.toLowerCase().includes(q)
  const out: Array<(typeof items)[number] & { toolHits: null | McpToolRow[] }> = []
  for (const item of items) {
    const serverHit = hit(item.name) || hit(item.value ?? '')
    const tools = mcpToolsOf(item.name)
    const toolHits = tools.filter((t) => hit(t.name) || hit(t.description))
    if (!serverHit && !toolHits.length) continue
    out.push({ ...item, toolHits: serverHit ? null : toolHits })
  }
  return out
})

/**
 * 模型列表的滚动区（`.ac-menu-scroll`）。
 *
 * 为什么打开时要滚一下（用户口径 2026-10-10，附截图）：模型可能几十条（自建网关几十上百个
 * 模型 ID），列表限高只露几行 —— 当前选中的那条多半在可视区外，点开根本看不到"现在用的是哪个"，
 * 得自己往下翻。于是打开那一刻把它滚进可视区。
 *
 * 为什么用 ref 而不是进 DOM 里 querySelector：ref 直接拿到就是这个容器的元素，
 * 不用猜结构、也不会误伤别的下拉（技能 / MCP 也长着 .ac-menu-scroll）。
 */
const modelScrollRef = ref<HTMLElement | null>(null)

/** 模板 ref 可能指向原生元素，也可能指向 AgentScrollArea；统一取回真实 DOM。 */
function scrollRootOf(value: unknown): HTMLElement | null {
  if (!value) return null
  if (value instanceof HTMLElement) return value
  const exposed = value as { rootElement?: () => HTMLElement | null }
  return typeof exposed.rootElement === 'function' ? exposed.rootElement() : null
}

/**
 * 把选中的那条滚进列表的可视区（打开下拉时调一次）。
 *
 * 几何量法：用 `getBoundingClientRect()` 换算（见函数体注释）。
 * 曾经用 `offsetTop` 相减，理由是「rect 会被入场 scale 动画缩过」。
 * 但 offsetTop 只在**同一个 offsetParent** 下才可比 —— 模型列表的项与滚动区隔了两层，
 * 相减出来的值不是项在内容里的位置，滚完选中项仍贴在可视区下缘（2026-10-30 实测）。
 * 选中态认 `aria-selected="true"` —— 那是选中项的唯一真相，不再另造一个类名当第二处真相。
 */
function scrollSelectedModelIntoView(): void {
  // 卡片视图与分栏视图是**两个不同的滚动容器**（.ac-menu-scroll / .ac-split-scroll），
  // 切视图时 ref 还指着旧的那个 —— 对它写 scrollTop 什么也不会发生，
  // 表现就是「切到分栏，选中项又跑回列表顶」。所以每次都按当前 DOM 重新取一次，
  // 并优先认「正真装着选中项」的那个容器。
  const root = scrollRootOf(modelScrollRef.value)
  // 必须限定 role="option"：分栏视图的 TabsTrigger 也用 aria-selected 表示当前页签，
  // 只按 aria-selected 找会先命中「分栏」按钮，滚错元素。
  const sel = (root ?? document).querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  // ScrollArea 真正滚动的是内部 viewport，不是组件的根节点；取容器时必须落到 viewport。
  const scrollViewport = (el: Element | null | undefined): HTMLElement | null =>
    el?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? (el as HTMLElement | null) ?? null
  const box = scrollViewport(sel?.closest<HTMLElement>('.ac-split-scroll, .ac-menu-scroll') ?? scrollViewport(root))
  if (!box || box.clientHeight <= 0) return
  const item = sel && box.contains(sel) ? sel : box.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  if (!item) return
  // 用**真实矩形**换算，不用 offsetTop：列表项可能挂在不同的 offsetParent 下
  // （模型面板外面还套着 .ac-panel-body / .ac-menu-scroll 两层），
  // 一旦 offsetParent 不一致，offsetTop 相减就不是「项在滚动内容里的位置」，
  // 滚出来的结果就会差一截、选中项仍停在可视区边缘（2026-10-30 实测）。
  // 公式：项相对可视区的位置 = itemRect.top - boxRect.top，再加上当前 scrollTop
  // 就换算到内容坐标系。入场 scale 动画的影响在下面 done 回调里已等过一帧。
  const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  box.scrollTop = scrollTopForVisibleItem(
    { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight },
    { top, height: item.offsetHeight },
    4,
  )
  // 落地后再量一次，按**实际差**补齐。
  // 为什么要补：算出来的落点是按「滚之前的布局」估的，滚完滚动条可能出现/消失、
  // 行高也可能因换行重排而变，实际位置会差几个像素（实测 7px，正好卡在下缘外）。
  // 与其猜是哪一个量不准，不如按真实矩形收尾 —— 差多少补多少，最多再修一次。
  const selRect = item.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  if (selRect.bottom > boxRect.bottom) {
    box.scrollTop += selRect.bottom - boxRect.bottom
  } else if (selRect.top < boxRect.top) {
    box.scrollTop -= boxRect.top - selRect.top
  }
}

/**
 * 打开下拉时把选中项滚进可视区 —— 要滚两次。
 *
 * 第一次在 nextTick：面板刚挂上 DOM，先按当时的布局滚一下，用户不会看到「停在列表顶」。
 * 第二次在 200ms 后：浮层入场带 0.14s 的 scale(.96) 动画，动画中量出来的 rect 是全比例缩过的，
 * 换算出的位置会偏；等动画结束再按最终布局校正一次，选中项才真正落在可视区里
 * （2026-10-30 实测：只滚第一次时选中项停在下缘外面）。
 */
function scheduleScrollSelectedModel(): void {
  scrollSelectedModelIntoView()
  window.setTimeout(() => scrollSelectedModelIntoView(), 200)
}

/**
 * 盯着列表的可视高度：它一变就重新定位选中项。
 *
 * 为什么光靠定时器不够：浮层在入场动画里高度是渐变的，菜单设的 min-height 也在第一帧才生效，
 * 动画结束后可视高度还会再变一次（实测 332 → 319）。只按某个固定时刻算，选中项就会差十几像素、
 * 正卡在可视区下缘外。ResizeObserver 直接把「尺寸定型」当成触发条件，不猜时机。
 */
let modelBoxObserver: ResizeObserver | null = null
let modelBoxResizeTimer: number | null = null

/**
 * 高度一变就重新定位 —— 但不能**每次**都立刻滚。
 *
 * 坑（2026-10-30 实测）：写 scrollTop 本身会让滚动条出现/消失，可视高度随之变一点，
 * ResizeObserver 又触发一次，量到的还是「滚动前」的布局，于是把刚滚好的位置往回拉几像素，
 * 选中项正好卡在下缘外（差 7px）。所以一次尺寸变化先攒 80ms，尺寸稳下来了再算一次。
 */
function observeModelBox(): void {
  modelBoxObserver?.disconnect()
  // 观察「当前真正在滚的那一层」：卡片视图是 .ac-menu-scroll，分栏视图是右栏 .ac-split-scroll。
  const root = scrollRootOf(modelScrollRef.value)
  // ScrollArea 的滚动事件落在内部 viewport 上：观察者也必须盯 viewport，盯根节点不会触发。
  const box = root?.querySelector<HTMLElement>('.ac-split-scroll [data-slot="scroll-area-viewport"]')
    ?? root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    ?? null
  if (!box || typeof ResizeObserver === 'undefined') return
  modelBoxObserver = new ResizeObserver(() => {
    if (modelBoxResizeTimer !== null) window.clearTimeout(modelBoxResizeTimer)
    modelBoxResizeTimer = window.setTimeout(() => {
      modelBoxResizeTimer = null
      scrollSelectedModelIntoView()
    }, 80)
  })
  modelBoxObserver.observe(box)
}

watch(modelOpen, (open) => {
  if (!open) {
    modelBoxObserver?.disconnect()
    modelBoxObserver = null
    return
  }
  void nextTick(() => {
    scheduleScrollSelectedModel()
    observeModelBox()
  })
})

// 切卡片/分栏会换一整套列表（高度、行高都变），选中项的位置也跟着变，同样要重新定位
watch(modelView, () => {
  if (!modelOpen.value) return
  void nextTick(() => {
    // 切视图后滚动容器整个换了，观察者要跟着换到新容器上
    observeModelBox()
    scheduleScrollSelectedModel()
  })
})

// 组件卸载时断开观察者（面板关掉、Agent 面板被销毁都走这里）
onBeforeUnmount(() => {
  modelBoxObserver?.disconnect()
  modelBoxObserver = null
})

// 首次打开 MCP 面板时自动探一次：不探就没有工具清单，展开区是空的、也搜不到工具名。
watch(mcpOpen, (open) => {
  if (open) ensureMcpProbed()
})

/** 点一项 = 切模型并收起（滚不滚是打开那一刻的事，这里不用管） */
function pickModel(m: { provider: string; modelId: string }, close: () => void): void {
  // 切模型 = 换一条会话（SDK 的模型钉在会话上）：服务那边会把历史接过去、
  // 补一条模型分段，界面上就出现"从这里换了模型"的分割线（用户口径 2026-10-11）。
  void agent.setModel(m.provider, m.modelId)
  close()
}

/**
 * 模式 = **两套独立的系统提示词**（用户口径 2026-10-05）。
 *
 * 以前这里是个死开关（选了不影响任何行为）。现在它读后台的提示词清单：
 * 选中哪一条，发送时就把那条的正文当系统提示词发给后端（见 agentService.sendOptions）。
 * 清单在「设置 → Agent → 提示词」里维护；内置两条不可删。
 */
const promptPresets = computed(() => s.prompts)
const activePrompt = computed(() => s.prompts.find((p) => p.id === s.activePromptId))
const modeLabel = computed(() => activePrompt.value?.name ?? '全能创作')
function pickMode(id: string, close: () => void): void {
  void agent.setActivePrompt(id)
  close()
}

return {
  usableModels,
  modelQuery,
  modelView,
  modelPlatform,
  skillQuery,
  skillView,
  mcpQuery,
  setModelView,
  setSkillView,
  skillCategory,
  modelNote,
  isModelPicked,
  currentModelLabel,
  platformOf,
  brandNameOf,
  brandSvgOf,
  skillCoverStyle,
  modelPlatformGroups,
  filteredModels,
  filteredSkills,
  SKILL_CATEGORIES,
  skillMetaCache,
  skillMetaOf,
  skillCategoryRows,
  skillFileCount,
  skillSize,
  filteredMcpResources,
  modelScrollRef,
  scrollSelectedModelIntoView,
  scheduleScrollSelectedModel,
  modelBoxObserver,
  modelBoxResizeTimer,
  observeModelBox,
  pickModel,
  promptPresets,
  activePrompt,
  modeLabel,
  pickMode,
}
}
