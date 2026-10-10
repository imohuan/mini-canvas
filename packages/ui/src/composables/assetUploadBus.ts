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
  /**
   * **本地文件**（底栏「+ → 上传」选的）：有它就优先用这一个，url 只是展示用的预览地址。
   *
   * 为什么要多一种荷载：弹窗同时支持"贴画布图"（拉地址再传）与"选本地文件"
   * （字节直接在手，不用先落成地址再取回来）；两者在弹窗里长得一样、保存时各走各的通道。
   */
  file?: File
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
 * 底栏「+ → 上传」：把**本地选的一批文件**交给同一个上传弹窗（用户口径 2026-10-11
 * 「这边可以上传多个文件，支持图片、视频、音频批量上传」）。
 *
 * 为什么并到这条总线：上传弹窗 + 落库口径只该有一份。底栏菜单、节点右键、多选上控制栏
 * 三条入口都只负责"把要传的东西放进来"，弹窗宿主（AssetUploadHost，常驻挂载）负责开窗。
 * 这里不造预览地址：弹窗对**本地文件**会自己 createObjectURL（同「+」格手选那一条），
 * 不重复造一个没人回收的 blob:。
 */
export function queueUploadFiles(files: File[]): void {
  const items: PendingUpload[] = []
  for (const f of files) if (f.size > 0) items.push({ url: '', name: f.name, file: f })
  if (!items.length) return
  pendingUploads.value = [...pendingUploads.value, ...items]
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
