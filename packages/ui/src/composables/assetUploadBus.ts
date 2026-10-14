/**
 * assetUploadBus —— 「把画布上的图贴进上传弹窗」的共享总线（两个入口 + 弹窗宿主三处共用）。
 *
 * 用户口径（2026-10-07）：「注册一个右键菜单，功能是加入资产库，点击之后功能和左侧侧边栏点击一样，
 * 上传资产把图片贴入进去；然后再注册一个多选的顶端控制按钮，功能也是一样只不过是可以贴入多张图」。
 *
 * 三个角色：
 *   · 入口 A：节点右键「加入资产库」（uiAssetUploadPlugin 注册的命令）→ 贴 1 张；
 *   · 入口 B：多选上控制栏「加入资产库」（SelectionSaveAssetsToolbar）→ 贴 N 张；
 *   · 宿主：AssetUploadHost（挂在 App 里）→ 打开上传弹窗并消费这些图。
 *   · 入口 C：底栏「+ → 添加资源」→ **不开预填、直接开窗**让用户自己选（见 openUploadDialog）。
 *
 * 为什么需要一条总线：两个入口分别在"插件上下文"和"多选框浮层"里，而上传弹窗与资产清单是
 * 成品应用的（只有 packages/ui 拿得到 assets 服务）。总线是三者唯一共享的通道 ——
 * 入口只写"要传哪几张"，宿主读走并开弹窗。
 */
import { ref } from 'vue'

export interface PendingUpload {
  /** 图地址（同源 /api/...，或跨域 http://...）；与 file 二选一 */
  url?: string
  /**
   * 本地选好的一份文件（**不是从 URL 取的**）。
   *
   * 谁用它：节点包「收藏到资产库」—— 包是后台刚打出来的字节，
   * 拼成 File 预填进弹窗（用户可改名/选位置/打标签），而不是先传一次再拉回来。
   */
  file?: File
  /** 建议文件名 */
  name: string
  /**
   * 打开弹窗时要**预选**的标签（可省）。
   *
   * 谁用它：节点包「收藏到资产库」—— 用户口径 2026-10-14：「如果是节点收藏资源库的话，
   * 打开这个弹出框，你这边的类型可以自动选择这个节点」。所以那条路会把「节点」预勾上。
   */
  tags?: string[]
  /**
   * 打开弹窗时要**预选**的保存位置（可省；不传 = 个人资产库根）。
   *
   * 谁用它：节点包「收藏到资产库」—— 用户口径 2026-10-14：「文件地址：默认选择根目录下的
   * 一个节点库，如果没有，则自动创建」。
   */
  folderId?: string
}

/** 待贴入的图（宿主消费后清空） */
export const pendingUploads = ref<PendingUpload[]>([])

let notify: (() => void) | null = null

/** 宿主注册自己的"有人要传图"回调（App 挂载时调；卸载传 null） */
export function onUploadRequested(cb: (() => void) | null): void {
  notify = cb
}

/** 贴入若干张图并请求打开弹窗 */
export function queueUploads(items: PendingUpload[]): void {
  // 有地址或**有本地文件**都算一项（节点包那条路只有 file）
  const list = items.filter((x) => x.url || x.file)
  if (!list.length) return
  pendingUploads.value = [...pendingUploads.value, ...list]
  notify?.()
}

/**
 * 底栏「+ → 添加资源」：**不开预填**，直接把上传资产弹窗打开，让用户在里面自己选文件。
 *
 * 用户口径（2026-10-11）：「点击『添加资源』= 打开上传资产弹窗」——与「上传」是两件事：
 * 「上传」选完直接落画布（见 ui.addFilesToCanvas），「添加资源」走这个弹窗（改名 / 选保存位置 /
 * 打标签 → 存进资产库）。宿主（AssetUploadHost）收到通知后按空清单开窗，
 * 于是弹窗里就是那个熟悉的「+」格 + 名称 / 位置 / 标签，与左侧抽屉「+ → 上传资产」完全一致。
 */
export function openUploadDialog(): void {
  // 先把可能残留的旧预填清掉：这次要的是干净开窗（不贴任何画布图）
  pendingUploads.value = []
  notify?.()
}

/** 宿主取走待传清单（取完即清） */
export function drainUploads(): PendingUpload[] {
  const out = pendingUploads.value
  pendingUploads.value = []
  return out
}

/**
 * 从节点 id 列表里提取可上传的媒体，贴进总线 —— 节点右键 / 多选两条入口共用这一段。
 *
 * ⚠️ **必须认全三类媒体**（用户 2026-10-14 报的「加入资产库点击没有任何反应」就是这里）：
 * 早先只读 `imageUrl` / `resourceUrl`，而视频节点存的是 `videoUrl`、音频存 `audioUrl` ——
 * 于是右键一个视频节点时取的地址是空串、静默什么都不做。图片没事，所以这个 bug 一直没显形。
 */
export function queueUploadsFromNodeIds(
  ids: string[],
  getNode: (id: string) => { id: string; type?: string; data?: Record<string, unknown> } | undefined,
): void {
  const items: PendingUpload[] = []
  for (const id of ids) {
    const node = getNode(id)
    // 节点的显示名住在 data.label（见 nodeStore.nextDefaultName；data.name 是另一回事）
    const data = (node?.data ?? {}) as Record<string, unknown>
    // 三类媒体字段一次认全（图片 / 视频 / 音频）；resourceUrl 是历史别名，留着兜底
    const pick = (k: string): string => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : '')
    const url = pick('imageUrl') || pick('videoUrl') || pick('audioUrl') || pick('resourceUrl')
    // 没有媒体地址的节点（文本 / 可视化节点等）**贴不进去** —— 那就明确说一句，
    // 别像以前那样静默什么都不做（用户以为"点了没反应"是坏的）。
    if (!url) {
      const label = typeof data.label === 'string' && data.label ? data.label : id
      // eslint-disable-next-line no-console
      console.warn('[资产] 节点「' + label + '」没有可上传的媒体地址（图片/视频/音频字段都为空），跳过')
      continue
    }
    const label = typeof data.label === 'string' && data.label
      ? data.label
      : typeof data.name === 'string' && data.name
        ? data.name
        : ''
    // 名字里带扩展名更友好（上传弹窗拿它当文件名）；没扩展名就按**媒体的真实类型**补一个 ——
    // 早先一律补 .png，视频会被当成图（用户 2026-10-14 报的问题之一）。
    const fallbackExt = pick('videoUrl') ? '.mp4' : pick('audioUrl') ? '.mp3' : '.png'
    const ext = /\.[a-z0-9]+$/i.test(label) || !label ? '' : fallbackExt
    const name = label ? label + ext : 'node-' + id + fallbackExt
    items.push({ url, name })
  }
  queueUploads(items)
}
