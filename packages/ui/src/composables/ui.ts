// useUi —— 画布外壳的共享 UI 状态（单例）。
// 所有区域组件从这里读写状态，避免 App.vue 承担几十个 prop 的透传。
// 只有纯 UI / 虚拟数据；画布本体仍由 CanvasHost 负责。
import { computed, nextTick, reactive, ref, shallowRef, watch } from 'vue'
import type { SettingsStore } from '@mini-canvas/kernel'
import {
  DEFAULT_THEME_EDGE, DEFAULT_THEME_HANDLE, DEFAULT_THEME_DEBUG, DEFAULT_THEME_SNAP_ZONE,
  EDGE_SETTING_KEYS, HANDLE_SETTING_KEYS, DEBUG_SETTING_KEYS, SNAP_ZONE_SETTING_KEYS,
} from '@mini-canvas/plugin-theme-default'
import { createV2Logger, setUiCatalogHost } from '@mini-canvas/canvas-render'
import { buildV2HelpList, groupV2HelpList, keyPartsToLabels } from '@mini-canvas/plugin-shortcut-manager'
import { SAMPLE_IMAGE_URL } from '../assembly'
import { buildCanvasTree, filterTree } from './canvasTree'
import { listCanvases as apiListCanvases, createCanvas as apiCreateCanvas, duplicateCanvas as apiDuplicateCanvas, deleteCanvas as apiDeleteCanvas, listAssets as apiListAssets, uploadAsset as apiUploadAsset, deleteAsset as apiDeleteAsset, renameAsset as apiRenameAsset, renameCanvas as apiRenameCanvas, renameProject as apiRenameProject, listAssetFolders as apiListAssetFolders, createAssetFolder as apiCreateAssetFolder, renameAssetFolder as apiRenameAssetFolder, moveAssetFolder as apiMoveAssetFolder, setAssetFolderIcon as apiSetAssetFolderIcon, deleteAssetFolder as apiDeleteAssetFolder, moveAssets as apiMoveAssets, setAssetTags as apiSetAssetTags, type CanvasSummary, type AssetFolderSummary } from './projectsApi'
import { toAssetItems, assetKindOf, type AssetItem } from './assetModel'
import { applyRowClick } from './assetSelection'
import { registerPendingSave, unregisterPendingSave } from './pendingSave'
import { importPack, isNodePackFile, resolvePackBase, VERSION_SEP } from './nodePack'
import { uniqueLabel } from './nodeLabel'

const log = createV2Logger('config')

interface HostApi {
  ctx?: {
    get<T>(key: string): T
    on(evt: string, cb: () => void): { dispose(): void }
    /** 运行时是完整内核 Context：树外读 ui 目录用（类型窄声明即可） */
    registryOf?<T>(name: string): { top(key: string): { value: T } | undefined }
  }
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

/**
 * 按名取 ui 目录里登记的组件（画布树外也能用 —— 走宿主 ready ctx）。
 * 树外区域（生成历史弹窗等）没有 useCanvasRender 的 provide，取不到渲染上下文；
 * 宿主 ctx 就绪后从 registryOf('ui') 读一份即可。没就绪/没登记 → undefined。
 */
export function uiComponentOf(name: string): unknown {
  return readyHost?.ctx?.registryOf?.<unknown>('ui')?.top(name)?.value
}
export function setReadyHost(h: unknown): void {
  hostRef.value = h as HostApi | undefined
  // 同步给 canvas-render 的“树外取件”入口：MediaViewer（plugin-theme-default）在画布树外
  // （资产抽屉 / 生成历史弹窗）也要能按名取注册件 —— 主题包不能反向依赖 ui 包，
  // 所以由宿主侧在就绪时注入，见 canvas-render/contracts/uiCatalog.ts。
  void setUiCatalogHost(readyHost?.ctx as never)
}
/** CanvasHost 暴露的完整宿主（与 window.MiniCanvasUI.getHost() 同源） */
type FullHost = HostApi & { command: { execute(id: string, payload?: unknown): void }; nodeStore: { getNodes(): unknown[] } }
interface ManagerApi { install(opts: { url: string }, cfg?: { config?: unknown }): Promise<void> }
interface HostLike { host?: HostApi; manager?: ManagerApi }

export interface TreeNode {
  id: string
  name: string
  meta: string
  icon: 'group' | 'image' | 'video' | 'audio' | 'text'
  children?: TreeNode[]
  /** 画布坐标（点击节点居中显示用；由 canvasTree.buildCanvasTree 从节点 position 带来） */
  x?: number
  y?: number
  /** 缩略图地址（图片/视频节点；由 canvasTree 从 data 里取，抽屉里直接当 <img> 用） */
  thumb?: string
  /** 视频节点的播放地址（缩略图用 <video> 显示首帧；由 canvasTree.nodeVideoUrl 带来）。
   *  与 thumb 分开：thumb 只认图（mp4 塞 <img> 必裂），视频没有海报时靠这个字段出首帧。 */
  video?: string
}

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
    leftTab: 'canvas' as 'canvas' | 'assets',
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
     * 生成历史 —— **数据来自后台**（gen-history 服务），不是写死的假数组。
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
    /**
     * 数据版本号：每次 loadHistory 成功自增。历史弹窗靠「版本变了」而不是「长度变了」
     * 感知数据更新 —— 翻页/筛选后长度可能恰好相同（都是满页 20 条），长度 watch 会漏触发，
     * 瀑布流就还挂着旧筛选的卡片（用户看到的"切到图片显示音频"）。
     */
    histDataVersion: 0,
    /** 显示异常记录开关（无产物的那批）：默认关 —— 开关只在真的有异常记录时显示（弹窗按 summary 判断） */
    histShowError: false,
    /** 批量操作模式：进入后卡片出现勾选框，底部出操作栏 */
    histBatchMode: false,
    /** 批量选中的历史 id */
    histSelectedIds: [] as string[],
  })

  // ===== 左侧树（**真实画布数据**）=====
  // 以前这里是写死的假数组；现在跟着画布实时画（doc.subscribe → buildCanvasTree）。
  // 名字全部来自节点自身（见 canvasTree.ts）；空画布就是空树，不塞假节点。
  const tree = reactive<TreeNode[]>([])
  const collapsed = reactive<Record<string, boolean>>({})
  let disposeTreeBind: (() => void) | undefined

  /** doc 服务的**最小用面**（读节点 + 订阅变化；5c 后 nodeStore 不再是服务名，读走 doc） */
  type DocTreeLike = { getNodes(): unknown[]; subscribe(cb: () => void): () => void }
  const docSvc = (): DocTreeLike | undefined => hostCtx()?.get<DocTreeLike>('doc')

  /** 从画布数据重建抽屉树（原地替换内容，绑定不换对象、不闪） */
  function refreshCanvasTree(): void {
    const built = buildCanvasTree((docSvc()?.getNodes?.() ?? []) as never)
    tree.splice(0, tree.length, ...built)
  }
  /** 订阅画布变化（增删改节点都自动重画左侧树）；重复 onReady 先撤旧订阅 */
  function bindCanvasTree(): void {
    disposeTreeBind?.()
    disposeTreeBind = undefined
    refreshCanvasTree()
    disposeTreeBind = docSvc()?.subscribe(() => refreshCanvasTree())
  }
  /** 撤掉画布树订阅（宿主销毁时调用） */
  function unbindCanvasTree(): void {
    disposeTreeBind?.()
    disposeTreeBind = undefined
  }

  // ===== 当前画布 / 项目的画布列表（多画布）=====
  // 数据来自 cloud-server 的 `/api/projects/:id/canvases`；当前画布 id 从 URL 的
  // `#/canvas/<id>` 读（与 cloud-client 的 canvasId() 同一口径）。切画布 = 换 hash → Root 重新挂载。
  /** 从当前 URL 读画布 id（#/canvas/<id> 或 ?canvas=<id>），取不到回落 default */
  function canvasIdFromUrl(): string {
    if (typeof window === 'undefined') return 'default'
    const m = /\/canvas\/([A-Za-z0-9_-]{1,64})/.exec(window.location.hash)
    if (m) return m[1]
    const q = new URLSearchParams(window.location.search).get('canvas')
    return q && /^[A-Za-z0-9_-]{1,64}$/.test(q) ? q : 'default'
  }
  const currentCanvasId = ref('default')
  /** 当前项目的画布清单（下拉用）；名字来自后端索引 */
  const canvasListItems = ref<CanvasSummary[]>([])
  /** 读当前画布在清单里的名字（拿不到回落 id） */
  function canvasNameOf(id: string): string {
    return canvasOptions.value.find((c) => c.id === id)?.label ?? '画布'
  }
  /**
   * 画布下拉的选项：把「没有真名字」的画布（如内置的 `default`、手工丢进来的目录）
   * 显示成「画布 N」（按清单顺序）—— 用户口径：要么显示「画布1」，要么显示自定义名，
   * 不该把内部 id（default / 一串哈希）露给用户。
   */
  const canvasOptions = computed<Array<{ id: string; label: string }>>(() =>
    canvasListItems.value.map((c, i) => {
      const hasName = typeof c.name === 'string' && c.name && c.name !== c.id
      return { id: c.id, label: hasName ? c.name : '画布 ' + (i + 1) }
    }),
  )
  /** 拉当前项目的画布清单（项目 id 从「含当前画布的那一项」反查；独立画布回落 default） */
  async function refreshCanvasList(): Promise<void> {
    try {
      const all = await apiListCanvases('default').catch(() => [] as CanvasSummary[])
      // default 项目未必含当前画布 —— 再尝试从项目清单里找。简单起见：先放 default 的，
      // 若当前画布不在其中，用一个「查询全部项目」的兜底：遍历项目很少（通常个位数）。
      let list = all
      if (!list.some((c) => c.id === currentCanvasId.value)) {
        const projects = await listProjectsLoose()
        for (const p of projects) {
          const cs = await apiListCanvases(p.id).catch(() => [] as CanvasSummary[])
          if (cs.some((c) => c.id === currentCanvasId.value)) { list = cs; break }
        }
      }
      canvasListItems.value = list
    } catch {
      canvasListItems.value = []
    }
  }
  async function listProjectsLoose(): Promise<Array<{ id: string }>> {
    try {
      const res = await fetch('/api/projects')
      const body = (await res.json()) as { projects?: Array<{ id: string }> }
      return body.projects ?? []
    } catch {
      return []
    }
  }
  /** 切到另一张画布：换 hash → Root 按 key 重新挂载画布 */
  async function openCanvas(id: string): Promise<void> {
    if (typeof window === 'undefined' || id === currentCanvasId.value) return
    // ★ 换画布之前**先把当前这张落盘**（await 到真正写完）——否则切走时那次保存还在半路上，
    //   旧画布的改动就丢了（用户实测：切了画布回来发现改动没了）。
    await flushCanvasSave()
    window.location.hash = '#/canvas/' + id
  }

  /**
   * 把当前画布的脏改动**真正写完**（await 到存储层返回）。
   * 离开画布（切画布 / 回项目页）前调用它，保证不丢最后一次编辑。
   */
  async function flushCanvasSave(): Promise<void> {
    try {
      const save = hostCtx()?.get<{ flush?(): Promise<void> }>('save')
      await save?.flush?.()
    } catch (err) {
      console.warn('[ui] 保存画布失败', err)
    }
  }
  // 注册给路由守卫：离开画布前先 await 落盘（切画布丢改动的根治点）
  registerPendingSave(flushCanvasSave)
  function releasePendingSave(): void {
    unregisterPendingSave(flushCanvasSave)
  }
  /** 在当前项目下新建一张画布，并切过去 */
  async function newCanvas(): Promise<void> {
    const pid = canvasListItems.value.find((c) => c.id === currentCanvasId.value)?.projectId
      ?? canvasListItems.value[0]?.projectId
      ?? 'default'
    try {
      const made = await apiCreateCanvas(pid, '画布 ' + (canvasListItems.value.length + 1))
      openCanvas(made.id)
    } catch (err) {
      console.warn('[ui] 新建画布失败', err)
    }
  }

  /**
   * 改**当前画布**的名字（左上角那个可编辑名字；双击改名后调它）。
   * 写回 `/api/canvases/:id/meta`（后端同时更新索引与 canvas.json 的 name），再刷新下拉清单。
   */
  async function renameCanvas(name: string): Promise<void> {
    const next = name.trim()
    const id = currentCanvasId.value
    if (!next) return
    try {
      await apiRenameCanvas(id, next)
      // 本地先改，界面立刻跟上（随后 refreshCanvasList 会用后端真值覆盖）
      const item = canvasListItems.value.find((c) => c.id === id)
      if (item) item.name = next
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 改画布名失败', err)
    }
  }

  /** 当前画布所属的项目 id（独立画布回落 default） */
  function currentProjectId(): string {
    return (
      canvasListItems.value.find((c) => c.id === currentCanvasId.value)?.projectId ??
      canvasListItems.value[0]?.projectId ??
      'default'
    )
  }

  // ===== 画布列表行的操作菜单（用户口径 2026-10-09）=====
  // 「在新窗口打开 / 重命名画布 / 复制画布 / 删除画布」四件事的实现都收在这里：
  // 组件只发事件（它不知道数据在哪），落盘/请求/导航全在宿主这一层。

  /**
   * 在新窗口打开某张画布：走 `#/canvas/<id>` 的新标签页。
   *
   * 为什么要先把当前画布写完：新标签页会读同一份后端数据，但**当前这张**的脏改动
   * 可能还在防抖队列里；此时另开一个页面读到的就是旧数据，看起来像「新窗口没带我的改动」。
   */
  async function openCanvasInNewWindow(id: string): Promise<void> {
    if (typeof window === 'undefined') return
    await flushCanvasSave()
    const base = window.location.href.split('#')[0]
    window.open(base + '#/canvas/' + id, '_blank', 'noopener')
  }

  /**
   * 重命名**指定**画布（列表行菜单用）。
   *
   * 名字从哪来：`window.prompt` 与「项目页新建项目 / 改名」同一种口径，不另造一套弹窗组件。
   * 改的不是当前画布时，改完只要刷新列表；改的正是当前这张，界面上的名字框靠 computed 自己跟上。
   */
  async function renameCanvasById(id: string): Promise<void> {
    if (typeof window === 'undefined') return
    const cur = canvasOptions.value.find((c) => c.id === id)?.label ?? ''
    const input = window.prompt('重命名画布', cur)
    if (input === null) return
    const next = input.trim()
    if (!next || next === cur) return
    try {
      await apiRenameCanvas(id, next)
      const item = canvasListItems.value.find((c) => c.id === id)
      if (item) item.name = next
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 改画布名失败', err)
    }
  }

  /**
   * 复制一张画布（节点 / 边 / 资源 / 历史一起；**视口不带走** —— 复制内容不复制「我当时看到哪儿」）。
   * 复制完刷新列表，副本就出现在下拉里（不自动切过去：用户多半是拿它做另一版，不是当场改它）。
   */
  async function duplicateCanvas(id: string): Promise<void> {
    try {
      await apiDuplicateCanvas(id)
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 复制画布失败', err)
    }
  }

  /**
   * 删掉一张画布（连带文件夹与资源）。
   *
   * 用户口径（2026-10-09）：「不管是哪个画布都支持删除，即使是当前选中的也支持删除。
   * 只不过你删除之后，跳转到第一个画布就行了呀」。所以**没有例外**：内置画布也删，
   * 当前正在看的也删；删完跳到剩下清单里的第一张。
   *
   * 两条必须保留的收尾（否则会白屏）:
   * ① 删的正是当前这张时，先把脏改动落盘让路，再删、再导航 —— 删完还停在已不存在的 hash 上就白屏了；
   * ② 删空了（一张不剩）时**补建一张空画布**再跳过去 —— 没画布可跳同样白屏，而且用户回到下拉里
   *    必须还能看见至少一张。
   */
  async function deleteCanvas(id: string): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm('删除画布「' + (canvasNameOf(id)) + '」及其全部内容？')) return
    const wasCurrent = id === currentCanvasId.value
    try {
      if (wasCurrent) await flushCanvasSave()
      await apiDeleteCanvas(id)
      if (wasCurrent) {
        // 跳到剩下清单里的第一张；一张不剩就现建一张（删空了也得有画布可看）
        const next = canvasListItems.value.find((c) => c.id !== id)
        if (next) {
          // openCanvas 会先 flush + 换 hash；此处 next 一定与当前 id 不同，能真正导航
          await openCanvas(next.id)
          await refreshCanvasList()
          return
        }
        await newCanvas()
        return
      }
      await refreshCanvasList()
    } catch (err) {
      console.warn('[ui] 删除画布失败', err)
    }
  }

  /** 读项目名 → 工作区名（用户口径：工作区名就是这个项目文件夹的名字） */
  async function loadProjectName(): Promise<void> {
    try {
      const res = await fetch('/api/projects')
      const body = (await res.json()) as { projects?: Array<{ id: string; name: string }> }
      const pid = currentProjectId()
      const p = body.projects?.find((x) => x.id === pid)
      if (p?.name) state.projectName = p.name
    } catch {
      /* 拿不到就保持默认名 */
    }
  }
  /** 改工作区名 → 写回后端项目名（用户口径：工作区命名 = 项目文件夹名） */
  async function renameProject(name: string): Promise<void> {
    const next = name.trim()
    if (!next) return
    try {
      await apiRenameProject(currentProjectId(), next)
      state.projectName = next
    } catch (err) {
      console.warn('[ui] 改工作区名失败', err)
    }
  }
  function nodeCount(nodes: TreeNode[]): number {
    return nodes.reduce((sum, n) => sum + 1 + (n.children ? nodeCount(n.children) : 0), 0)
  }
  const treeTotal = computed(() => nodeCount(tree))
  // 搜索 + 类型过滤视图（纯函数在 canvasTree.filterTree）：关键字匹配名字、类型按 图片/视频/文本/分组
  // 过滤；分组在有子节点留下时保留并展开。这里只负责把结果接上折叠状态。
  const filteredTree = computed<TreeNode[]>(() => {
    const { nodes, expandIds } = filterTree(tree, { query: state.searchQuery, type: state.filterType })
    for (const id of expandIds) collapsed[id] = false
    return nodes
  })
  // 历史：筛选与排序在**后台**做（那里有全量账本），这里只负责把结果拿出来渲染。
  // 所以 histVisible 不再本地过滤 —— 后台已经把当前页筛好了。
  /**
   * 历史可见条目：异常开关关闭时滤掉"无产物"的记录（用户口径：异常卡默认不出现，
   * 打开"显示异常"开关才看得到）。开关开着或批量模式里全部可见（选择/删除异常也合理）。
   */
  const histVisible = computed(() =>
    state.histShowError ? state.historyItems : state.historyItems.filter((e) => (e.urls?.length ?? 0) > 0),
  )
  /** 当前页里有多少条异常（弹窗按它决定"显示异常"开关显不显示） */
  const histErrorCount = computed(() => state.historyItems.filter((e) => !e.urls || e.urls.length === 0).length)
  /** 历史弹窗上那些中文标签 ↔ 后台的英文值（显示层的事，写在显示层） */
  const HIST_KIND: Record<string, string> = { 图片: 'image', 视频: 'video', 音频: 'audio' }
  /**
   * 计数徽章：用后台的汇总（不是本地数当前页）。
   *
   * 后台的 byKind 键是**英文**（image / video / audio），而徽章上的标签是中文 —— 必须转一道，
   * 否则 `byKind['图片']` 永远是 undefined，三个计数全显示 0（用户报的就是这个）。
   */
  const histCount = (kind: string): number => state.historySummary.byKind[HIST_KIND[kind] ?? kind] ?? 0

  // ===== 资产：所有**生成了产物**的历史记录（图片 / 视频 / 音频）=====
  // 用户口径：资产 = 所有生成过的列表 + 自己上传的资源。生成记录后台本来就有全量账本
  // （见 plugin-cloud-client 的 gen-history 服务），这里直接复用它，不必再起一套「资产库」。
  // 只留有产物地址（urls 非空）的条目 —— 失败/无产物的记录不算资产。
  /**
   * 资产清单：来自后台 `/api/assets`（生成产物 + 自己上传，统一登记）。
   * 与历史（historyItems）分开：历史是「生成账本」（含失败记录），资产是「真的有产物的东西」。
   */
  const assetItems = ref<AssetItem[]>([])
  async function loadAssets(): Promise<void> {
    try {
      assetItems.value = toAssetItems(await apiListAssets())
    } catch {
      assetItems.value = []
    }
  }
  /**
   * 资产 tab 的搜索 / 筛选（用户报的「点了没效果」）。
   * 搜索按名字匹配；类型筛选按 图片/视频/音频/其他 —— 都是纯前端过滤，不打后台。
   */
  const filteredAssets = computed<AssetItem[]>(() => {
    const q = (state.assetSearchQuery || '').trim().toLowerCase()
    const kindWanted = state.assetFilterKind
    return assetItems.value.filter((a) => {
      if (q && !a.name.toLowerCase().includes(q)) return false
      if (kindWanted !== '全部') {
        // 中文筛选标签 → 后台的英文 kind
        const want = kindWanted === '图片' ? 'image' : kindWanted === '视频' ? 'video' : kindWanted === '音频' ? 'audio' : 'other'
        if (a.kind !== want) return false
      }
      return true
    })
  })
  /** 上传资产：选择文件后直传后台，成功即刷新清单（新增项会出现在列表最前） */
  async function uploadAssets(files: FileList | File[]): Promise<void> {
    const list = Array.from(files)
    for (const f of list) {
      try {
        await apiUploadAsset(f.name, f)
      } catch (err) {
        console.warn('[ui] 资产上传失败: ' + f.name, err)
      }
    }
    await loadAssets()
  }
  /** 带位置的上传（上传弹窗用）：逐个字节直传后台并登记进 folderId */
  async function uploadAssetsTo(files: FileList | File[], folderId?: string): Promise<void> {
    for (const f of Array.from(files)) {
      try {
        await apiUploadAsset(f.name, f, folderId)
      } catch (err) {
        console.warn('[ui] 资产上传失败: ' + f.name, err)
      }
    }
    await loadAssets()
  }
  /**
   * 从**画布上已有的图**上传（节点右键 / 多选「加入资产库」用）：
   * 先把地址取成字节，再走与本地文件同一条 API —— 用户口径「和左侧侧边栏点击一样」。
   */
  async function uploadAssetsFromUrls(items: { url: string; name: string }[], folderId?: string): Promise<void> {
    for (const it of items) {
      try {
        const bytes = await fetch(it.url).then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.blob()
        })
        await apiUploadAsset(it.name, bytes, folderId)
      } catch (err) {
        console.warn('[ui] 画布图入库失败: ' + it.name, err)
      }
    }
    await loadAssets()
  }
  /** 删除资产：调后台 DELETE 后本地摘掉该项（不用整表重拉，删一条已知 id） */
  async function deleteAssetById(id: string): Promise<void> {
    try {
      await apiDeleteAsset(id)
      assetItems.value = assetItems.value.filter((a) => a.id !== id)
    } catch (err) {
      // 删失败不能悄悄吞掉（用户 2026-10-13 报「点了删除没效果、刷新数据还在」）。
      // showToast 在成品壳里是空实现，所以这里只留下 console.warn —— 真正的兜底是下面那句
      // loadAssets：它把画面收敛回服务器真值，删没删掉一眼看得出来。
      console.warn('[ui] 资产删除失败: ' + id, err)
    }
    // 收敛到服务器真值：批量删多条时，某一条失败也能如实反映出来（本地摘除只是乐观更新）。
    await loadAssets()
  }
  /** 资产改名 */
  async function renameAssetById(id: string, name: string): Promise<void> {
    try {
      await apiRenameAsset(id, name)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 资产改名失败: ' + id, err)
    }
  }

  // ===== 资产文件夹（树形）+ 批量选择 + 标签 =====
  const assetFolders = ref<AssetFolderSummary[]>([])
  async function loadAssetFolders(): Promise<void> {
    try {
      assetFolders.value = await apiListAssetFolders()
    } catch {
      assetFolders.value = []
    }
  }
  /** 建文件夹（parentId 空 = 根目录）；成功后刷新文件夹清单 */
  /**
   * 新建资产文件夹。**返回新文件夹的 id**（拿不到 → undefined）。
   *
   * 为什么要回 id：节点包「收藏到资产库」需要"把包存进「节点库」这个文件夹，
   * 没有就现建一个"（用户口径 2026-10-14）—— 不回 id 就得建完再按名字去清单里翻，
   * 而同名文件夹可能有多个，翻出来的未必是刚建的那个。
   */
  async function newAssetFolder(name: string, parentId?: string): Promise<string | undefined> {
    try {
      const made = await apiCreateAssetFolder(name, parentId)
      await loadAssetFolders()
      return made?.id
    } catch (err) {
      console.warn('[ui] 新建文件夹失败: ' + name, err)
      return undefined
    }
  }
  async function renameAssetFolderById(id: string, name: string): Promise<void> {
    try {
      await apiRenameAssetFolder(id, name)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 文件夹改名失败: ' + id, err)
    }
  }
  async function setAssetFolderIcon(id: string, icon: string): Promise<void> {
    try {
      await apiSetAssetFolderIcon(id, icon)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 设置文件夹图标失败: ' + id, err)
    }
  }
  async function removeAssetFolder(id: string): Promise<void> {
    try {
      await apiDeleteAssetFolder(id)
      await Promise.all([loadAssetFolders(), loadAssets()])
    } catch (err) {
      console.warn('[ui] 删文件夹失败: ' + id, err)
    }
  }
  /** 文件夹移动（拖拽嵌套 / 「移动到」二级菜单共用）：target 空 = 回根 */
  async function moveAssetFolderTo(id: string, parentId?: string): Promise<void> {
    try {
      await apiMoveAssetFolder(id, parentId)
      await loadAssetFolders()
    } catch (err) {
      console.warn('[ui] 移动文件夹失败: ' + id, err)
    }
  }
  /**
   * 批量移动（「移动到」= 真挪；「添加到」= 也落归属，后台同一字段）。
   *
   * 成功给一句 toast（用户报过「移动到没生效」：其实挪成了，但列表里没明显变化、
   * 也没有任何反馈，看着像没反应）。loadAssets 之后 assetFolderTree 的 count 也会跟着重算。
   *
   * 传进来的 id 一律是**资产 id**（勾文件夹只会把它里面的文件放进已选，见 assetSelection
   * 的文件头说明），所以这里不需要分辨文件夹。
   */
  async function moveSelectedAssets(folderId?: string, idList?: string[]): Promise<void> {
    const ids = idList ?? [...state.assetSelectedIds]
    if (!ids.length) return
    try {
      await apiMoveAssets(ids, folderId)
      await loadAssets()
      const target = folderId ? assetFolders.value.find((f) => f.id === folderId)?.name : ''
      showToast('已移动 ' + ids.length + ' 项到「' + (target || '个人资产库') + '」')
    } catch (err) {
      console.warn('[ui] 批量移动失败', err)
    }
  }
  /** 单资产挪文件夹（上传弹窗按位置归档用） */
  async function moveAssetTo(id: string, folderId?: string): Promise<void> {
    try {
      await apiMoveAssets([id], folderId)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 移动资产失败: ' + id, err)
    }
  }
  /** 给单个资产覆盖标签 */
  async function tagsForAsset(id: string, tags: string[]): Promise<void> {
    try {
      await apiSetAssetTags(id, tags)
      await loadAssets()
    } catch (err) {
      console.warn('[ui] 设置标签失败: ' + id, err)
    }
  }
  /** 批量选择开关：退出时清空已选 */
  function toggleAssetBatch(on?: boolean): void {
    state.assetBatchOn = on ?? !state.assetBatchOn
    if (!state.assetBatchOn) {
      state.assetSelectedIds = []
      state.assetSelectAnchorId = null
    }
  }
  /**
   * 勾选一行（勾选框 / 资产行点击共用）：文件夹连带**直属**资产、Shift 划区间，
   * 判定在 composables/assetSelection.ts（纯函数，有单测）。
   *
   * 这里只喂两样东西：行列表（决定区间与层级）与资产清单（决定文件夹直属内容），
   * 所以抽屉与弹窗两处宿主的行为天然一致。
   */
  function toggleAssetSelected(
    id: string,
    opts?: { rows?: { kind: 'folder' | 'asset'; id: string; parentId?: string }[]; shift?: boolean },
  ): void {
    const next = applyRowClick({
      rows: opts?.rows ?? [],
      assets: assetItems.value,
      selected: state.assetSelectedIds,
      anchorId: state.assetSelectAnchorId,
      id,
      shift: Boolean(opts?.shift),
    })
    state.assetSelectedIds = next.selected
    state.assetSelectAnchorId = next.anchorId
  }

  /** 资产文件夹树（含每层下的资产数量，供行尾角标） */
  const assetFolderTree = computed(() => {
    type FolderNode = AssetFolderSummary & { children: FolderNode[]; count: number }
    const byId = new Map<string, FolderNode>()
    for (const f of assetFolders.value) byId.set(f.id, { ...f, children: [], count: 0 })
    const roots: FolderNode[] = []
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    // 数量 = 直接挂在文件夹下的资产数（不含子文件夹，直观对应「这个文件夹里有几张」）
    for (const a of assetItems.value) {
      const key = a.folderId ?? ''
      const node = byId.get(key)
      if (node) node.count++
    }
    const sortRec = (list: FolderNode[]) => {
      list.sort((x, y) => x.name.localeCompare(y.name, 'zh'))
      for (const n of list) sortRec(n.children)
    }
    sortRec(roots)
    return roots
  })

  // ===== 「加入资产库」上传弹窗的共享输入（节点右键 / 多选两条入口的宿主用）=====
  /** 平铺的文件夹行（上传弹窗「保存位置」下拉用；与左侧那个弹窗同一份数据） */
  const flatFoldersForUpload = computed(() => {
    const out: { id: string; name: string; depth: number }[] = []
    const walk = (list: typeof assetFolderTree.value, depth: number): void => {
      for (const f of list) {
        out.push({ id: f.id, name: f.name, depth })
        walk(f.children, depth + 1)
      }
    }
    walk(assetFolderTree.value, 0)
    return out
  })
  /**
   * 标签固定清单（上传弹窗「设置标签」用；与 LeftDrawer 的 ASSET_TAGS 同一份口径）。
   *
   * 「节点」是 2026-10-13 为节点包加的：收藏进来的包默认打这个标签，
   * 筛起来一眼能找到"哪些是可复用的节点"。
   */
  const assetTagOptions = computed(() => ['角色', '场景', '物品', '风格', '音效', '节点'])

  /** 资产计数：按类型（喂给资产页顶部的小统计）—— 与 histCount 同一道中英转换 */
  const assetCount = (kind: string): number => state.historySummary.byKind[HIST_KIND[kind] ?? kind] ?? 0

  /** 评级筛选的中文标签 ↔ 后台英文值 */
  const HIST_RATING: Record<string, string> = {
    所有评级: 'all',
    已通过: 'passed',
    待审核: 'pending',
    已拒绝: 'rejected',
  }
  /** 历史请求序号：只让最新一次请求的结果落表（防快速切页签时旧响应覆盖新响应） */
  let historyReqSeq = 0

  /**
   * 从后台拉一页历史。
   *
   * 服务名是 `gen-history`（由 plugin-cloud-client 挂上）。没装那个插件
   * （比如纯前端开着）时服务不存在 —— 给一句人话，而不是装作"没有历史"。
   */
  async function loadHistory(): Promise<void> {
      const svc = readyHost?.ctx?.get<{
      query(q?: Record<string, unknown>): Promise<{
        items: Array<{
          id: string
          title: string
          kind: string
          finishedAt: number
          urls?: string[]
          canvasId?: string
          nodeId?: string
          prompt?: string
          values?: Record<string, unknown>
          resources?: Array<{ kind: string; url?: string; value?: string }>
          media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
          error?: string
        }>
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
    // 请求序号：快速切页签/触底时多个请求并发，慢的旧响应不能覆盖新响应
    //（否则点"图片"后，晚到的"音频"响应会把画面改回去 —— 用户报的错乱之一）。
    const seq = ++historyReqSeq
    try {
      const page = await svc.query({
        page: state.histPage,
        pageSize: state.histPageSize,
        ...(state.histType ? { kind: HIST_KIND[state.histType] ?? state.histType } : {}),
        ...(state.histRating && state.histRating !== '所有评级'
          ? { rating: HIST_RATING[state.histRating] ?? state.histRating }
          : {}),
        order: state.histSortDesc ? 'desc' : 'asc',
        // 「本画布」= URL 里那个真实画布 id（`currentCanvasId`）——
        // 以前写死 `'default'`，于是切到别的画布后「本画布」筛的是 default 的历史（与屏幕上的画布对不上）。
        ...(state.histScope === '本画布' ? { canvasId: currentCanvasId.value } : {}),
      })
      if (seq !== historyReqSeq) return // 已有更新的请求发出，丢弃这份过期响应
      const mapped = page.items.map((e) => ({
        id: e.id,
        title: e.title,
        time: formatAgo(e.finishedAt),
        // 后台给英文值，这里换回中文标签（弹窗按中文渲染）
        kind: e.kind === 'video' ? '视频' : e.kind === 'audio' ? '音频' : '图片',
        ...(e.urls && e.urls.length > 0 ? { urls: e.urls } : {}),
        // 画布 / 节点 id 也要带上：卡片缩略图要按「同源资源地址」取图（见 ModalsArea 的 thumbOf）
        ...(e.canvasId ? { canvasId: e.canvasId } : {}),
        ...(e.nodeId ? { nodeId: e.nodeId } : {}),
        // 生成参数 / 参考素材 / 媒体元数据：卡片角标与详情弹窗都要用
        finishedAt: e.finishedAt,
        ...(e.prompt ? { prompt: e.prompt } : {}),
        ...(e.values && Object.keys(e.values).length > 0 ? { values: e.values } : {}),
        ...(e.resources && e.resources.length > 0 ? { resources: e.resources } : {}),
        ...(e.media && Object.keys(e.media).length > 0 ? { media: e.media } : {}),
        ...(e.error ? { error: e.error } : {}),
      }))
      // 追加式分页：第 1 页（或筛选切换后回到第 1 页）替换整表；后续页**追加**，
      // 无限滚动才能不断把下一批接到已有卡片后面（历史卡片 DOM 与滚动位置都保留）。
      if (state.histPage <= 1) {
        state.historyItems = mapped
      } else {
        state.historyItems.push(...mapped)
      }
      state.historySummary = page.summary
      state.histTotal = page.total
      state.histHasMore = page.items.length >= state.histPageSize
      state.histDataVersion += 1
      state.historyReady = true
    } catch (err) {
      console.warn('[ui] 拉历史失败', err)
      state.historyReady = false
      // 失败也要推进版本：弹窗可能在等新数据重建（filterSwitching 挂着会白屏）
      state.histDataVersion += 1
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
    /** 当前会话 id（历史列表高亮「我现在在哪条」要它；null = 还没开聊） */
    sessionId: string | null
    /** 会话列表（updatedAt 供历史列表挑"最后使用"的那条成员） */
    sessions: Array<{ id: string; title: string; preview?: string; updatedAt: number }>
    /** 历史列表行：一个对话一行（分支树聚合；rootId = 点击目标） */
    conversations: Array<{
      rootId: string
      memberIds: string[]
      meta: { id: string; title: string; preview?: string; updatedAt: number }
    }>
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
    get sessions(): Array<{ id: string; title: string; preview?: string; updatedAt: number }> {
      return agentSvc()?.state.sessions ?? []
    },
    get sessionId(): string | null {
      return agentSvc()?.state.sessionId ?? null
    },
    get conversations(): Array<{
      rootId: string
      memberIds: string[]
      meta: { id: string; title: string; preview?: string; updatedAt: number }
    }> {
      return agentSvc()?.state.conversations ?? []
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
  /**
   * 打开一个「对话」：优先停在当前会话（若它属于这棵树 —— 分支里任意一条），
   * 否则打开**最后使用**的那条成员。
   *
   * 为什么是「最后使用」而不是 members[0]（code review 2026-10-11 抓到的 bug）：
   * members[0] 是 **id 字母序**的第一个 —— 往往是最老的那条（模型也是老的）。
   * 用户切到一个对话，期待的是「接着上次继续」：模型下拉要跟的是**这个对话最后一次用的模型**，
   * 也就是 updatedAt 最新的那条成员（切模型 / 编辑重发都会新开一条成员，updatedAt 最新 = 最后用的）。
   * memberIds 来自会话列表（带 updatedAt），排序一次即可。
   */
  function openAgentConversation(rootId: string, memberIds: string[]): void {
    const current = agentSvc()?.state.sessionId
    if (current && memberIds.includes(current)) {
      openAgentSession(current)
      return
    }
    const sessions = agentSvc()?.state.sessions ?? []
    const byTime = new Map(sessions.map((s) => [s.id, s.updatedAt]))
    const latest = [...memberIds]
      .sort((a, b) => (byTime.get(b) ?? 0) - (byTime.get(a) ?? 0))[0]
    openAgentSession(latest ?? rootId)
  }
  /** 删一个「对话」= 删整棵树（分支一起删；用户口径：一个对话就是一份历史） */
  function deleteAgentConversation(memberIds: string[]): void {
    const svc = readyHost?.ctx?.get<{ deleteSession?: (id: string) => Promise<void> }>('agent')
    if (!svc?.deleteSession) return
    for (const id of [...memberIds].reverse()) void svc.deleteSession(id)
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

  /**
   * 外部插件**不再自动装载**（用户要求 2026-10-11：全部由我在「设置 → 插件」面板里自己挑）。
   *
   * 以前这里读 /plugin-manifest.json 挨个 install，后果是"用户没点过装什么，就被装上了"——
   * 尤其云端客户端（plugin-cloud-client）会立刻接管画布存档并连后台。现在改成 opt-in：
   * 想连后台就去面板里点「云端连接」那一行的安装（清单里由 /plugin-catalog.json 提供）。
   *
   * 为什么保留函数而不是直接删：onReady 的调用点与顺序语义（"外部插件装完再拉历史"）不变，
   * 将来若要恢复"按清单自动装"只需把实现填回来。
   */
  async function installExternalPlugins(): Promise<void> {
    // 有意空实现：装载入口在「插件管理」面板（plugin-manager 插件）。
    return
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
    bindCanvasTree()
    // 当前画布 / 画布清单：从 URL 认当前是哪张，再拉（可能跨项目）它的清单
    currentCanvasId.value = canvasIdFromUrl()
    void refreshCanvasList()
    void loadAssets()
    // 文件夹清单也在就绪时拉一次（不只等「打开资产 tab」）：
    // 「加入资产库」上传弹窗的"保存位置"下拉、节点/多选的资产入口都要用它，
    // 那些入口在抽屉关着时也能用 —— 只在开 tab 时拉就会看到空/过期的下拉。
    void loadAssetFolders()
    void loadProjectName()
    await installExternalPlugins()
    // 外部插件装完（云插件会挂上 gen-history 服务）再拉历史；顺带订阅"有新生成"
    void loadHistory()
    bindHistoryUpdates()
    bindHistoryFilters()
    // 外部插件（多选工具栏 / 节点右键）往资产库塞了新东西时刷新清单
    bindAssetsChanged()
  }

  /**
   * 订阅「资产库被外部入口改了」（多选工具栏「加入资产库」、节点右键「加入资产库」）：
   * 那些入口走插件、直接 POST /api/assets，不经过 ui 层 —— 发一条 window 事件，
   * 这里收到就重拉资产清单，左侧面板立刻能看到新条目。
   */
  function bindAssetsChanged(): void {
    if (typeof window === 'undefined') return // Node 单测环境无 window：跳过副作用
    window.removeEventListener('mini-canvas:assets-changed', onAssetsChanged)
    window.addEventListener('mini-canvas:assets-changed', onAssetsChanged)
  }
  function unbindAssetsChanged(): void {
    if (typeof window === 'undefined') return
    window.removeEventListener('mini-canvas:assets-changed', onAssetsChanged)
  }
  function onAssetsChanged(): void {
    void loadAssets()
    if (state.leftTab === 'assets') void loadAssetFolders()
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
    unbindHistoryFilters()
  }

  /**
   * 筛选条件（画布范围 / 类型 / 评级 / 排序）一变就重拉。
   *
   * 为什么必须有：这些条件是由 state 驱动的，以前只在**打开弹窗**时拉一次 ——
   * 用户点了「图片」「本画布」后列表纹丝不动（看上去就像筛选坏了）。
   * 只在弹窗开着时拉，避免后台白白扫一遍全量账本。
   */
  let disposeHistFilterWatch: (() => void) | undefined
  function bindHistoryFilters(): void {
    disposeHistFilterWatch?.()
    disposeHistFilterWatch = watch(
      () => [state.histScope, state.histType, state.histRating, state.histSortDesc, state.histPageSize],
      () => {
        if (!state.historyOpen) return
        state.histPage = 1 // 换筛选条件要回到第一页
        void loadHistory()
      },
    )
  }

  /** 撤掉筛选 watch（宿主销毁时调用） */
  function unbindHistoryFilters(): void {
    disposeHistFilterWatch?.()
    disposeHistFilterWatch = undefined
  }

  /**
   * 无限滚动：历史弹窗滚到底部时拉下一页并**追加**（不重置 renderedCount，
   * 已渲染的卡片与滚动位置都保留 —— 参照 web2api 画廊「触底再加载一批」的体验）。
   */
  function loadMoreHistory(): void {
    if (!state.historyOpen || !state.histHasMore || state.histLoadingMore) return
    state.histLoadingMore = true
    state.histPage += 1
    void loadHistory().finally(() => {
      state.histLoadingMore = false
    })
  }

  // ===== 批量操作（历史弹窗底部操作栏）=====
  /** 后台调用（同源；与 projectsApi 同风格但不 import —— 那份没覆盖 history 路由） */
  async function histReq<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
    if (!res.ok || data?.ok === false) throw new Error(data?.error || '请求失败（HTTP ' + res.status + '）')
    return data
  }

  /** 批量删除选中历史（后台删账本条目；产物资源文件不动） */
  async function batchDeleteHistory(): Promise<void> {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    try {
      const r = await histReq<{ removed: number }>('/api/history/batch-delete', { ids })
      showToast('已删除 ' + r.removed + ' 条')
      state.histSelectedIds = []
      state.histPage = 1
      await loadHistory()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败')
    }
  }

  /** 批量改评级 */
  async function batchRateHistory(rating: 'passed' | 'pending' | 'rejected'): Promise<void> {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    try {
      const r = await histReq<{ updated: number }>('/api/history/batch-rating', { ids, rating })
      showToast('已更新 ' + r.updated + ' 条评级')
      state.histSelectedIds = []
      state.histPage = 1
      await loadHistory()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '评级失败')
    }
  }

  /** 批量保存到资产（把产物地址登记进资产库，addByUrl 按地址去重） */
  async function batchSaveAssets(): Promise<void> {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    try {
      const r = await histReq<{ saved: number }>('/api/history/batch-save-assets', { ids })
      showToast('已保存 ' + r.saved + ' 项到资产')
      state.histSelectedIds = []
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败')
    }
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
  /** 一份资产在画布上对应的节点类型：image / video / audio；不支持的类型 → null */
  function nodeTypeOfAsset(asset: { kind?: string; assetKind?: string }): 'image' | 'video' | 'audio' | null {
    const kind = assetKindOf(asset)
    return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
  }

  /** 建节点时的落点：优先用调用方给的 flow 坐标（拖拽落点），否则按已有节点数级联错开 */
  function spawnPosition(atFlow?: { x: number; y: number }): { x: number; y: number } {
    if (atFlow && Number.isFinite(atFlow.x) && Number.isFinite(atFlow.y)) {
      // 拖拽落点 = 指针位置：把节点左上角回退半个身位，视觉上"落在指针处"而不是"指针在左上角"
      return { x: Math.round(atFlow.x - 24), y: Math.round(atFlow.y - 24) }
    }
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    const count = host?.nodeStore?.getNodes().length ?? 0
    return { x: 80 + (count % 5) * 48, y: 80 + Math.floor(count / 5) * 60 }
  }

  /** 只选中（不动视口）：拖拽落点已在用户眼前，再挪视口等于画布自己乱动 */
  function selectNewNode(newId: unknown): void {
    if (typeof newId !== 'string' || !newId) return
    hostCtx()?.get<{ set(ids: Iterable<string>): void }>('selection')?.set([newId])
  }

  /** 建完选中 + 聚焦（等价按 F）；宿主没就绪或没返回 id 时静默跳过 */
  function focusNewNode(newId: unknown): void {
    if (typeof newId !== 'string' || !newId) return
    const ctx = hostCtx()
    const selection = ctx?.get<{ set(ids: Iterable<string>): void }>('selection')
    selection?.set([newId])
    // 聚焦放在 nextTick：节点刚建出来，等一帧让渲染层拿到它的位置/尺寸再算 bounds。
    void nextTick(() => ctx?.get<{ execute(id: string): unknown }>('command')?.execute('auto-layout:focus-selected'))
  }

  /** 取画布宿主（hostEl 优先；没有就退到 window 上暴露的那份） */
  function canvasHost(): FullHost | undefined {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    return host ?? (window as unknown as { MiniCanvasUI?: { getHost(): FullHost } }).MiniCanvasUI?.getHost()
  }

  /**
   * 画布上**现在已有的全部显示名**（判重用的那口锅）。
   *
   * 为什么读 nodeStore 而不是别处：它是"画布上现在有什么"的唯一真源，
   * 而重名要防的正是"与画布上已有的撞"。
   * 宿主没就绪 / 拿不到 → 空数组（此时谈不上撞名，照原样建）。
   */
  function existingLabels(): string[] {
    const nodes = canvasHost()?.nodeStore?.getNodes() ?? []
    const out: string[] = []
    for (const raw of nodes) {
      const label = (raw as { data?: { label?: unknown } } | null)?.data?.label
      if (typeof label === 'string' && label.trim()) out.push(label.trim())
    }
    return out
  }

  /**
   * 给**建进来的节点**定一个不撞的名字（用户 2026-10-14 报的「拖出来的节点名称没有自动追加」）。
   *
   * 为什么需要它：画布上「新建节点」的名字走数据层按类型计数（图片 1 / 图片 2…），不会撞；
   * 而**从资产库拖节点包进来**、以及**来自包里那份 label**，是"收藏时那一刻的名字"原样再建一次 ——
   * 拖两次同一个包就得到两个同名节点（左侧树 / 画面里分不清谁是谁）。
   *
   * want 为空 = 包本身就没名字 → 交回数据层按类型模板补（那里才是"图片 1"的出处，不在这重复一份）。
   */
  function dedupeNodeLabel(want: unknown): string | undefined {
    if (typeof want !== 'string' || !want.trim()) return undefined
    return uniqueLabel(want, existingLabels())
  }

  /**
   * 指定类型与地址建节点（资产「添加到画布」/ 拖拽落画布共用）。
   *
   * 为什么分类型走**插件自己的服务**而不是一条命令：image 有 command:create-node 的 extra 通道，
   * video / audio 的初始地址通道在各自插件的服务上（addVideoNode / addAudioNode）——
   * 那是各类型唯一的写入口，从这里进才不会绕过撤销栈/落盘/默认尺寸（与按钮同一条路）。
   * atFlow 给了就用它当落点（拖拽），没给就级联错开（菜单"添加到画布"）。
   */
  function createAssetNode(
    asset: { name?: string; url: string; kind?: string; assetKind?: string },
    atFlow?: { x: number; y: number },
  ): string | null {
    // ★ 节点包（.mcnode）走导入那条路，不是"建一个媒体节点"。
    //   为什么要在这里认：从**资源库**拖一个包到画布，与从**文件系统**拖一个包，
    //   对用户来说是同一个动作（用户 2026-10-13 口径："拖拽之后和直接从文件夹中拖拽进来的效果是一样的"），
    //   所以两条路必须落到同一件事：写脚本 + 还原节点。
    if (assetKindOf(asset) === 'node-package') {
      // ★ 落点必须一路传下去（与图片/视频那条路一致）。
      //   漏了它的后果有两个，都是用户实测报的：
      //     ① 位置不对 —— atFlow 为空 → spawnPosition 走「按已有节点数级联错开」，
      //        包不会落在指针处；
      //     ② 出现「聚焦效果」—— importPackFromUrl 里 atFlow 为空会走 focusNewNode
      //        （= 按 F 聚焦选中，会缩放平移视口），而拖拽那条本该只 selectNewNode。
      void importPackFromUrl(asset.url, asset.name, atFlow)
      return null
    }
    const type = nodeTypeOfAsset(asset)
    if (!type) {
      showToast('暂不支持把「' + assetKindOf(asset) + '」类型的资产添加到画布')
      return null
    }
    const target = canvasHost()
    const ctx = hostCtx()
    const position = spawnPosition(atFlow)
    let newId: unknown
    if (type === 'image') {
      if (!target?.command) return null
      newId = target.command.execute('command:create-node', {
        type: 'image',
        position,
        imageUrl: asset.url,
        ...(asset.name ? { name: asset.name } : {}),
      })
    } else {
      // video / audio：走插件服务（服务名与节点类型同名；插件没装 → undefined → 明确反馈）
      const svc = ctx?.get<{ addVideoNode?: (p: { x: number; y: number }, url?: string) => string; addAudioNode?: (p: { x: number; y: number }, url?: string) => string }>(type)
      if (type === 'video' && svc?.addVideoNode) newId = svc.addVideoNode(position, asset.url)
      else if (type === 'audio' && svc?.addAudioNode) newId = svc.addAudioNode(position, asset.url)
      else {
        showToast('「' + type + '」节点插件未启用，无法添加')
        return null
      }
    }
    /**
     * 选中新节点**总是要做**（用户一眼看到"加进来了"），但**取景只在不拖拽时做**：
     *   用户口径（2026-10-07）：「从左侧面板拖拽到画布添加节点时，希望不要对画布进行任何缩放和平移操作，
     *   直接添加上去就行」—— 拖拽的落点就是用户当前正看着的地方，再把视口挪走属于"画布自己乱动"。
     *   菜单「添加到画布」那条路（atFlow 为空）节点可能落在视口外，所以照旧取景。
     */
    if (atFlow) selectNewNode(newId)
    else focusNewNode(newId)
    return typeof newId === 'string' ? newId : null
  }

  /**
   * 指定图片地址建图片节点（资产「添加到画布」用；复用 command:create-node 的 payload 形状）。
   *
   * 建完**选中它并聚焦**（等价于按 F）—— 用户口径：「节点添加到画布之后，自动聚焦就是快捷键 F」。
   * 不这么做的话，新节点可能落在当前视口外，用户看不到"加进去了"（以为没生效）。
   */
  function createImageNodeWithUrl(imageUrl: string, name?: string): void {
    createAssetNode({ url: imageUrl, ...(name ? { name } : {}) }, undefined)
  }

  /**
   * 屏幕坐标 → flow 坐标（拖拽落画布时把指针位置换算成节点位置）。
   * viewport 服务缺失（宿主未就绪）→ null，调用方退级联默认落点。
   */
  function screenToFlow(clientX: number, clientY: number): { x: number; y: number } | null {
    const vp = hostCtx()?.get<{ screenToFlow?(x: number, y: number): { x: number; y: number } }>('viewport')
    if (!vp?.screenToFlow) return null
    try {
      return vp.screenToFlow(clientX, clientY)
    } catch {
      return null
    }
  }

  /**
   * 视口中心（flow 坐标）—— 「没有指针落点」那一类入口的默认落点。
   *
   * 为什么不用鼠标位置：点菜单/点上传这类入口触发时，用户多半在盯底栏，
   * 用鼠标位置会把节点甩到上次路过的角落；中心一定看得见。
   * 与 addMediaFilesToCanvas 里那段同一条口径（媒体文件拖进来也走它）。
   */
  function viewportCenterFlow(): { x: number; y: number } | null {
    const vp = hostCtx()?.get<
      { getPaneEl?(): HTMLElement | null; screenToFlow?(x: number, y: number): { x: number; y: number } }
    >('viewport')
    const pane = vp?.getPaneEl?.()
    if (!pane || !vp?.screenToFlow) return null
    const r = pane.getBoundingClientRect()
    if (!(r.width > 0 && r.height > 0)) return null
    try {
      return vp.screenToFlow(r.left + r.width / 2, r.top + r.height / 2)
    } catch {
      return null
    }
  }

  // ===== 资产「服务动作」：把资产接到画布 / Agent =====
  // 为什么收进 ui 层当**服务**（用户口径：「我觉得你应该把这个功能做成一个服务」）：
  // 左侧抽屉、资产管理弹窗、将来的右键菜单/搜索面板都要干同一件事，散在各组件里必然走样。
  // 这里只做「取到目标（ctx 服务 / 画布命令）→ 调一次」，UI 组件退化成调用点。

  /** 取内核 ctx（画布服务都挂在它下面）；宿主未就绪或没装插件 → undefined */
  function canvasCtx(): { get<T>(name: string): T | undefined } | undefined {
    const host = (hostEl.value?.host ?? hostEl.value) as FullHost | undefined
    return host?.ctx as { get<T>(name: string): T | undefined } | undefined
  }

  /**
   * 数据集：把一份资产建到画布上。
   *
   * 类型一律经 assetKindOf 取 —— 列表行给的是 assetKind、AssetItem 给的是 kind，
   * 之前直接读 asset.kind：列表行传进来时是 undefined，于是**静默走了「不支持」分支、什么也没建**
   * （用户报的「添加到画布没有效果」）。
   */
  function addAssetToCanvas(asset: { name: string; url: string; kind?: string; assetKind?: string }): void {
    createAssetNode(asset, undefined)
  }

  /**
   * 把一份资产**拖到画布**上：在落点（屏幕坐标）建对应类型的节点。
   * 拖拽的落点即指针位置 —— 用户口径：「资源里的图片、音频和视频等，可以直接拖拽到画布上，
   * 拖拽上去就是直接添加一个新的节点」。
   */
  function dropAssetToCanvas(asset: { name?: string; url: string; kind?: string; assetKind?: string }, client: { x: number; y: number }): string | null {
    const flow = screenToFlow(client.x, client.y) ?? undefined
    return createAssetNode(asset, flow)
  }

  /** file-drop 服务的最小用面（契约见 plugin-file-drop 的 FileDropService） */
  type FileDropLike = {
    addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
    canHandle(file: { name: string; type: string }): boolean
  }
  /**
   * 本地上传的文件**直接落画布**（底栏「+ → 上传」用）。
   *
   * 用户口径（2026-10-11）：「点击『上传』时，它是直接把你选中的东西放置在画布中」——
   * 就是「把文件拖进画布」那件事，所以不自己另写一套建节点，而是把文件交给
   * file-drop 插件的 addFiles（同一份识别 / 尺寸 / 资源落盘 / 选中逻辑）。
   *   · 图片 → image 节点（带真实比例）、视频 → video 节点、文本 → text 节点；
   *   · 多文件在锚点处依次排开，一次历史提交，建完选中。
   *
   * 落点：**视口中心**（而不是"最近一次鼠标位置"）—— 这条入口是点菜单触发的，
   * 用户这时多半在盯着底栏，用鼠标位置会把节点甩到上次路过的角落；中心一定看得见。
   * 视口服务拿不到（宿主没就绪）就传 null，交给 addFiles 用它的默认锚点。
   *
   * 插件没装（拿不到 file-drop 服务）→ 明确提示，不静默什么都不做。
   */
  async function addFilesToCanvas(files: File[]): Promise<number> {
    const list = files.filter((f) => f.size > 0)
    if (!list.length) return 0

    // ★ 节点包（.mcnode）单独走一条：它不是媒体文件，而是"一个节点 + 它的脚本"。
    //   为什么要在这里分流：拖进来的动作是同一个（拖到画布），但落点完全不同 ——
    //   媒体文件是"建一个媒体节点"，包是"写脚本 + 还原节点"。
    //   先挑出来落地，剩下的交给 file-drop（用户可能一次拖了包 + 图片）。
    const packs = list.filter((f) => isNodePackFile(f.name))
    const restFiles = list.filter((f) => !isNodePackFile(f.name))
    // 节点包与媒体文件落到同一处：没有指针落点时用**视口中心**（与 addMediaFilesToCanvas 一致）
    const packAnchor = viewportCenterFlow() ?? undefined
    for (const p of packs) await importPackFile(p, packAnchor)
    if (restFiles.length === 0) return packs.length
    return (await addMediaFilesToCanvas(restFiles)) + packs.length
  }

  /**
   * 把一个 .mcnode 交给后台落地（写脚本 + 还原节点），然后**在前端建出那个节点**。
   *
   * 为什么建节点这一步在前端：只有前端知道往哪张画布、落在哪个位置、建完选中谁。
   * 后台只负责"把脚本写下去、把节点数据算好"（它算不了视口）。
   */
  async function importPackFile(file: File, atFlow?: { x: number; y: number }): Promise<boolean> {
    const target = canvasHost()
    const ctx = hostCtx()
    if (!target?.command || !ctx) return false
    try {
      const base = await resolvePackBase()
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await importPack({ base, bytes })
      // 与「媒体文件拖进画布」同一条口径（见 addMediaFilesToCanvas）：
      //   落点 = 指针位置（没给就用视口中心）；建完**只选中**、不取景。
      //   原先这里是 spawnPosition(undefined) + focusNewNode —— 于是同一个「往画布拖东西」
      //   的动作，图片/视频只是多一个节点，节点包却会让画布自己缩放平移（用户报的「聚焦效果」）。
      const anchor = atFlow ?? viewportCenterFlow() ?? undefined
      // 名字要跟着画布上的现状去重（否则拖两次同一个包 = 两个同名节点，左侧树里分不清）
      const uniqueName = dedupeNodeLabel((result.node.data as { label?: unknown }).label)
      const id = target.command.execute('command:create-node', {
        type: result.node.type,
        position: spawnPosition(anchor),
        ...result.node.data,
        ...(uniqueName !== undefined ? { label: uniqueName } : {}),
      })
      if (typeof id === 'string') selectNewNode(id)
      // 升版本了要说一声：用户得知道"这是 v2、原来那个没动"
      showToast(
        result.action === 'bump'
          ? '已导入（本机有同名脚本，整套升到 ' + VERSION_SEP + result.version + '）'
          : '已导入：' + result.title,
      )
      return true
    } catch (err) {
      showToast('导入失败：' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  /**
   * 从**资产库里的地址**导入一个包（拖抽屉里那一项到画布）。
   *
   * 与 importPackFile 的区别只有"字节从哪来"：那边是本地文件，这边要先取回来。
   * 其余（交给后台落地 → 前端建节点 → 提示升版本）完全一样 —— 用户口径：
   * 「拖拽之后，和直接从文件夹中拖拽进来的效果是一样的」。
   */
  async function importPackFromUrl(
    url: string,
    name?: string,
    atFlow?: { x: number; y: number },
  ): Promise<boolean> {
    const target = canvasHost()
    if (!target?.command) return false
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('取包失败（HTTP ' + res.status + '）')
      const bytes = new Uint8Array(await res.arrayBuffer())
      const base = await resolvePackBase()
      const result = await importPack({ base, bytes })
      // 与 importPackFile 同一条口径：名字跟着画布上已有的去重（拖两次同一个包会重名）
      const uniqueName = dedupeNodeLabel((result.node.data as { label?: unknown }).label)
      const id = target.command.execute('command:create-node', {
        type: result.node.type,
        // 右键菜单那条路会给落点（用户在哪儿右键就放哪儿）；资产库拖拽那条没有，走默认位置
        position: spawnPosition(atFlow),
        ...result.node.data,
        ...(uniqueName !== undefined ? { label: uniqueName } : {}),
      })
      if (typeof id === 'string') {
        if (atFlow) selectNewNode(id)
        else focusNewNode(id)
      }
      showToast(
        result.action === 'bump'
          ? '已从资源库导入（本机有同名脚本，整套升到 ' + VERSION_SEP + result.version + '）'
          : '已从资源库导入：' + (name || result.title),
      )
      return true
    } catch (err) {
      showToast('导入失败：' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  /** 媒体文件那条老路（原 addFilesToCanvas 的实现，原样搬过来） */
  async function addMediaFilesToCanvas(list: File[]): Promise<number> {
    const svc = hostCtx()?.get<FileDropLike>('file-drop')
    if (!svc?.addFiles) {
      showToast('文件拖放插件未启用，无法把文件加到画布')
      return 0
    }
    // 视口中心（client 坐标）→ flow：pane 矩形的一半即屏幕中心；两者都拿不到就 null
    const vp = hostCtx()?.get<ViewportLike & { getPaneEl?(): HTMLElement | null; screenToFlow?(x: number, y: number): { x: number; y: number } }>('viewport')
    let atFlow: { x: number; y: number } | null = null
    const pane = vp?.getPaneEl?.()
    if (pane && vp?.screenToFlow) {
      const r = pane.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) atFlow = vp.screenToFlow(r.left + r.width / 2, r.top + r.height / 2)
    }
    // canHandle 不认的文件（比如占了多个的其它类型）：先挑出来明确说一句，剩下的照建
    const handled = list.filter((f) => svc.canHandle(f))
    const skipped = list.length - handled.length
    const made = handled.length ? await svc.addFiles(handled, atFlow) : 0
    if (skipped > 0 && made === 0) showToast('这些文件类型暂不支持放到画布')
    return made
  }

  /**
   * 文件夹「添加到 Agent」：把**文件夹路径**作为一条引用发给 Agent（不是把里面的资产一张张贴）。
   *
   * 用户口径（2026-10-07）：「将文件夹添加到 Agent：直接把文件夹的地址发过去就行」。
   * 文件夹在后端只是登记表里的一条记录（没有本机目录），它的"地址"= 里面资产的公共目录
   * （取第一条有 path 的资产所在目录）。标签显示文件夹名，载荷是这条路径 —— Agent 侧自己 ls。
   */
  function addFolderToAgent(folder: { id: string; name: string }): void {
    const agent = canvasCtx()?.get<{ referenceAsset?: (a: { id?: string; name: string; url: string; path?: string; folderId?: string; isFolder?: boolean }) => void }>('agent')
    if (!agent?.referenceAsset) return
    const first = assetItems.value.find((a) => a.folderId === folder.id && a.path)
    const dir = first?.path ? first.path.replace(/[\\/][^\\/]+$/, '') : undefined
    // folderId 一定要带（用户口径 2026-10-08）：Agent 里点这颗文件夹标签时要能打开
    // 资产管理并展开到那一层 —— 只有 dir 没地方定位。
    // isFolder：显式标出「这是目录」（目录名带点号时不会被误判成文件）。
    agent.referenceAsset({ id: folder.id, name: folder.name, url: '', ...(dir ? { path: dir } : {}), folderId: folder.id, isFolder: true })
  }

  /**
   * 文件夹「添加到画布」：把文件夹里的**全部内容**按类型建到画布上（图片/视频/音频各走各的节点服务）。
   *
   * 用户口径（2026-10-07）：「将文件夹添加到画布：把文件夹中的所有内容全部添加到画布中。
   * 如果数量超过 10 个，需要弹出一个对话框让我点击确认，不然一下添加太多会卡死」。
   *
   * 数量 > 上限时**先弹确认**（确认回调由宿主给 —— 弹窗长什么样是 UI 的事，这里只问"允不允许"）；
   * 用户不点确认就一个都不建。返回实际建出的数量；空文件夹返回 0。
   */
  async function addFolderAssetsToCanvas(
    folderId: string,
    opts: { confirm?: (count: number) => Promise<boolean> } = {},
  ): Promise<number> {
    const items = assetItems.value.filter((a) => a.folderId === folderId)
    if (!items.length) return 0
    if (items.length > 10 && opts.confirm) {
      const ok = await opts.confirm(items.length)
      if (!ok) return 0
    }
    let created = 0
    const newIds: string[] = []
    for (const a of items) {
      const kind = assetKindOf(a)
      if (kind === 'image') {
        // 图片：createAssetNode 内部会"选中/聚焦"单个节点 —— 这里传 atFlow 会走"只选中"分支，
        // 但它选中会**覆盖**之前批量的选区。所以批量场景绕过它，直接走命令拿 id，收尾一次性多选。
        const target = canvasHost()
        if (!target?.command) continue
        const pos = { x: 80 + (created % 5) * 48, y: 80 + Math.floor(created / 5) * 60 }
        const newId = target.command.execute('command:create-node', {
          type: 'image',
          position: pos,
          imageUrl: a.url,
          ...(a.name ? { name: a.name } : {}),
        })
        if (typeof newId === 'string' && newId) { newIds.push(newId); created++ }
      } else if (kind === 'video' || kind === 'audio') {
        const svc = hostCtx()?.get<{ addVideoNode?: (p: { x: number; y: number }, url?: string) => string; addAudioNode?: (p: { x: number; y: number }, url?: string) => string }>(kind)
        const pos = { x: 80 + (created % 5) * 48, y: 80 + Math.floor(created / 5) * 60 }
        const newId = kind === 'video' ? svc?.addVideoNode?.(pos, a.url) : svc?.addAudioNode?.(pos, a.url)
        if (newId) { newIds.push(newId); created++ }
      }
      // other 类型跳过（没有对应节点实现），不算失败也不打断
    }
    // **一次性多选**全部新建的节点（用户口径：菜单添加的节点，添加之后自动选中）——
    // 若建一个选一个，最后选区只剩最后一个；这里批量建完统一 set，用户能直接拖动/删除这一批。
    if (newIds.length) hostCtx()?.get<{ set(ids: Iterable<string>): void }>('selection')?.set(newIds)
    return created
  }
  function addAssetToAgent(asset: { name: string; url: string; path?: string; folderId?: string }): void {
    const agent = canvasCtx()?.get<{ referenceAsset?: (a: { name: string; url: string; path?: string; folderId?: string }) => void }>('agent')
    if (!agent?.referenceAsset) {
      showToast('Agent 插件未启用')
      return
    }
    agent.referenceAsset(asset)
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
  /**
   * 提交节点标题改名（写**画布数据**，不是只改左侧树那份副本）。
   *
   * 用户口径（2026-10-08）：画布 tab 的重命名要和资产树同一种效果 —— 行内输入框，
   * 不弹浏览器原生框。所以「进入改名态 / 输入框提交」都在 LeftDrawer（宿主）里，
   * 这里只留**唯一写口**：标题写进节点自己的 data.label（画布标题条、@ 菜单、左侧树
   * 读的是同一份）。树经 doc.subscribe → refreshCanvasTree 自动重画。
   */
  function renameNode(id: string, name: string): void {
    const next = name.trim()
    const doc = hostCtx()?.get<{ setNodeLabel?(id: string, label: string | undefined): void }>('doc')
    // 清空 = 恢复类型默认名（与画布标题条双击清空同一语义）；宿主没就绪时无操作。
    doc?.setNodeLabel?.(id, next || undefined)
    // 本地树先跟上，避免落盘/订阅链路的延迟让输入框关掉后名字闪一下旧值
    const walk = (list: TreeNode[]): boolean => {
      for (const n of list) {
        if (n.id === id) { if (next) n.name = next; return true }
        if (n.children && walk(n.children)) return true
      }
      return false
    }
    walk(tree)
  }
  /**
   * 定位到某个节点：把它在画布上居中显示（左侧树点击时用）。
   *
   * 为什么用 viewport.setCenter 而不是自己改视口：那是渲染层视口的唯一入口，
   * 与缩放 / 适配屏幕走同一条路（缓存与边界面一致）。拿不到坐标（旧节点）就只选中、不移动。
   */
  function locateNode(id: string): void {
    const ctx = hostCtx()
    // 选中节点（居中后给出视觉落点，与「F 聚焦」是同一套取景）。
    // select 服务是渲染层给插件/命令用的选中入口（见 canvas-data selection.ts）；宿主没就绪就跳过。
    const sel = ctx?.get<{ set(ids: string[]): void }>('selection')
    try {
      sel?.set([id])
    } catch {
      /* 选中失败不影响聚焦 */
    }
    const vp = viewportSvc() as
      | (ViewportLike & {
          setCenter?(x: number, y: number, zoom?: number): void
          fitView?(padding?: number, opts?: { nodes?: Array<{ id: string }> }): void
        })
      | undefined
    if (!vp) return
    // 优先「聚焦到该节点」：nodeLayout 有实测矩形就用它算居中 + 舒适缩放（与 F 聚焦同一算法），
    // 比只 setCenter 到节点左上角准得多（那正是用户说的"效果极差"）。
    const layout = ctx?.get<{ getNodeRect?(id: string): { x: number; y: number; w: number; h: number } | undefined }>('nodeLayout')
    const rect = layout?.getNodeRect?.(id)
    const zoom = vp.getViewport().zoom
    if (rect && rect.w > 0 && rect.h > 0 && typeof vp.setCenter === 'function') {
      vp.setCenter(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom)
      return
    }
    // 退路：让 VueFlow 只对这一批节点取景（pane 级 fit，比逐帧 rAF 稳，不会出现 offset 漂移）
    if (typeof vp.fitView === 'function') {
      try {
        vp.fitView(0.45, { nodes: [{ id }] })
        return
      } catch {
        /* fitView 不支持 nodes 选项时继续走坐标退路 */
      }
    }
    const pos = findTreeNode(tree, id)
    if (pos && typeof vp.setCenter === 'function') vp.setCenter(pos.x ?? 0, pos.y ?? 0, zoom)
  }

  /** 在树里找某个节点（定位退路用） */
  function findTreeNode(list: TreeNode[], id: string): TreeNode | undefined {
    for (const n of list) {
      if (n.id === id) return n
      if (n.children) { const h = findTreeNode(n.children, id); if (h) return h }
    }
    return undefined
  }

  /**
   * 删除一个节点（左侧画布树的行菜单用）。
   *
   * 走 doc.removeNodes：级联清相连边、清子节点父引用、清选中态，并自动进历史 + 落盘
   * （见 canvas-data 的 graphDocument.removeNodes）—— 不自己拼删除步骤。
   */
  function removeNode(id: string): void {
    hostCtx()?.get<{ removeNodes(ids: string[]): number }>('doc')?.removeNodes([id])
  }

  /**
   * 复制一份某个节点（左侧画布树的行菜单用）。
   *
   * 为什么先选中再走 clipboard 命令：复制语义是「复制**选中集**」，命令本身不带节点参数
   * （见 plugin-clipboard 的 duplicate()：它读 selection）。只选中这一个再执行，
   * 结果就是「复制这一份」—— 不重复实现一份复制逻辑（重映射 id / 偏移 / 内外连边那套）。
   *
   * 插件没装时（拿不到 clipboard 服务）静默无操作：菜单项该由**能力是否存在**决定，
   * 但命令是活注册的，这里按「插件没装就没有这件事」处理，与其它可选插件调用一致。
   */
  function duplicateNode(id: string): void {
    const ctx = hostCtx()
    if (!ctx) return
    ctx.get<{ set(ids: Iterable<string>): void }>('selection')?.set([id])
    runCommand('clipboard:duplicate')
  }

  /**
   * 把某个画布节点引用到 Agent 输入框（左侧画布树的行菜单用）。
   *
   * 走 agent 插件已有的 `agent:reference-node` 命令（areas:['node'] 的那条，节点右键菜单同款）：
   * 命令内部只记待插入的节点 id + 打开面板，标签由输入框组件现造 —— 这里不重复那套。
   */
  function referenceNodeToAgent(id: string): void {
    hostCtx()?.get<{ execute(id: string, payload?: unknown): unknown }>('command')?.execute('agent:reference-node', { nodeId: id })
  }

  /** 解散一个分组（左侧画布树的分组行菜单用）：走 group 服务（它自己包历史 + 还原子节点绝对坐标） */
  function ungroupNode(id: string): void {
    const svc = hostCtx()?.get<{ ungroup?(groupId: string): void } | undefined>('group')
    if (!svc?.ungroup) {
      showToast('分组插件未启用')
      return
    }
    svc.ungroup(id)
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
    state, cfg, tree, filteredTree, collapsed, treeTotal, histVisible, histCount, histErrorCount, assetItems, filteredAssets, assetCount, shortcuts,
    loadMoreHistory,
    batchDeleteHistory, batchRateHistory, batchSaveAssets,
    currentCanvasId, canvasListItems, canvasNameOf, refreshCanvasList, openCanvas, newCanvas, renameCanvas, loadAssets,
    openCanvasInNewWindow, renameCanvasById, duplicateCanvas, deleteCanvas,
    canvasOptions, loadProjectName, renameProject, currentProjectId, flushCanvasSave, releasePendingSave,
    minimapOn, toggleMinimap,
    agent, setAgentOpen, toggleAgent, newAgentChat, toggleAgentHistory,
    openAgentSession, renameAgentSession, deleteAgentSession,
    openAgentConversation, deleteAgentConversation,
    toggleEdges, toggleSnap, organizeCanvas, setCanvasMode, unbindCanvasToggles,
    unbindThemeMode,
    syncZoomDisplay, zoomInStep, zoomOutStep, zoomToPercent, zoomToMax, zoomFit, unbindZoomSync,
    loadHistory, unbindHistory,
    hostEl, setHostEl, showToast, onReady, createNode, toggleTheme, applyTheme, openDrawer, closeSettings,
    runCommand,
    addAssetToCanvas, dropAssetToCanvas, addAssetToAgent, addFolderToAgent, addFolderAssetsToCanvas, screenToFlow, createAssetNode,
    addFilesToCanvas,
    importPackFile,
    importPackFromUrl,
    uploadAssets, uploadAssetsTo, uploadAssetsFromUrls, deleteAssetById, assetFolders, assetFolderTree, flatFoldersForUpload, assetTagOptions, loadAssetFolders, newAssetFolder, moveAssetTo,
    renameAssetById,
    renameAssetFolderById, removeAssetFolder, moveSelectedAssets, tagsForAsset,
    setAssetFolderIcon,
    moveAssetFolderTo, createImageNodeWithUrl,
    toggleAssetBatch, toggleAssetSelected,
    unbindSettingsClose,
    toggleShortcuts, refreshShortcuts, toggleHistory, toggleLeftCollapsed, renameNode, locateNode, unbindCanvasTree, unbindAssetsChanged, sendChat,
    removeNode, duplicateNode, referenceNodeToAgent, ungroupNode,
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
