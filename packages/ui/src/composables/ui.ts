// useUi —— 画布外壳的共享 UI 状态（单例）。
// 所有区域组件从这里读写状态，避免 App.vue 承担几十个 prop 的透传。
// 只有纯 UI / 虚拟数据；画布本体仍由 CanvasHost 负责。
import { computed, reactive, ref } from 'vue'
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
/** CanvasHost @ready 传出的宿主句柄（存进单例，供小地图等直接读 ctx） */
let readyHost: HostApi | undefined
export function setReadyHost(h: unknown): void {
  readyHost = h as HostApi | undefined
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
    zoom: 39,
    zoomMenuOpen: false,
    /** 隐藏节点连线 / 网格吸附：可切换，关闭时图标画斜线（照目标） */
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
    historyItems: [
      { title: '正派长辈/母 角色立绘', time: '2 分钟前', kind: '图片' },
      { title: '正派长辈/母 脸部近景', time: '18 分钟前', kind: '图片' },
      { title: '25宫格连贯分镜', time: '1 小时前', kind: '图片' },
      { title: '智能剪辑 5', time: '昨天 21:40', kind: '视频' },
      { title: '720°全景图', time: '昨天 19:02', kind: '图片' },
    ] as Array<{ title: string; time: string; kind: string }>,
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
  const histVisible = computed(() =>
    state.histType ? state.historyItems.filter((i) => i.kind === state.histType) : state.historyItems,
  )
  const histCount = (kind: string): number => state.historyItems.filter((i) => i.kind === kind).length

  // ===== 小地图显隐（唯一事实来源 = mini-map 插件服务；状态栏按钮只是它的开关） =====
  // host ctx.get('mini-map') 每次返回同一个 reactive 对象（插件 apply 里注入的），
  // computed 追踪 .visible 属性即可实时反映开关状态。
  const minimapOn = computed(() => (readyHost?.ctx?.get<{ visible: boolean }>('mini-map')?.visible) ?? false)
  function toggleMinimap(): void {
    const svc = readyHost?.ctx?.get<{ visible: boolean }>('mini-map')
    if (svc) svc.visible = !svc.visible
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
        const conf = cloudBase && entry.id.includes('cloud-save') ? { cloudSaveBaseUrl: cloudBase } : undefined
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

  async function onReady(): Promise<void> {
    bindThemeSettings()
    await installExternalPlugins()
  }

  /**
   * 设置面板关闭：由面板自身直接调用，不依赖内核事件订阅。
   *
   * 为什么不让面板 ctx.emit('settings:ui-close')：宿主侧的 ctx 订阅挂在 CanvasHost 的 ref 上，
   * 该 ref 在本装配层下可能拿不到（与 createNode 同源问题），订阅没建起来 → 关闭静默失效。
   * 单例状态直连最稳，也少一条隐式通道。
   */
  function closeSettings(): void {
    state.settingsOpen = false
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
  /** 把主题写到 <html class="dark">（Tailwind v4 / shadcn 通行做法）。
      同步保留 data-canvas-theme 属性，兼容仍按属性写的旧样式/外部宿主。 */
  function applyTheme(v: 'dark' | 'light'): void {
    document.documentElement.classList.toggle('dark', v === 'dark')
    document.documentElement.dataset.canvasTheme = v
  }
  function toggleTheme(): void {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'
    applyTheme(state.theme)
    showToast(state.theme === 'dark' ? '已切换暗色主题' : '已切换亮色主题')
  }
  function openDrawer(which: 'left' | 'roles'): void {
    state.drawer = state.drawer === which ? null : which
  }
  /** 开面板前先重读一次注册表（插件热装/热卸后开面板即见最新键位） */
  function toggleShortcuts(): void {
    if (!state.shortcutsOpen) refreshShortcuts()
    state.shortcutsOpen = !state.shortcutsOpen
  }
  function toggleHistory(): void { state.historyOpen = !state.historyOpen }
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
    hostEl, setHostEl, showToast, onReady, createNode, toggleTheme, applyTheme, openDrawer, closeSettings,
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
