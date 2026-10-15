/**
 * assetUiBus —— 「从别处打开资产管理 / 资产预览」的共享开关。
 *
 * 用户口径（2026-10-08）：Agent 对话里的**资产引用标签**点一下要能用 ——
 *   ① 引用的是文件（图片/视频/音频）→ 打开通用全屏预览；
 *   ② 引用的是文件夹 → 打开资产管理并**展开到那一层**（别的文件夹先折叠，并给一条引导提示）。
 *
 * 谁写这份开关：`composables/useAssetRefOpen.ts` —— 它监听 Agent 插件广播的
 * `agent:ref-click` 事件，按载荷分流到这里（或直接开预览）。
 * 谁读它：左侧抽屉（挂在画布子树内，才拿得到主题注册件，见 LeftDrawer 的 AssetUiSlot）。
 */
import { ref } from 'vue'
import { assetKindOf } from './assetModel'
import { peekPack } from './nodePack'

/** 全屏预览要放的媒体（与主题 mediaViewer 的 item 同形） */
export interface AssetPreviewItem {
  name?: string
  /** image / video / audio / text（中文别名由 MediaViewer 自己归一） */
  kind: string
  url?: string
  /**
   * 可视化节点（kind='ui'）的那段界面 HTML。
   *
   * 为什么不像别的类型那样给 url：节点内容不是"可加载的媒体"，本身就是一段 HTML。
   * 用户口径 2026-10-14：「可以在预览中添加一个 iframe 预览框」—— 它进 iframe 的 srcdoc。
   */
  html?: string
  /** 纯文本内容（kind='text' 用）—— 取包失败时把原因写在这里给用户看，别静默什么都不显示 */
  text?: string
  /** 宿主自己的资产 id（预览右上角「删除」用；来自外部打开时不带，也就没有删除按钮） */
  id?: string
  /**
   * 同层文件清单（用户口径 2026-10-14：「全局预览都提供一个列表，可以通过左右快捷键来回切换。
   * 比如在文件夹里，它只处理同一级别的文件夹中的文件预览」）。
   *
   * 直接交给主题的 MediaViewer —— 它本来就认 list / index 并自带 ← / → 与页码，
   * 我们不必在资产这边再写一套切换。
   */
  list?: string[]
  /** 与 list 一一对应的名字（切张后标题跟着换） */
  names?: string[]
  /** 与 list 一一对应的资产 id（切张后删除按钮要按当前这张算） */
  ids?: string[]
  /** 当前张在 list 里的下标 */
  index?: number
}

/** 当前要预览的媒体（null = 不显示） */
export const assetPreview = ref<AssetPreviewItem | null>(null)

/**
 * 资产管理弹窗的开合与落点。
 *
 * folderId  进弹窗时要**展开到**的那一层（空 = 根目录，全部折叠）；
 * fromRef 决定这一趟**是不是「从引用标签跳进来」**，两种行为都由它派生（不各存一份，免得漂移）：
 *   true  = 折叠到只剩选中那条链 + 给一条引导提示（点一下或 3 秒后自动消失）；
 *   false = 从左侧抽屉点「资产管理」进来：保持原本的全展开、不弹提示
 *          （那时用户是来干活的，把树折起来反而更麻烦 —— 用户口径只针对「从引用里点进来」）。
 * focusToken 每次请求都 +1：同一个文件夹被连点两次也要重新触发提示与折叠
 *（只看 folderId 的话第二次点没变化，用户会以为没反应）。
 */
export const assetManager = ref<{ open: boolean; folderId?: string; fromRef: boolean; focusToken: number }>({
  open: false,
  folderId: undefined,
  fromRef: false,
  focusToken: 0,
})

/** 打开全屏预览（MediaViewer 由 AssetUiSlot 常驻渲染，只有一份实例） */
export function openAssetPreview(item: AssetPreviewItem): void {
  assetPreview.value = item
}

/**
 * 记下「用户用 ← / → 切到了 list 里的第几张」（MediaViewer 的 index 事件）。
 *
 * 与底栏 mediaPreview.setPreviewIndex 同一套做法：切换后标题与删除按钮都要跟着当前那张走，
 * 所以把下标写回总线（而不是留在浮层里各算一份）。
 */
export function setAssetPreviewIndex(i: number): void {
  const cur = assetPreview.value
  if (!cur?.list?.length) return
  const idx = Math.min(Math.max(i, 0), cur.list.length - 1)
  if (idx === (cur.index ?? 0)) return
  assetPreview.value = { ...cur, index: idx }
}

/**
 * 当前正在看的那一张（← / → 切过之后就是新下标那张）。
 *
 * 为什么要有它：预览右上角的「删除」得删**当前这张**，不是当初点开的那张 ——
 * 底栏那边为同一件事写了 currentPreview()（见 plugin-bottom-bar/mediaPreview.ts），
 * 资产这边同理。名字/地址/id 都跟着下标走。
 */
export function currentAssetPreview(): AssetPreviewItem | null {
  const cur = assetPreview.value
  if (!cur?.list?.length) return cur
  const i = Math.min(Math.max(cur.index ?? 0, 0), cur.list.length - 1)
  return {
    ...cur,
    index: i,
    url: cur.list[i],
    ...(cur.names?.[i] ? { name: cur.names[i] } : {}),
    ...(cur.ids?.[i] ? { id: cur.ids[i] } : {}),
  }
}

/**
 * 打开一份**资产**的预览（左侧抽屉 / 资产管理弹窗的行点击共用这一条）。
 *
 * 为什么要收成一个函数（用户口径 2026-10-14：「我当前的节点无法进行预览。
 * 或者，可以在预览中添加一个 iframe 预览框」）：
 * 节点包（.mcnode）**没有可加载的媒体地址** —— 照旧把它的 url 丢给 MediaViewer，
 * 预览出来是一片空白（那就是用户看到的"无法预览"）。它得先**取回包、解出里面的 HTML**，
 * 再交给 MediaViewer 的 iframe 分支渲染。
 *
 * 普通图片/视频/音频走原路（直接给 url）；取包失败回一条**说人话**的预览
 * （而不是静默什么都不显示 —— 那又成了"点了没反应"）。
 */
export async function openAssetPreviewFromAsset(
  item: {
    id?: string
    name: string
    url: string
    kind?: string
    assetKind?: string
  },
  /**
   * 同层列表（可选）：用户口径 2026-10-14「全局预览都提供一个列表，可以通过左右快捷键来回切换」。
   * 由 composables/assetSiblings.ts 从树的可见行里算出来（只收同一层的文件），
   * 这里原样转交给 MediaViewer —— 它自带 ← / → 与页码，不必在资产这边另写切换。
   * 单张时调用方不必传（或传了也进不去，见下面的 length > 1 判定）。
   */
  group?: { list: string[]; names?: string[]; ids?: string[]; index?: number },
): Promise<void> {
  const { list, names, ids, index } = group ?? {}
  const kind = assetKindOf(item)
  if (kind !== 'node-package') {
    openAssetPreview({
      ...(item.id ? { id: item.id } : {}),
      name: item.name,
      kind,
      url: item.url,
      ...(list && list.length > 1
        ? {
            list,
            ...(names && names.length === list.length ? { names } : {}),
            ...(ids && ids.length === list.length ? { ids } : {}),
            index: Math.min(Math.max(index ?? 0, 0), list.length - 1),
          }
        : {}),
    })
    return
  }
  try {
    const pack = await peekPack(item.url)
    openAssetPreview({
      ...(item.id ? { id: item.id } : {}),
      name: item.name,
      // 'ui' 是 MediaViewer 里那个 iframe 分支的 kind（见其模板）
      kind: 'ui',
      html: pack.html,
    })
  } catch (err) {
    openAssetPreview({
      ...(item.id ? { id: item.id } : {}),
      name: item.name,
      kind: 'text',
      text: '这个节点包读不出来：' + (err instanceof Error ? err.message : String(err)),
    })
  }
}

/**
 * 打开资产管理弹窗并定位到某一层。
 *
 * fromRef 默认 true = 「从引用标签跳进来」：折叠到只剩选中那条链 + 给引导提示。
 * 侧边栏那个「资产管理」按钮传 false：保持原本的全展开、不弹提示。
 */
export function openAssetManager(folderId?: string, opts: { fromRef?: boolean } = {}): void {
  const fromRef = opts.fromRef !== false
  assetManager.value = {
    open: true,
    ...(folderId ? { folderId } : {}),
    fromRef,
    focusToken: assetManager.value.focusToken + 1,
  }
}

/** 关闭（弹窗自己点 ✕ / 遮罩 / Esc 时调） */
export function closeAssetManager(): void {
  assetManager.value = { ...assetManager.value, open: false }
}
