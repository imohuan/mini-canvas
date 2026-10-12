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
  /** 图地址（同源 /api/...，或跨域 http://...） */
  url: string
  /** 建议文件名 */
  name: string
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
  const list = items.filter((x) => x.url)
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

/** 从节点 id 列表里提取可上传的图（图片节点），贴进总线 —— 两个入口共用这一段 */
export function queueUploadsFromNodeIds(
  ids: string[],
  getNode: (id: string) => { id: string; data?: Record<string, unknown> } | undefined,
): void {
  const items: PendingUpload[] = []
  for (const id of ids) {
    const node = getNode(id)
    // 节点的显示名住在 data.label（见 nodeStore.nextDefaultName；data.name 是另一回事）
    const data = (node?.data ?? {}) as { imageUrl?: unknown; resourceUrl?: unknown; name?: unknown; label?: unknown }
    const url = typeof data.imageUrl === 'string' && data.imageUrl
      ? data.imageUrl
      : typeof data.resourceUrl === 'string' && data.resourceUrl
        ? data.resourceUrl
        : ''
    if (!url) continue
    const label = typeof data.label === 'string' && data.label
      ? data.label
      : typeof data.name === 'string' && data.name
        ? data.name
        : ''
    // 名字里带扩展名更友好（上传弹窗拿它当文件名），没有扩展名就按图的类型补一个
    const ext = /\.[a-z0-9]+$/i.test(label) || !label ? '' : '.png'
    const name = label ? label + ext : 'node-' + id + '.png'
    items.push({ url, name })
  }
  queueUploads(items)
}
