// useUi —— 画布外壳的共享 UI 状态（单例）。
// 所有区域组件从这里读写状态，避免 App.vue 承担几十个 prop 的透传。
// 只有纯 UI / 虚拟数据；画布本体仍由 CanvasHost 负责。
import { computed, reactive, ref, shallowRef } from 'vue'
import type { SettingsStore } from '@mini-canvas/kernel'
import {
  DEFAULT_THEME_EDGE, DEFAULT_THEME_HANDLE, DEFAULT_THEME_DEBUG, DEFAULT_THEME_SNAP_ZONE,
  EDGE_SETTING_KEYS, HANDLE_SETTING_KEYS, DEBUG_SETTING_KEYS, SNAP_ZONE_SETTING_KEYS,
} from '@mini-canvas/plugin-theme-default'
import { createV2Logger } from '@mini-canvas/canvas-render'
import { buildV2HelpList, groupV2HelpList, keyPartsToLabels } from '@mini-canvas/plugin-shortcut-manager'
import { SAMPLE_IMAGE_URL } from '../assembly'

const log = createV2Logger('config')

interface HostApi {
  ctx?: { get<T>(key: string): T; on(evt: string, cb: () => void): { dispose(): void } }
  command?: { execute(id: string, payload?: unknown): void }
  nodeStore?: { getNodes(): unknown[] }
}
/**
 * CanvasHost @ready 传出的宿主句柄（存进单例，供小地图等直接读 ctx）。
 *
 * **必须是响应式的**（实测教训）：这个句柄在画布就绪后才写进来，而它的读取点全在
 * computed / 渲染函数里（App.vue 的 right-width、minimapOn、agent.open…）。写成普通变量时，
 * 首次渲染读到 undefined → 表达式短路、一个依赖都没收集到；之后 @ready 赋值又不触发重算，
 * 于是「停靠 Agent 面板」这类依赖右缘宽度的布局**永远不更新**。现象就是：停靠后画布没被挤窄，
 * 右上角那排按钮压在 Agent 面板标题上（用户报告的「点击侧边栏和右上角按钮重合」）。
 *
 * 为什么用 `{ get ctx }` 而不是把变量本身改成 ref：读取点有十几处，写成 `readyHost.value?.ctx`
 * 要逐处改。这里保留 `readyHost?.ctx` 的调用写法，只把「读」变成一个 getter ——
 * 任何在 effect 里读 `readyHost.ctx` 的地方都会把 hostRef 收进依赖，赋值即触发重算。
 */
const hostRef = shallowRef<HostApi | undefined>()
export const readyHost: { readonly ctx?: HostApi['ctx'] } = {
  get ctx() {
    return hostRef.value?.ctx
  },
}
export function setReadyHost(h: unknown): void {
  hostRef.value = h as HostApi | undefined
}
/** CanvasHost 暴露的完整宿主（与 window.MiniCanvasUI.getHost() 同源） */
type FullHost = HostApi & { command: { execute(id: string, payload?: unknown): void }; nodeStore: { getNodes(): unknown[] } }
interface ManagerApi { install(opts: { url: string }, cfg?: { config?: unknown }): Promise<void> }
interface HostLike { host?: HostApi; manager?: ManagerApi }
interface ManifestEntry { id: string; url: string; disabled?: boolean }

export interface TreeNode { id: string; name: string; meta: string; icon: 'group' | 'image' | 'video' | 'text'; children?: TreeNode[] }

function createUi() {
  const cfg = reactive({
    edge: { ...DEFAULT_THEME_EDGE },
    handle: { ...DEFAULT_THEME_HANDLE },
    debug: { ...DEFAULT_THEME_DEBUG },
    snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
  })

  const state = reactive({
    // 主题 / 视图
    theme: 'dark' as 'dark' | 'light',
    navMode: 'workflow' as 'workflow' | 'storyboard',
    settingsOpen: false,
    // 顶部
    canvasMenuOpen: false,
    canvasList: ['画布 1', '画布 2', '画布 3'],
    currentCanvas: '画布 1',
    // 弹窗开合（快捷键 / 生成历史独立，可与抽屉共存）
    shortcutsOpen: false,
    historyOpen: false,
    drawer: null as 'left' | 'roles' | null,
    drawerWidth: 320,
    leftCollapsed: false,
    leftTab: 'canvas' as 'canvas' | 'assets',
    filterTypeOpen: false,
    filterRatingOpen: false,
    filterType: '全部',
    filterRating: '所有评级',
    // 画布 tab 搜索：点放大镜进入搜索态（工具行变成 输入框+筛选+关闭），再点 × 或 Esc 退出
    searchOpen: false,
    searchQuery: '',
    // 底部 dock
    addMenuOpen: false,
    moveMenuOpen: false,
    libraryMenuOpen: false,
    canvasMode: 'move' as 'move' | 'hand',
    /**
     * 画布缩放（百分数）的**镜像值**：唯一事实来源是真实视口（viewport 服务的 getViewport().zoom）。
     * 这里只在"视口变化结束"与"宿主就绪"时同步过来给状态栏显示；菜单动作则调 viewport 服务改真实画布。
     */
    zoom: 100,
    zoomMenuOpen: false,
    /**
     * 隐藏节点连线 / 网格吸附的**镜像值**（关闭时图标画斜线，照目标）。
     *
     * 唯一事实来源是内核设置（ctx.get('settings') 的 edgeVisible / snapToGrid），
     * 这里只是订阅后同步过来的副本：状态栏按钮负责写设置，设置面板改也走同一条通道，
     * 两边读到的永远是同一个值（见 bindCanvasToggles）。
     */
    edgesVisible: true,
    snapOn: true,
    // 左下状态条
    // 画布
    following: false,
    storyboard: [
      { type: '文本', items: [{ name: '提示词', meta: '文本节点', icon: 'text' }] },
      { type: '图片', items: [
        { name: '25宫格连贯分镜', meta: '待确认后生成 · General image V2', icon: 'image' },
        { name: '720°全景图', meta: '待确认后生成 · Lib Image', icon: 'image' },
        { name: 'pasted', meta: '903 x 666', icon: 'image' },
        { name: '参考图', meta: '3072 x 5461', icon: 'image' },
        { name: '图片节点 4', meta: '待确认后生成 · Lib Image 2.5 Pro', icon: 'image' },
        { name: '正派长辈/母 角色立绘', meta: '1536 x 2048', icon: 'image' },
      ] },
      { type: '视频', items: [
        { name: '成品', meta: 'Kling O1 · 5秒 · 1080 x 1920', icon: 'video' },
        { name: '视频节点 2', meta: '待确认后生成 · 2.5', icon: 'video' },
      ] },
    ] as Array<{ type: string; items: Array<{ name: string; meta: string; icon: string }> }>,
    // AI 对话面板（默认收起，底栏星形按钮可展开）
    chatOpen: false,
    chatDocked: false,
    /** 浮动态默认 400×640（照 LibTV）；停靠态默认 516 */
    chatWidth: 400,
    chatHeight: 640,
    /** 浮窗缩放下限（照目标：不能缩得比这更小） */
    chatMinW: 320,
    chatMinH: 400,
    chatPos: null as { x: number; y: number } | null,
    /** Agent 面板的历史下拉是否展开（外壳自己的界面状态） */
    agentHistoryOpen: false,
    chatInput: '',
    chatTitle: '技能总结',
    chatMessages: [
      { role: 'user', text: '根据这些画布节点总结 Skill', refs: [{ name: '视频节点 2', tag: '图生图', prompt: '根据这些画布节点总结 Skill' }] },
      { role: 'ai', text: '已读取 19 个节点：包含分组、参考图、成品与智能剪辑节点。可以为你生成一套「角色设定 + 分镜」的可复用 Skill。' },
    ] as Array<{ role: 'user' | 'ai'; text: string; refs?: Array<{ name: string; tag: string; prompt: string }> }>,
    chatHistories: [
      { title: '技能总结', date: '9/17' },
      { title: '感谢夸奖', date: '9/17' },
      { title: '产品视频脚本', date: '9/16' },
    ],
    chatModes: ['全能创作', '图片生成', '视频生成', '智能剪辑'],
    chatMode: '全能创作',
    chatModeOpen: false,
    chatSuggestions: ['5分钟超长视频', '首尾帧生成视频', '首帧生成视频'],
    contextLeft: 96,
    genMode: 'manual' as 'manual' | 'auto',
    modelTab: 'image' as 'image' | 'video',
    models: [
      { name: 'Lib Image 2.5 Pro', desc: '精准生成与编辑，复杂指令稳定还原' },
      { name: 'Lib Image 2.5 Fast', desc: '极速高质量图像生成，兼顾效果与效率' },
      { name: 'Lib Image', desc: '最新图片模型、长文本能力突出' },
      { name: 'General image Pro', desc: '最强图片编辑模型，一致性好' },
      { name: 'General image V2', desc: '支持联网搜索、文字准确、速度更快' },
      { name: 'Seedream 5.0 Pro', desc: '精准交互式编辑，支持原生多语言排版' },
      { name: 'Style Image V8.2', desc: '电影感全面升级，精准还原光影、人物与真实材质' },
    ],
    currentModel: 'Lib Image 2.5 Pro',
    skillTab: 'all' as 'all' | 'fav' | 'mine',
    skills: [
      { name: '皮克斯动画广告', path: '/pixar-animated-ad-creator', desc: '从角色立绘、分镜草图到最终合成带广告歌的完整成片' },
      { name: '爆款拉片复刻', path: '/viral-video-replicator', desc: 'AI拆解爆款视频，一键复刻同款' },
      { name: '新中式美学TVC', path: '/neo-chinese-aesthetic-tvc', desc: '东方意境产品大片，快速出片' },
      { name: '分镜脚手架', path: '/storyboard-builder', desc: '从文本大纲生成 25 宫格连贯分镜' },
    ],
    currentSkill: null as string | null,
    directorOpen: false,
    director: { collab: true, budget: false, budgetLimit: 1000, notify: true, sound: true },
    publishOpen: false,
    creditsOpen: false,
    memberOpen: false,
    // 角色造型室
    roleTab: 'mine' as 'mine' | 'official',
    roleFilters: { gender: '全部', age: '全部', region: '全部' },
    roleView: 'grid' as 'grid' | 'list',
    roleList: [
      { name: '正派长辈/母', tag: '女性 · 中老年 · 东方' },
      { name: '冷酷少年', tag: '男性 · 青年 · 东方' },
      { name: '未来战士', tag: '男性 · 青年 · 科幻' },
      { name: '温柔学姐', tag: '女性 · 青年 · 东方' },
      { name: '反派头目', tag: '男性 · 中老年 · 西方' },
      { name: '精灵弓箭手', tag: '女性 · 青年 · 奇幻' },
    ],
    // 生成历史
    histScopes: ['全部画布', '本画布'],
    histTypes: ['图片', '视频', '音频'],
    histScope: '全部画布',
    histType: '',
    histRating: '所有评级',
    histRatingOpen: false,
    histSortDesc: true,
    histZoom: 3,
    /**
     * 生成历史 —— **数据来自后台**（gen-history 服务），不是写死的假数组。
     * 由 loadHistory() 拉取并填充；历史弹窗只负责渲染。
     */
    historyItems: [] as Array<{ title: string; time: string; kind: string; urls?: string[] }>,
    /** 汇总：一共生成过多少（按类型分）—— 喂给历史弹窗上的计数徽章 */
    historySummary: { total: 0, byKind: {} as Record<string, number> },
    /** 是否拿到了后台历史（没连后台时为 false，弹窗给一句说明而不是空转） */
    historyReady: false,
    /** 历史分页 */
    histPage: 1,
    histPageSize: 20,
    histTotal: 0,
  })

  // ===== 左侧树（虚拟数据）=====
  const tree = reactive([
    { id: 'g1', name: 'Group 1', meta: '分组 3 个节点', icon: 'group', children: [
      { id: 'n1', name: '参考节点 1', meta: '图片 · 1024×1024', icon: 'image' },
      { id: 'n2', name: 'pasted', meta: '903 × 666', icon: 'image' },
    ] },
    { id: 'n3', name: '720°全景图', meta: '全景', icon: 'image' },
    { id: 'n4', name: '25宫格连贯分镜', meta: '分镜', icon: 'video' },
    { id: 'g2', name: '分组 3 个节点', meta: '分组', icon: 'group', children: [
      { id: 'n5', name: '参考图', meta: '1080 × 1920', icon: 'image' },
      { id: 'n6', name: '成品', meta: '1080 × 1920', icon: 'image' },
      { id: 'n7', name: '提示词', meta: '文本', icon: 'text' },
    ] },
    { id: 'n8', name: '智能剪辑 5', meta: '视频节点', icon: 'video' },
    { id: 'n9', name: '图片节点 4', meta: '图片节点', icon: 'image' },
    { id: 'n10', name: '正派长辈/母 表情参考', meta: '图片', icon: 'image' },
    { id: 'n11', name: '正派长辈/母 角色立绘', meta: '1536 × 2048', icon: 'image' },
    { id: 'n12', name: '正派长辈/母 脸部近景', meta: '1792 × 2400', icon: 'image' },
    { id: 'n13', name: '正派长辈/母 三视图', meta: '三视图', icon: 'image' },
    { id: 'n14', name: '图生图', meta: '图片节点', icon: 'image' },
    { id: 'n15', name: '图片节点 3', meta: '图片节点', icon: 'image' },
    { id: 'n16', name: '视频节点 2', meta: '视频节点', icon: 'video' },
    { id: 'n17', name: '导演台 1', meta: '3D 场景', icon: 'group' },
  ]) as TreeNode[]
  const collapsed = reactive<Record<string, boolean>>({})
  function nodeCount(nodes: TreeNode[]): number {
    return nodes.reduce((sum, n) => sum + 1 + (n.children ? nodeCount(n.children) : 0), 0)
  }
  const treeTotal = computed(() => nodeCount(tree))
  // 搜索过滤视图：关键字匹配名字；分组在自身或子孙命中时保留，且子孙命中时强制展开
  const filteredTree = computed<TreeNode[]>(() => {
    const q = state.searchQuery.trim().toLowerCase()
    if (!q) return tree
    const walk = (list: TreeNode[]): TreeNode[] =>
      list
        .map((n) => {
          if (!n.children) return n.name.toLowerCase().includes(q) ? n : null
          const kids = walk(n.children)
          return n.name.toLowerCase().includes(q) || kids.length ? { ...n, children: kids } : null
        })
        .filter((n): n is TreeNode => n !== null)
    const out = walk(tree)
    const mark = (list: TreeNode[]): void => { for (const n of list) if (n.children) { collapsed[n.id] = false; mark(n.children) } }
    mark(out)
    return out
  })
  // 历史：筛选与排序在**后台**做（那里有全量账本），这里只负责把结果拿出来渲染。
  // 所以 histVisible 不再本地过滤 —— 后台已经把当前页筛好了。
  const histVisible = computed(() => state.historyItems)
  /** 计数徽章：用后台的汇总（不是本地数当前页） */
  const histCount = (kind: string): number => state.historySummary.byKind[kind] ?? 0

  /** 历史弹窗上那些中文标签 ↔ 后台的英文值（显示层的事，写在显示层） */
  const HIST_KIND: Record<string, string> = { 图片: 'image', 视频: 'video', 音频: 'audio' }
  const HIST_RATING: Record<string, string> = {
    所有评级: 'all',
    已通过: 'passed',
    待审核: 'pending',
    已拒绝: 'rejected',
  }

  /**
   * 从后台拉一页历史。
   *
   * 服务名是 `gen-history`（由 plugin-cloud-client 挂上）。没装那个插件
   * （比如纯前端开着）时服务不存在 —— 给一句人话，而不是装作"没有历史"。
   */
  async function loadHistory(): Promise<void> {
    const svc = readyHost?.ctx?.get<{
      query(q?: Record<string, unknown>): Promise<{
        items: Array<{ title: string; kind: string; finishedAt: number; urls?: string[] }>
        total: number
        page: number
        pageSize: number
        summary: { total: number; byKind: Record<string, number> }
      }>
    }>('gen-history')
    if (!svc) {
      state.historyReady = false
      return
    }
    try {
      const page = await svc.query({
        page: state.histPage,
        pageSize: state.histPageSize,
        ...(state.histType ? { kind: HIST_KIND[state.histType] ?? state.histType } : {}),
        ...(state.histRating && state.histRating !== '所有评级'
          ? { rating: HIST_RATING[state.histRating] ?? state.histRating }
          : {}),
        order: state.histSortDesc ? 'desc' : 'asc',
        ...(state.histScope === '本画布' ? { canvasId: 'default' } : {}),
      })
      state.historyItems = page.items.map((e) => ({
        title: e.title,
        time: formatAgo(e.finishedAt),
        // 后台给英文值，这里换回中文标签（弹窗按中文渲染）
        kind: e.kind === 'video' ? '视频' : e.kind === 'audio' ? '音频' : '图片',
        ...(e.urls && e.urls.length > 0 ? { urls: e.urls } : {}),
      }))
      state.historySummary = page.summary
      state.histTotal = page.total
      state.historyReady = true
    } catch (err) {
      console.warn('[ui] 拉历史失败', err)
      state.historyReady = false
    }
  }

  /** 时间戳 → 「2 分钟前」这种短文案（列表里看的是"多久之前"，不是精确时刻） */
  function formatAgo(ts: number): string {
    if (!Number.isFinite(ts)) return ''
    const diff = Math.max(0, Date.now() - ts)
    const min = Math.floor(diff / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return min + ' 分钟前'
    const hour = Math.floor(min / 60)
    if (hour < 24) return hour + ' 小时前'
    const day = Math.floor(hour / 24)
    if (day === 1) return '昨天'
    if (day < 30) return day + ' 天前'
    return new Date(ts).toLocaleDateString()
  }

  // ===== 小地图显隐（唯一事实来源 = mini-map 插件服务；状态栏按钮只是它的开关） =====
  // host ctx.get('mini-map') 每次返回同一个 reactive 对象（插件 apply 里注入的），
  // computed 追踪 .visible 属性即可实时反映开关状态。
  const minimapOn = computed(() => (readyHost?.ctx?.get<{ visible: boolean }>('mini-map')?.visible) ?? false)
  function toggleMinimap(): void {
    const svc = readyHost?.ctx?.get<{ visible: boolean }>('mini-map')
    const next = !minimapOn.value
    // 优先写设置 miniMapVisible（插件订阅它同步服务，且会随配置持久化到下次启动）；
    // 设置键缺席（未装 mini-map 插件）时退回直接翻服务位，至少当下这次切换是生效的。
    const store = readyHost?.ctx?.get<SettingsStore>('settings')
    if (store?.has?.('miniMapVisible')) store.set('miniMapVisible', next)
    else if (svc) svc.visible = next
  }

  // ===== 画布开关（整理画布 / 连线显隐 / 网格吸附 / 移动工具）=====
  //
  // ===== Agent 对话（外壳在这里，内容在 plugin-agent 的 agent-conversation 槽里）=====
  // 状态与动作都住在 agent 服务上：外壳只读它、只调它，自己不存一份 ——
  // 这样别处（快捷键 / 底栏按钮）调同一个服务时，面板与它天然一致。
  /**
  * agent 服务句柄：**每次读都现取**（不用 computed 缓存）。
  *
  * 为什么不缓存：服务是插件在 apply 里注入的，可能在 createUi() 之后才上架；
  * computed 会把第一次的 null 记住，之后永远拿不到。
  * 属性访问本身仍是响应式的（读的是服务那个 reactive 对象的字段）。
  */
  /** 服务把状态放在 .state 上（方法在服务顶层），这里按同一形状读 */
  interface AgentShellView {
    open: boolean
    docked: boolean
    width: number
    title: string
    sessions: Array<{ id: string; title: string; preview?: string }>
  }
  const agentSvc = (): { state: AgentShellView } | undefined =>
    readyHost?.ctx?.get<{ state: AgentShellView }>('agent')
  /** 外壳要用的那几项（服务还没上架时给一份安全的空壳，界面照常渲染） */
  const agent = {
    get open(): boolean {
      return agentSvc()?.state.open ?? false
    },
    set open(v: boolean) {
      const svc = agentSvc()
      if (svc) svc.state.open = v
    },
    get docked(): boolean {
      return agentSvc()?.state.docked ?? false
    },
    set docked(v: boolean) {
      const svc = agentSvc()
      if (svc) svc.state.docked = v
    },
    get width(): number {
      return agentSvc()?.state.width ?? 400
    },
    set width(v: number) {
      const svc = agentSvc()
      if (svc) svc.state.width = v
    },
    get title(): string {
      return agentSvc()?.state.title ?? '新会话'
    },
    get sessions(): Array<{ id: string; title: string; preview?: string }> {
      return agentSvc()?.state.sessions ?? []
    },
  }
  /** 打开 / 收起面板（服务上没 toggle 时退回直接翻 open） */
  function setAgentOpen(open: boolean): void {
    const svc = agentSvc()
    if (svc) svc.state.open = open
  }
  function toggleAgent(): void {
    const svc = readyHost?.ctx?.get<{ toggle?: () => void; state?: { open: boolean } }>('agent')
    if (!svc) return
    if (typeof svc.toggle === 'function') svc.toggle()
    else if (svc.state) svc.state.open = !svc.state.open
  }
  function newAgentChat(): void {
    const svc = readyHost?.ctx?.get<{ newSession?: () => Promise<void> }>('agent')
    if (svc?.newSession) void svc.newSession()
  }
  function toggleAgentHistory(): void {
    state.agentHistoryOpen = !state.agentHistoryOpen
  }
  function openAgentSession(id: string): void {
    state.agentHistoryOpen = false
    const svc = readyHost?.ctx?.get<{ openSession?: (id: string) => Promise<void> }>('agent')
    if (svc?.openSession) void svc.openSession(id)
  }
  function renameAgentSession(id: string, current: string): void {
    const next = window.prompt('重命名这个对话', current)
    if (!next || !next.trim()) return
    const svc = readyHost?.ctx?.get<{ renameSession?: (id: string, t: string) => Promise<void> }>('agent')
    if (svc?.renameSession) void svc.renameSession(id, next.trim())
  }
  function deleteAgentSession(id: string): void {
    const svc = readyHost?.ctx?.get<{ deleteSession?: (id: string) => Promise<void> }>('agent')
    if (svc?.deleteSession) void svc.deleteSession(id)
  }

  // 原则：状态栏按钮**不自己保存一份状态、不直接碰画布**，只做两件事之一 ——
  //   ① 写内核设置（ctx.get('settings').set）：连线显隐 / 网格吸附 / 画布模式
  //      → 真正干活的是订阅这些 key 的消费方（渲染宿主 / 主题皮），与设置面板**同一条通道**；
  //   ② 执行命令（ctx.get('command').execute）：整理画布 / 聚焦
  //      → 走插件已注册的命令，复用撤销栈与落盘，不另抄一份实现。
  //
  // 为什么用 settings 而不是各插件的服务：edgeVisible / snapToGrid 是"宿主级"键
  // （theme-default / canvas-render 声明并订阅），设置面板已经在用它们；按钮也写同一处，
  // 面板与按钮天然同步、不出现"按钮关了面板还开着"这种双源漂移。
  /** 当前宿主句柄里的 ctx（拿不到 = 画布还没就绪，所有开关静默不动） */
  function hostCtx(): HostApi['ctx'] | undefined {
    return ((hostEl.value?.host ?? hostEl.value) as FullHost | undefined)?.ctx
  }
  /** 读设置现值（未声明 / 服务缺失 → undefined，调用方自行回落） */
  function readSetting<T extends string | number | boolean>(key: string): T | undefined {
    return hostCtx()?.get<SettingsStore>('settings')?.get(key) as T | undefined
  }
  /** 写设置现值（未声明时 set 会抛，这里吞掉 —— 按钮不该因某个插件没装就报错） */
  function writeSetting(key: string, value: string | number | boolean): void {
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store?.has?.(key)) return
    store.set(key, value)
  }
  /** 执行一条已注册命令（未注册 → no-op，不报错） */
  function runCommand(id: string): void {
    hostCtx()?.get<{ execute(id: string): unknown }>('command')?.execute(id)
  }

  // ===== 缩放（左下角「缩放选项」）=====
  //
  // 唯一事实来源 = 真实画布视口（viewport 服务的 getViewport().zoom）。状态栏那个百分比只是**镜像值**：
  // 由宿主就绪时同步一次 + 每次视口移动/缩放结束（RenderEvents.MoveEnd）再同步，显示永远与画布一致。
  // 菜单动作一律调 viewport 服务去改真实画布，不再只改一个数字（原先 s.zoom 是纯 UI 数字，
  // 从没接到 viewport 上 —— 表现为"点缩放至 100% 画布纹丝不动"）。
  /** viewport 服务的最小用面（契约见 canvas-data renderServiceContracts，宿主恒在注入） */
  type ViewportLike = {
    getViewport(): { zoom: number }
    zoomIn(): void
    zoomOut(): void
    zoomTo(level: number): void
    fitView(padding?: number): void
  }
  function viewportSvc(): ViewportLike | undefined {
    return hostCtx()?.get<ViewportLike>('viewport')
  }
  /** 把真实视口缩放同步到状态栏镜像值（未就绪 → 不动，保留上一次显示） */
  function syncZoomDisplay(): void {
    const zoom = viewportSvc()?.getViewport?.().zoom
    if (typeof zoom === 'number' && Number.isFinite(zoom)) state.zoom = Math.round(zoom * 100)
  }
  /** 放大（钳到 800%，与状态栏读数的上限一致） */
  function zoomInStep(): void {
    const svc = viewportSvc()
    if (!svc) return
    const current = Math.round((svc.getViewport?.().zoom ?? 1) * 100)
    svc.zoomTo(Math.min(800, current + 10) / 100)
  }
  /** 缩小（钳到 10%） */
  function zoomOutStep(): void {
    const svc = viewportSvc()
    if (!svc) return
    const current = Math.round((svc.getViewport?.().zoom ?? 1) * 100)
    svc.zoomTo(Math.max(10, current - 10) / 100)
  }
  /** 缩放到某个倍率（缩放菜单里的「缩放至 X%」） */
  function zoomToPercent(percent: number): void {
    viewportSvc()?.zoomTo(percent / 100)
  }
  /**
   * 缩放到最大（缩放菜单里的「缩放到最大」）。
   *
   * "最大"取自宿主级设置 `maxZoom`（分组「常规/画布」，默认 2 = 200%，设置面板可调 1–8），
   * 而不是写死一个 800% —— 那样在默认上限 200% 下点了也到不了，文案与实际不符。
   * 设置键缺席（旧宿主）时按同一默认 2 兜底。
   */
  function zoomToMax(): void {
    const svc = viewportSvc()
    if (!svc) return
    const max = readSetting<number>('maxZoom')
    svc.zoomTo(typeof max === 'number' && Number.isFinite(max) ? max : 2)
  }
  /** 适合屏幕（把整张图收进视口；替代原先那个只改文字的假按钮） */
  function zoomFit(): void {
    viewportSvc()?.fitView()
  }
  /**
   * 让状态栏读数始终跟着真实视口走。
   *
   * 为什么用常驻 rAF 而不是订阅视口事件：**程序化缩放不发 VueFlow 的 move 事件**（实测 zoomTo /
   * fitView / 小地图拖拽 / 首屏 fitView 全部不发 moveEnd），只靠 `RenderEvents.MoveEnd` 订阅会让读数
   * 停在旧值（表现为"点了缩放至 100%，画布动了、数字没动"）。逐帧比对一次真实 zoom、变了才写
   * （同一个整数不触发响应式），任何来源的缩放都跟得上；成本是一次 getViewport + 整数比较，可忽略。
   * 与 App.vue 里给小地图逐帧定位的 rAF 同款做法。重复 onReady 先撤旧循环。
   */
  let disposeZoomBind: (() => void) | undefined
  function bindZoomSync(): void {
    disposeZoomBind?.()
    disposeZoomBind = undefined
    const ctx = hostCtx()
    if (!ctx) return
    syncZoomDisplay()
    // node/SSR 环境没有 rAF：只做一次同步即可（那些环境也没有真实视口可跟）
    if (typeof requestAnimationFrame !== 'function') return
    let raf = requestAnimationFrame(function tick(): void {
      syncZoomDisplay()
      raf = requestAnimationFrame(tick)
    })
    disposeZoomBind = () => { cancelAnimationFrame(raf) }
  }
  /** 撤掉视口订阅（宿主销毁时调用，与 unbindSettingsClose / unbindCanvasToggles 同处） */
  function unbindZoomSync(): void {
    disposeZoomBind?.()
    disposeZoomBind = undefined
  }

  /**
   * 连线显隐：写设置 edgeVisible（分组「边/连线」，默认皮 CustomEdge 订阅它决定画不画）。
   * 与设置面板里那个「显示连线」开关是**同一个键** —— 在哪边改，另一边立刻一致。
   */
  function toggleEdges(): void {
    const next = !state.edgesVisible
    writeSetting('edgeVisible', next)
    state.edgesVisible = readSetting<boolean>('edgeVisible') ?? next
  }

  /**
   * 网格吸附：写设置 snapToGrid（分组「常规/画布」，渲染宿主 CanvasHost 订阅后绑给 VueFlow）。
   * 吸附间距 snapGridX/Y 由同一个设置面板调，按钮只管开关。
   */
  function toggleSnap(): void {
    const next = !state.snapOn
    writeSetting('snapToGrid', next)
    state.snapOn = readSetting<boolean>('snapToGrid') ?? next
  }

  /**
   * 整理画布：执行 auto-layout 插件的自动布局命令（Ctrl/Cmd+L 同一条命令）。
   * 走命令而非自写布局：结果一次写进 doc（含历史与落盘），撤销/重做与快捷键行为完全一致。
   */
  function organizeCanvas(): void {
    runCommand('auto-layout:run')
  }

  /**
   * 切换画布鼠标工具（移动 / 抓手）。两个模式各写两个宿主级设置键：
   *
   * - 移动 move：`nodesDraggable=true` + `panOnDrag=true` → 拖节点移动节点、拖空白平移画布（默认态）。
   * - 抓手 hand：`nodesDraggable=false` + `panOnDrag=true` → 拖任何地方都是平移画布，
   *   节点不会被拖走（真正的"抓手"；再点移动即恢复）。
   *
   * 为什么用设置而不是自己存一份：这两个键（分组「常规/画布」）由渲染宿主订阅后绑给 VueFlow，
   * 写设置就等于真的改了画布交互；用户若在设置面板里手动开关这两项，模式按钮的状态也跟着翻。
   * 光标不用手写：panOnDrag 开着时 VueFlow 给画布层加 `draggable` → grab / grabbing（见其 style.css）。
   */
  function setCanvasMode(mode: 'move' | 'hand'): void {
    state.canvasMode = mode
    writeSetting('panOnDrag', true)
    writeSetting('nodesDraggable', mode === 'move')
  }

  /**
   * 订阅宿主设置变化，把「按钮关心的那几个键」同步到本地镜像值。
   *
   * 为什么必须订阅：设置面板改 edgeVisible / snapToGrid 时，状态栏图标的亮/暗与斜线
   * 也要跟着变；不订阅就会出现"面板关了、按钮还亮着"的假状态（本文件里 themePalette /
   * mini-map 也是同款做法）。重复 onReady 时先撤旧订阅，避免回调堆积。
   */
  let disposeCanvasToggleBind: (() => void) | undefined
  function bindCanvasToggles(): void {
    disposeCanvasToggleBind?.()
    disposeCanvasToggleBind = undefined
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store) return
    // 先按现值对齐一次（面板之前可能已经改过）
    state.edgesVisible = (store.get('edgeVisible') as boolean | undefined) ?? state.edgesVisible
    state.snapOn = (store.get('snapToGrid') as boolean | undefined) ?? state.snapOn
    // 画布模式由 nodesDraggable 反推：关掉拖节点 = 抓手态（拖哪都平移画布），否则是移动态
    const draggable = store.get('nodesDraggable') as boolean | undefined
    if (typeof draggable === 'boolean') state.canvasMode = draggable ? 'move' : 'hand'
    disposeCanvasToggleBind = store.onChange((key, value) => {
      if (key === 'edgeVisible' && typeof value === 'boolean') state.edgesVisible = value
      else if (key === 'snapToGrid' && typeof value === 'boolean') state.snapOn = value
      else if (key === 'nodesDraggable' && typeof value === 'boolean') state.canvasMode = value ? 'move' : 'hand'
    }).dispose
  }

  // ===== 快捷键数据 =====
  // 唯一事实来源 = 命令注册表的 keys 字段（与插件版帮助面板同源：buildV2HelpList/groupV2HelpList）。
  // 为什么不写死一份：写死的会跟真实按键漂移（曾经列了 Ctrl+Alt+G / Tab / Ctrl+Enter 等根本没实现的键）。
  // 每次**打开面板时**现读一次 —— 命令注册表没有变更订阅，插件热装/热卸后重开即得最新，成本是一句 list()。
  // 组合键的键帽翻译（mod → Ctrl/⌘、arrowup → ↑）也复用插件那份，避免两处各写一套。

  /** 注册表分组 → 面板中文组名 */
  const SHORTCUT_GROUP_LABEL: Record<string, string> = {
    system: '系统', edit: '编辑', canvas: '画布', view: '视图', plugin: '更多',
  }

  /** 从宿主命令注册表现读快捷键，按分组返回（拿不到宿主 → 空数组，面板相应为空） */
  function readShortcuts(): Array<{ group: string; items: Array<[string, string[]]> }> {
    const host = (hostEl.value?.host ?? hostEl.value) as (FullHost & { command?: { list(): Array<Record<string, unknown>> } }) | undefined
    const list = host?.command?.list?.()
    if (!list) return []
    const grouped = groupV2HelpList(
      buildV2HelpList(list as Parameters<typeof buildV2HelpList>[0]),
    )
    return grouped.map((g) => ({
      group: SHORTCUT_GROUP_LABEL[g.group] ?? g.group,
      items: g.items.map((it) => [it.command, keyPartsToLabels(it.keys)] as [string, string[]]),
    }))
  }

  /**
   * 面板展示用：只显示**真实注册**的快捷键（手势/鼠标操作不是命令、注册表里没有，不列）。
   * 用 reactive 数组（不是 ref）—— `ui` 是普通对象，模板里读 `ui.shortcuts` 时 ref 不会自动解包，
   * reactive 数组则能直接遍历；刷新时**原地替换内容**，绑定不换对象、不闪。
   */
  const shortcuts = reactive<Array<{ group: string; items: Array<[string, string[]]> }>>([])
  function refreshShortcuts(): void {
    shortcuts.splice(0, shortcuts.length, ...readShortcuts())
  }

  // ===== 宿主 =====
  const hostEl = ref<HostLike | null>(null)
  /**
   * 模板 ref 的写入口：App.vue 的函数 ref 调它把 CanvasHost 组件实例写进 hostEl 内部。
   * 为什么不直接 `ui.hostEl = el`：hostEl 经单例 reactive 解包后，setupState 里读到的是
   * HostLike 本身（不是 ref），赋值只会覆盖属性、写不进 ref.value —— 绑定会静默失效。
   */
  function setHostEl(el: unknown): void {
    hostEl.value = el as HostLike | null
  }
  let disposeSettingsBind: (() => void) | undefined
  /**
   * 内核事件 'settings:ui-close' 的订阅句柄。
   *
   * 为什么必须有：settingsPanel 是**可替换槽**，面板的关闭动作统一经 ctx.emit('settings:ui-close')
   * 通知宿主（渲染层 SettingsShell 的 ✕ / 遮罩 / Esc 都从这里出去，皮不需要自己发）。装配层若不订阅，
   * ✕ / 点遮罩就**静默失效**：不报错、不 warn、画面照旧，只有全局 Esc 兜得住。
   * 这里是那次广播的落点（把 settingsOpen 置 false → <SettingsHost v-if> 卸载面板）。
   */
  let disposeSettingsClose: (() => void) | undefined
  /**
   * 轻提示：按需求**已停用**（原本右下角会浮一个 "message" 气泡，容易和 Agent 面板重叠）。
   * 保留函数签名，调用点无需改动；要恢复提示只需重新实现这里。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function showToast(_message: string): void { /* 已停用：不渲染任何提示 */ }

  async function installExternalPlugins(): Promise<void> {
    const manager = hostEl.value?.manager
    if (!manager) return
    const manifest = await fetch('/plugin-manifest.json')
      .then((r) => (r.ok ? r.json() : { plugins: [] }))
      .catch(() => ({ plugins: [] }))
    const entries: ManifestEntry[] = Array.isArray(manifest?.plugins) ? manifest.plugins : []
    const cloudBase = (import.meta.env?.VITE_CLOUD_BASE_URL as string | undefined) ?? ''
    for (const entry of entries) {
      if (entry.disabled) continue
      try {
        // 把「服务地址」注入给云端插件。
        // ★ 这里按**服务名**判断，不看目录名 —— 插件改过名（plugin-cloud-client），
        //   按老目录名匹配会静默失效：dev 下（ui 在 5288、后台在别处）插件拿不到地址，
        //   画布存档与动作会一起失效，而且不报错。
        const conf = cloudBase && entry.id.includes('cloud') ? { cloudClientBaseUrl: cloudBase } : undefined
        await manager.install({ url: entry.url }, conf ? { config: conf } : undefined)
        log.log('外部插件已装载: ' + entry.id)
      } catch (err) {
        console.warn('[ui] 外部插件装载失败: ' + entry.id, err)
      }
    }
  }

  function bindThemeSettings(): void {
    const ctx = hostEl.value?.host?.ctx
    if (!ctx) return
    const store = ctx.get<SettingsStore>('settings')
    const targetOf = (key: string): Record<string, unknown> | undefined =>
      (EDGE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.edge as unknown as Record<string, unknown>)
        : (HANDLE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.handle as unknown as Record<string, unknown>)
          : (DEBUG_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.debug as unknown as Record<string, unknown>)
            : (SNAP_ZONE_SETTING_KEYS as readonly string[]).includes(key) ? (cfg.snapZone as unknown as Record<string, unknown>)
              : undefined
    for (const k of [...EDGE_SETTING_KEYS, ...HANDLE_SETTING_KEYS, ...DEBUG_SETTING_KEYS, ...SNAP_ZONE_SETTING_KEYS]) {
      const v = store.get(k as string)
      const t = targetOf(k as string)
      if (v !== undefined && t) t[k as string] = v
    }
    disposeSettingsBind = store.onChange((key, value) => {
      const t = targetOf(key)
      if (t) t[key] = value
    }).dispose
  }

  /**
   * 订阅设置面板的关闭广播（内核事件 settings:ui-close）。
   *
   * 面板换皮后关闭动作仍走同一条内核事件，所以这里订阅的是**契约**而不是某个具体皮：
   * 渲染层 SettingsShell 统一 emit 它（任何皮都用同一个外壳，所以换皮不改变关闭行为）。
   * 重复调用（宿主重建 / 热重载）先撤旧订阅，避免回调堆积。
   */
  function bindSettingsClose(): void {
    disposeSettingsClose?.()
    disposeSettingsClose = undefined
    const ctx = hostEl.value?.host?.ctx
    if (!ctx) return
    disposeSettingsClose = ctx.on('settings:ui-close', closeSettings).dispose
  }

  async function onReady(): Promise<void> {
    bindThemeSettings()
    bindThemeMode()
    bindSettingsClose()
    bindCanvasToggles()
    bindZoomSync()
    await installExternalPlugins()
    // 外部插件装完（云插件会挂上 gen-history 服务）再拉历史；顺带订阅"有新生成"
    void loadHistory()
    bindHistoryUpdates()
  }

  /**
   * 订阅"后台有了新历史"。
   *
   * 云插件在收到后台的历史信号时会通知订阅者（一条 SSE，不用前端轮询）；
   * 这里收到就重拉当前页 —— 用户刚生成完那张图会立刻出现在历史里。
   * 重复调用（宿主重建 / 热重载）先撤旧订阅，避免回调堆积。
   */
  let disposeHistorySub: (() => void) | undefined
  function bindHistoryUpdates(): void {
    disposeHistorySub?.()
    disposeHistorySub = undefined
    const svc = readyHost?.ctx?.get<{ subscribe(fn: () => void): () => void }>('gen-history')
    if (!svc || typeof svc.subscribe !== 'function') return
    disposeHistorySub = svc.subscribe(() => void loadHistory())
  }

  /** 撤掉历史订阅（宿主销毁时调用） */
  function unbindHistory(): void {
    disposeHistorySub?.()
    disposeHistorySub = undefined
  }

  /**
   * 关闭设置面板：面板经内核事件 settings:ui-close 广播进来（见 bindSettingsClose），
   * 装配层内的其它部件（如顶栏设置按钮）也可以直接调用它。
   */
  function closeSettings(): void {
    state.settingsOpen = false
  }

  /** 撤掉关闭广播订阅（宿主销毁时调用；重复 onReady 时由 bindSettingsClose 内部自动撤）。 */
  function unbindSettingsClose(): void {
    disposeSettingsClose?.()
    disposeSettingsClose = undefined
  }

  /** 撤掉画布开关的设置订阅（宿主销毁时调用，与 unbindSettingsClose 同处） */
  function unbindCanvasToggles(): void {
    disposeCanvasToggleBind?.()
    disposeCanvasToggleBind = undefined
  }

  function createNode(type: 'text' | 'image' | 'video'): void {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    if (!host?.command) {
      // 兜底：从 window key 拿（与 e2e 同源）
      const w = window as unknown as { MiniCanvasUI?: { getHost(): FullHost } }
      const fallback = w.MiniCanvasUI?.getHost()
      if (fallback) { fallback.command.execute('command:create-node', buildPayload(type, fallback)); return }
      return
    }
    host.command.execute('command:create-node', buildPayload(type, host))
  }
  function buildPayload(type: 'text' | 'image' | 'video', host: HostApi): { type: string; position: { x: number; y: number }; imageUrl?: string } {
    const count = host.nodeStore?.getNodes().length ?? 0
    const payload: { type: string; position: { x: number; y: number }; imageUrl?: string } = {
      type,
      position: { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 },
    }
    if (type === 'image') payload.imageUrl = SAMPLE_IMAGE_URL
    return payload
  }

  // ===== 主题 =====
  /**
   * 把主题写到 <html class="dark">（Tailwind v4 / shadcn 通行做法）。
   * 同步保留 data-canvas-theme 属性，兼容仍按属性写的旧样式/外部宿主。
   *
   * 注：权威落值点其实是渲染宿主的 installThemeMode（订阅 settings 的 themeMode），
   * 这里保留同名动作是为了"宿主还没就绪 / 无宿主"时也能立即生效（幂等，重复写无害）。
   */
  function applyTheme(v: 'dark' | 'light'): void {
    if (typeof document === 'undefined') return // Node 单测环境无 DOM：跳过副作用（设置仍照常写入）
    document.documentElement.classList.toggle('dark', v === 'dark')
    document.documentElement.dataset.canvasTheme = v
  }
  /**
   * 订阅主题模式（渲染层配置 themeMode）→ 同步到本地镜像值。
   *
   * 唯一事实来源是内核设置；按钮与设置面板都写同一处，所以"面板里切了、按钮状态也跟着变"。
   * 与 bindCanvasToggles 同款：重复 onReady 先撤旧订阅，避免回调堆积。
   */
  let disposeThemeModeBind: (() => void) | undefined
  function bindThemeMode(): void {
    disposeThemeModeBind?.()
    disposeThemeModeBind = undefined
    const store = hostCtx()?.get<SettingsStore>('settings')
    if (!store) return
    const cur = store.get('themeMode')
    if (cur === 'dark' || cur === 'light') state.theme = cur
    disposeThemeModeBind = store.onChange((key, value) => {
      if (key === 'themeMode' && (value === 'dark' || value === 'light')) state.theme = value
    }).dispose
  }
  /** 撤掉主题模式订阅（宿主销毁时调用） */
  function unbindThemeMode(): void {
    disposeThemeModeBind?.()
    disposeThemeModeBind = undefined
  }
  function toggleTheme(): void {
    const next = state.theme === 'dark' ? 'light' : 'dark'
    state.theme = next
    // 写内核设置（= 持久化 + 落 DOM 的唯一通道）。宿主没就绪/没声明该键时 writeSetting 是 no-op，
    // 此时下面的 applyTheme 兜底，保证按钮永远点得动。
    writeSetting('themeMode', next)
    applyTheme(next)
    showToast(next === 'dark' ? '已切换暗色主题' : '已切换亮色主题')
  }
  function openDrawer(which: 'left' | 'roles'): void {
    state.drawer = state.drawer === which ? null : which
  }
  /** 开面板前先重读一次注册表（插件热装/热卸后开面板即见最新键位） */
  function toggleShortcuts(): void {
    if (!state.shortcutsOpen) refreshShortcuts()
    state.shortcutsOpen = !state.shortcutsOpen
  }
  /** 开关历史弹窗：打开时重拉一页（后台那边可能已经有新的了） */
  function toggleHistory(): void {
    state.historyOpen = !state.historyOpen
    if (state.historyOpen) void loadHistory()
  }
  function toggleLeftCollapsed(): void {
    state.leftCollapsed = !state.leftCollapsed
    if (state.leftCollapsed) {
      state.drawer = null
      showToast('已收起节点侧栏')
    } else {
      state.leftTab = 'canvas'
      state.drawer = 'left'
      showToast('已展开节点侧栏')
    }
  }
  function renameNode(id: string, current: string): void {
    const next = window.prompt('重命名节点', current)
    if (next === null || !next.trim()) return
    const walk = (list: TreeNode[]): boolean => {
      for (const n of list) {
        if (n.id === id) { n.name = next.trim(); return true }
        if (n.children && walk(n.children)) return true
      }
      return false
    }
    walk(tree)
  }
  function sendChat(): void {
    const text = state.chatInput.trim()
    if (!text) return
    state.chatMessages.push({ role: 'user', text })
    state.chatInput = ''
    window.setTimeout(() => {
      state.chatMessages.push({ role: 'ai', text: '（演示数据）已收到你的指令，正在按当前画布节点生成结果。' })
    }, 400)
  }
  function renameChat(index: number): void {
    const cur = state.chatHistories[index]?.title ?? ''
    const next = window.prompt('重命名对话', cur)
    if (next === null || !next.trim()) return
    state.chatHistories[index].title = next.trim()
    showToast('已重命名')
  }
  function closeMenus(): void {
    state.canvasMenuOpen = false
    state.addMenuOpen = false
    state.filterTypeOpen = false
    state.filterRatingOpen = false
  }

  // ===== 面板拖拽（宽度 / 位置）=====
  let chatDragStart = { x: 0, y: 0, left: 0, top: 0 }
  let chatEl: HTMLElement | null = null
  function onChatDrag(e: PointerEvent): void {
    const w = chatEl?.offsetWidth ?? 400
    const h = chatEl?.offsetHeight ?? 640
    // 面板完整可见（四周留 4px），拖不出去
    state.chatPos = {
      x: Math.min(window.innerWidth - w - 4, Math.max(4, chatDragStart.left + (e.clientX - chatDragStart.x))),
      y: Math.min(window.innerHeight - h - 4, Math.max(4, chatDragStart.top + (e.clientY - chatDragStart.y))),
    }
  }
  function stopChatDrag(): void {
    window.removeEventListener('pointermove', onChatDrag)
    window.removeEventListener('pointerup', stopChatDrag)
  }
  function startChatDrag(e: PointerEvent): void {
    if (state.chatDocked) return
    const el = (e.currentTarget as HTMLElement).closest('.chat-panel') as HTMLElement | null
    if (!el || (e.target as HTMLElement).closest('button')) return
    chatEl = el
    const r = el.getBoundingClientRect()
    chatDragStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top }
    window.addEventListener('pointermove', onChatDrag)
    window.addEventListener('pointerup', stopChatDrag)
    e.preventDefault()
  }
  // 通用宽度拖拽（抽屉 / 停靠面板）
  function startWidthDrag(e: PointerEvent, opts: { fromRight?: boolean; min: number; max: () => number; target: 'drawer' | 'chat' }): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = opts.target === 'drawer' ? state.drawerWidth : state.chatWidth
    const onMove = (ev: PointerEvent): void => {
      const delta = opts.fromRight ? startX - ev.clientX : ev.clientX - startX
      const w = Math.min(opts.max(), Math.max(opts.min, startW + delta))
      if (opts.target === 'drawer') state.drawerWidth = w
      else state.chatWidth = w
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }
  const startDrawerResize = (e: PointerEvent): void =>
    startWidthDrag(e, { min: 240, max: () => Math.round(window.innerWidth * 0.4), target: 'drawer' })
  const startChatResize = (e: PointerEvent): void =>
    startWidthDrag(e, { fromRight: true, min: 360, max: () => Math.round(window.innerWidth * 0.55), target: 'chat' })
  /** 浮窗右下角自由缩放（宽高一起拖，夹在最小值与视口之间） */
  function startChatCornerResize(e: PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = state.chatWidth
    const startH = state.chatHeight
    // 首次 resize：把「bottom 锚定」转成「top 锚定」，之后宽高以左上角为基准向右下生长
    const panel = document.querySelector('.chat-panel') as HTMLElement | null
    const pr = panel?.getBoundingClientRect()
    const startLeft = pr?.left ?? 0
    const startTop = pr?.top ?? 0
    if (panel && !state.chatPos) {
      state.chatPos = { x: startLeft, y: startTop }
    }
    const onMove = (ev: PointerEvent): void => {
      // 右下角手柄：往左上拖 = 缩小，往右下拖 = 放大
      // 右缘/下缘都不许越过视口（留 8px 边距），且不小于最小值
      const maxW = Math.max(state.chatMinW, window.innerWidth - 8 - startLeft)
      const maxH = Math.max(state.chatMinH, window.innerHeight - 8 - startTop)
      state.chatWidth = Math.min(maxW, Math.max(state.chatMinW, startW + (ev.clientX - startX)))
      state.chatHeight = Math.min(maxH, Math.max(state.chatMinH, startH + (ev.clientY - startY)))
      // 下缘不许出屏：空间不足以放下最小高度时，把面板整体上移，保证 bottom ≤ 视口-8
      if (state.chatPos) {
        const maxY = window.innerHeight - 8 - state.chatHeight
        if (state.chatPos.y > maxY) state.chatPos = { ...state.chatPos, y: Math.max(4, maxY) }
      }
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }

  return {
    state, cfg, tree, filteredTree, collapsed, treeTotal, histVisible, histCount, shortcuts,
    minimapOn, toggleMinimap,
    agent, setAgentOpen, toggleAgent, newAgentChat, toggleAgentHistory,
    openAgentSession, renameAgentSession, deleteAgentSession,
    toggleEdges, toggleSnap, organizeCanvas, setCanvasMode, unbindCanvasToggles,
    unbindThemeMode,
    syncZoomDisplay, zoomInStep, zoomOutStep, zoomToPercent, zoomToMax, zoomFit, unbindZoomSync,
    loadHistory, unbindHistory,
    hostEl, setHostEl, showToast, onReady, createNode, toggleTheme, applyTheme, openDrawer, closeSettings,
    unbindSettingsClose,
    toggleShortcuts, refreshShortcuts, toggleHistory, toggleLeftCollapsed, renameNode, sendChat,
    renameChat, closeMenus, startChatDrag, startDrawerResize, startChatResize, startChatCornerResize,
  }
}

type Ui = ReturnType<typeof createUi>
let inst: Ui | undefined
/** 共享单例：所有区域组件拿同一个状态对象 */
export function useUi(): Ui {
  inst ??= createUi()
  return inst
}
