/**
 * customCursors —— 用户**自己上传**的光标素材（图片 / SVG / 帧序列）。
 *
 * 为什么单独存 localStorage、而不是塞进内核 settings：
 * - 上传的是图片/SVG 的 data URL，体积可达几百 KB，而 settings 会随 settingsPersist 同步到云端 KV；
 *   把大二进制塞进去会把「配置」撑爆。这里用本机 localStorage，只把"当前用哪一个"这个**小 ID** 放进 settings。
 * - 帧序列（多张图）本质就是一组 data URL，也一并放这里。
 *
 * 数据结构：一条 = 一个自定义光标，`frames` 是它的帧（1 张 = 静态，多张 = 逐帧动画）。
 */
export interface CustomCursor {
  /** 稳定 id（进 settings 的 `cursorFxCustomId`） */
  id: string
  name: string
  /** 帧序列：data URL；长度 1 = 静态图，>1 = 逐帧动画 */
  frames: string[]
  /** 播放帧率（仅多帧时有意义） */
  fps: number
  /** 热点占边长的比例（0~1） */
  hx: number
  hy: number
}

const KEY = 'mc-cursor-effect:custom-cursors'
/** 自定义素材变化时广播的事件名（设置页写、渲染层听，立即生效） */
export const CUSTOM_CHANGED_EVENT = 'mc-cursor-effect:custom-changed'

/**
 * 内存兜底。
 *
 * 为什么必须有：有些环境**禁用了 localStorage**（隐私模式、沙箱 iframe、某些内置浏览器），
 * 此时 `localStorage` 直接是 undefined —— 上传的素材存不下来，选中自定义光标就变成**空白**。
 * 有内存兜底后，至少**本次会话内**上传→选中→显示整条链是通的（刷新后丢，并给出提示）。
 */
let memory: CustomCursor[] | null = null

/** 可用的 localStorage；不可用（被禁用/无 window）返回 null，绝不抛。 */
function ls(): Storage | null {
  try {
    const t = '__ce_probe__'
    window.localStorage.setItem(t, '1')
    window.localStorage.removeItem(t)
    return window.localStorage
  } catch {
    return null
  }
}

/** 当前是否能用 localStorage 持久化（false = 只在内存里，刷新会丢）。 */
export function isPersistent(): boolean {
  return ls() !== null
}

/** 读全部自定义光标（损坏/不可用时返回空数组，不抛） */
export function loadCustomCursors(): CustomCursor[] {
  const store = ls()
  if (!store) return memory ?? []
  try {
    const raw = store.getItem(KEY)
    if (!raw) return memory ?? []
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return memory ?? []
    return list.filter((c): c is CustomCursor =>
      !!c && typeof c === 'object' && typeof (c as CustomCursor).id === 'string' && Array.isArray((c as CustomCursor).frames),
    )
  } catch {
    return memory ?? []
  }
}

/**
 * 写回并广播（设置页改完调它；渲染层监听到就重读）。
 * **总是先写内存兜底**，所以即便 localStorage 不可用/配额满，本次会话内也能正常用；
 * 只是那种情况下会带回 `warning`，提示刷新后会丢。
 */
export function saveCustomCursors(list: CustomCursor[]): { ok: boolean; error?: string; warning?: string } {
  memory = list
  const store = ls()
  if (!store) {
    try { window.dispatchEvent(new CustomEvent(CUSTOM_CHANGED_EVENT)) } catch { /* no window */ }
    return { ok: true, warning: '当前环境不支持本地存储：素材只在本次会话有效，刷新后会丢' }
  }
  try {
    store.setItem(KEY, JSON.stringify(list))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 存不下（配额满）也照样能用，只是刷新会丢
    try { window.dispatchEvent(new CustomEvent(CUSTOM_CHANGED_EVENT)) } catch { /* no window */ }
    return { ok: true, warning: /quota|exceed/i.test(msg) ? '素材偏大，本次会话有效，刷新后可能丢' : msg }
  }
  try { window.dispatchEvent(new CustomEvent(CUSTOM_CHANGED_EVENT)) } catch { /* SSR/无 window */ }
  return { ok: true }
}

export function newCustomId(): string {
  return 'custom-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36)
}

/** 新增一条（返回新列表与它） */
export function addCustomCursor(list: CustomCursor[], cursor: Omit<CustomCursor, 'id'> & { id?: string }): { list: CustomCursor[]; item: CustomCursor; warning?: string } {
  const item: CustomCursor = { ...cursor, id: cursor.id ?? newCustomId() }
  const next = [...list, item]
  const res = saveCustomCursors(next)
  // 内存兜底已保证"能用"；res.warning 只用于提示"刷新后会丢"
  return { list: next, item, warning: res.warning }
}

export function removeCustomCursor(list: CustomCursor[], id: string): CustomCursor[] {
  const next = list.filter((c) => c.id !== id)
  saveCustomCursors(next)
  return next
}

export function updateCustomCursor(list: CustomCursor[], id: string, patch: Partial<CustomCursor>): CustomCursor[] {
  const next = list.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c))
  saveCustomCursors(next)
  return next
}

/** 读取文件为 data URL（图片 / SVG 都走这条路） */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/**
 * 归一化上传的素材：
 * - **SVG**：保留矢量原样（不栅格化，保持清晰）。
 * - **位图**（png/jpg/webp/gif/bmp…）：画进 canvas **缩放到 maxEdge 内并重编码为 PNG**。
 *   为什么必须这样做：用户随手一张手机照片就是几 MB，原样塞进 localStorage 要么爆配额、
 *   要么格式/编码不被 <img> 接受（就是"上传了但显示破图"的成因）。缩放后只剩几 KB，且必然是能渲染的 PNG。
 * 任何一步失败都回落到原 data URL（至少不丢用户的东西）。
 */
export function normalizeUpload(file: File, maxEdge = 160): Promise<string> {
  return readFileAsDataUrl(file).then((raw) => {
    if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) return raw
    return new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => {
        try {
          const w = img.naturalWidth || maxEdge
          const h = img.naturalHeight || maxEdge
          const scale = Math.min(1, maxEdge / Math.max(w, h))
          const cw = Math.max(1, Math.round(w * scale))
          const ch = Math.max(1, Math.round(h * scale))
          const c = document.createElement('canvas')
          c.width = cw; c.height = ch
          const g = c.getContext('2d')
          if (g) {
            g.drawImage(img, 0, 0, cw, ch)
            resolve(c.toDataURL('image/png'))
            return
          }
        } catch { /* 画不出来就回落原图 */ }
        resolve(raw)
      }
      img.onerror = () => resolve(raw)
      img.src = raw
    })
  })
}
