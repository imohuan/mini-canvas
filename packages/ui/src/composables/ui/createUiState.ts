import { reactive } from 'vue'
import {
  DEFAULT_THEME_EDGE, DEFAULT_THEME_HANDLE, DEFAULT_THEME_DEBUG, DEFAULT_THEME_SNAP_ZONE,
} from '@mini-canvas/plugin-theme-default'
import { DRAWER_TAB_CANVAS } from '../drawerTabs'

export function createUiState() {
  const cfg = reactive({
    edge: { ...DEFAULT_THEME_EDGE },
    handle: { ...DEFAULT_THEME_HANDLE },
    debug: { ...DEFAULT_THEME_DEBUG },
    snapZone: { ...DEFAULT_THEME_SNAP_ZONE },
  })

  const state = reactive({
    // 主题配置的镜像（debug 等）：外壳组件（底栏/状态条/抽屉）读它决定是否显示插槽调试
    cfg,
    // 主题 / 视图
    theme: 'dark' as 'dark' | 'light',
    navMode: 'workflow' as 'workflow' | 'storyboard',
    settingsOpen: false,
    // 顶部
    canvasMenuOpen: false,
    /** 工作区（项目）名称：与画布名分开 —— 就是一个可编辑的项目名，画布列表另算 */
    projectName: '未命名工作区',
    canvasList: ['画布 1', '画布 2', '画布 3'],
    currentCanvas: '画布 1',
    // 弹窗开合（快捷键 / 生成历史独立，可与抽屉共存）
    shortcutsOpen: false,
    historyOpen: false,
    drawer: null as 'left' | 'roles' | null,
    drawerWidth: 320,
    leftCollapsed: false,
    // 放开成 string：插件页签会追加第三个及之后的 id（canvas/assets 仍由内置页签占用）。
    leftTab: DRAWER_TAB_CANVAS as string,
    filterTypeOpen: false,
    filterRatingOpen: false,
    filterType: '全部',
    filterRating: '所有评级',
    // 画布 tab 搜索：点放大镜进入搜索态（工具行变成 输入框+筛选+关闭），再点 × 或 Esc 退出
    searchOpen: false,
    searchQuery: '',
    // 资产 tab：搜索关键字与类型筛选（「全部 / 图片 / 视频 / 音频 / 其他」；空 = 不筛）
    assetSearchQuery: '',
    assetFilterKind: '全部' as '全部' | '图片' | '视频' | '音频' | '其他',
    // 资产 tab：批量选择模式（开关 + 已选 id 集合，转数组用）
    assetBatchOn: false,
    assetSelectedIds: [] as string[],
    /**
     * 批量勾选的**起点**：Shift 区间从这一项算起（判定见 composables/assetSelection.ts）。
     * 普通点击会把它换成刚点的那一项；Shift 点击不动它 —— 这样按住 Shift 连点几下
     * 都是在同一段里增减（用户口径 2026-10-13：「根据你最后一次选择的一项，按 Shift 会选择该区间」）。
     */
    assetSelectAnchorId: null as string | null,
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
    // 「浏览器通知 / 通知声音」已改读后台 KV（config/agentNotify，见 composables/agentSettings.ts），
    // 不再在这里留一份 —— 两处各存一份就是漂移。collab/budget 仍是本地 UI 状态。
    director: { collab: true, budget: false, budgetLimit: 1000 },
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
    // 进页面默认「图片」页签（用户口径：进来先看图片）
    histType: '图片',
    histRating: '所有评级',
    histRatingOpen: false,
    histSortDesc: true,
    histZoom: 3,
    /**
     * 生成历史 —— **数据来自后台**（cloud-client:history 服务），不是写死的假数组。
     * 由 loadHistory() 拉取并填充；历史弹窗只负责渲染。
     */
    historyItems: [] as Array<{
      id: string
      title: string
      time: string
      kind: string
      urls?: string[]
      canvasId?: string
      nodeId?: string
      /** 提示词 / 参数 / 参考素材 / 媒体元数据：详情弹窗与卡片角标用 */
      prompt?: string
      values?: Record<string, unknown>
      resources?: Array<{ kind: string; url?: string; value?: string }>
      media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
      /** 生成完成的时间戳（详情弹窗显示精确时间；卡片显示"多久前"） */
      finishedAt?: number
      /** 失败原因（详情弹窗直接给出，不用再猜） */
      error?: string
    }>,
    /** 汇总：一共生成过多少（按类型分）—— 喂给历史弹窗上的计数徽章 */
    historySummary: { total: 0, byKind: {} as Record<string, number> },
    /** 是否拿到了后台历史（没连后台时为 false，弹窗给一句说明而不是空转） */
    historyReady: false,
    /** 历史分页 */
    histPage: 1,
    histPageSize: 20,
    histTotal: 0,
    /** 历史是否还有下一页（滚到底部时给"加载中"或停止追加的依据） */
    histHasMore: false,
    /** 正在拉下一页（防触底重复请求） */
    histLoadingMore: false,
    /** 第 1 页 / 按缓存回填是否在途：此期间的补页请求排队，不丢 */
    histLoadingFirst: false,
    /** 正在按缓存回填多页：卡片墙要等全部页落地后一次重建（中途 append 会空转） */
    histRestoring: false,
    /** 最近一次落表的更新方式：prepend（只插新卡）/ append（接上下一页）/ rebuild（整表换血）/ none */
    histUpdateMode: 'rebuild' as 'rebuild' | 'append' | 'prepend' | 'none',
    /** 这次更新带了多少条（prepend/append 时是新增卡数） */
    histUpdateCount: 0,
    /** 加载条起始时刻（毫秒时间戳；0 = 没在显示） */
    histLoadingShownAt: 0,
    /** 加载更多条是否可见（首屏第 1 页不显示） */
    histLoadingMoreVisible: false,
    /**
     * 数据版本号：每次 loadHistory 成功自增。历史弹窗靠「版本变了」而不是「长度变了」
     * 感知数据更新 —— 翻页/筛选后长度可能恰好相同（都是满页 20 条），长度 watch 会漏触发，
     * 瀑布流就还挂着旧筛选的卡片（用户看到的"切到图片显示音频"）。
     */
    histDataVersion: 0,
    /** 当前 historyItems 属于哪一组筛选条件（切页签后由 loadHistory 更新） */
    histSignature: '',
    /** 显示异常记录开关（无产物的那批）：默认关 —— 开关只在真的有异常记录时显示（弹窗按 summary 判断） */
    histShowError: false,
    /** 批量操作模式：进入后卡片出现勾选框，底部出操作栏 */
    histBatchMode: false,
    /** 批量选中的历史 id */
    histSelectedIds: [] as string[],
  })
  return { cfg, state }
}

export type UiState = ReturnType<typeof createUiState>['state']
export type UiConfig = ReturnType<typeof createUiState>['cfg']

