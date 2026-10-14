/**
 * clipboardActions —— 剪贴板「复制/剪切/粘贴」的多路仲裁（注册场，按 order 排序，先声明者先接管）。
 *
 * 放在 canvas-data（而非 canvas-render）的理由：本文件是**纯逻辑**（类型 + 纯函数 + DOM 事件类型），
 * 两个参与方（plugin-clipboard / plugin-file-drop）都是逻辑插件，只依赖 canvas-base；契约住在上游，
 * 它们就不必 import 渲染包（与 renderServiceContracts 同一条边界原则）。宿主 canvas-render 是
 * canvas-data 的下游，照样能用。
 *
 * 背景（用户报的缺陷）：
 * 画布有两个插件都想响应 Ctrl/Cmd+V ——
 * - plugin-clipboard：粘贴**画布内存里复制的节点**（数据层快照，不需要 DOM）；
 * - plugin-file-drop：把**系统剪贴板里的图片/视频/文本**建成节点（只有原生 paste 事件读得到）。
 *
 * 这两条路过去各走各的：clipboard 把 Ctrl+V 注册成一条命令，宿主 keydown 命中后
 * preventDefault。而真机实测表明：**在 keydown 里 preventDefault 会让浏览器根本不派发原生的
 * paste 事件**。于是 file-drop 的路被彻底掐死 —— 无论你往系统剪贴板放了什么（比如一张图），
 * Ctrl+V 永远只粘贴内存里的旧节点快照。这就是用户看到的"复制的图片贴不进来，反倒贴出旧的节点"。
 *
 * 解法（用户要求："让一个快捷键可以有多种功能，可以注册一个先后顺序"）：
 * 1. **命令可声明 deferToNative**（kernel CommandDef）：命中该键时宿主不 preventDefault、不 execute，
 *    放行给浏览器派发原生剪贴板事件；
 * 2. **复制/剪切/粘贴各走一个注册场**（本文件的 kind）：谁想参与就注册一个处理器，用 order 声明
 *    优先级（小者先）。宿主只绑**各一个**原生监听，读到事件后按 order 依次问处理器"这次归你吗"，
 *    第一个接管的赢，其余不再问。
 *
 * 为什么复制/剪切也要仲裁：粘贴时"该贴什么"取决于**用户最后一次复制的是什么**，而系统剪贴板是
 * 这件事的唯一事实来源。复制（Ctrl+C/Ctrl+X 在画布上）也要往系统剪贴板写一个标记，粘贴时据它
 * 判定"最后复制的是画布节点，还是外部拷来的图片/文本"。否则节点快照与系统剪贴板里的旧内容会
 * 互相打架，问题只是换了个方向重现。标记写入走**原生 copy 事件**（同步、无需权限、不竞态）。
 *
 * 谁注册、谁先（粘贴，order 小者先）：
 * - clipboard 的画布节点（10）—— 剪贴板带画布标记时，一定是刚在画布上复制的；
 * - file-drop 的图片/视频（20）—— 外部拷来的媒体；
 * - file-drop 的纯文本（30）—— 最泛，最后兜底。
 *
 * 跨页面互粘（用户 2026-10-12 报的"复制一个节点，无法在另一个浏览器页面粘贴"）：
 * 剪贴板载荷里带**完整节点/边**（见下方 canvasClipboardPayload），另一个页面读它即可贴出节点，
 * 不依赖任何内存态。媒体地址按 data.resourceId 重建（blob: 地址只属于原来那个页面）。
 */

// ---------------------------------------------------------------------------
// 场名与协议常量
// ---------------------------------------------------------------------------

/** 注册场 kind：粘贴仲裁 */
export const CLIPBOARD_PASTE_KIND = 'clipboard/paste'
/** 注册场键（粘贴动作只有一个，键固定） */
export const CLIPBOARD_PASTE_KEY = 'paste'

/** 注册场 kind：复制/剪切写剪贴板仲裁 */
export const CLIPBOARD_COPY_KIND = 'clipboard/copy'
/** 注册场键：复制（Ctrl/Cmd+C） */
export const CLIPBOARD_COPY_KEY = 'copy'
/** 注册场键：剪切（Ctrl/Cmd+X） */
export const CLIPBOARD_CUT_KEY = 'cut'

/**
 * 画布节点快照写入系统剪贴板的标记 MIME（值是小 JSON：{v, nodes, edges}）。
 *
 * 它既是仲裁标记（"最后这次复制来自画布"），也是**跨窗口传数据的唯一通道**：
 * v2 起值里带完整节点/边载荷（见 canvasClipboardPayload），另一个浏览器页面读它就能贴出节点。
 */
export const CANVAS_CLIPBOARD_MIME = 'application/x-mini-canvas-nodes'
/**
 * 伴侣文本前缀：兜底让只认 text/plain 的场景也能识别这次复制来自画布。
 *
 * 为什么 text/plain 里也放**完整载荷**（不是只有标记）：程序化复制（右键菜单 / 脚本调
 * clipboard.copy()）走的是 navigator.clipboard.writeText —— 那条路**只能写 text/plain**，
 * 自定义 MIME 写不进去（浏览器只允许它经原生 copy 事件的 setData 落地）。若 text/plain 里
 * 只有标记，菜单复制后在另一个页面粘贴就只剩个"来自画布"的空标记，什么也贴不出来。
 */
export const CANVAS_CLIPBOARD_TEXT_PREFIX = 'mini-canvas-nodes:'

/** 画布快照载荷版本（v2 = 带完整节点/边，可跨窗口） */
export const CANVAS_CLIPBOARD_PAYLOAD_VERSION = 2

/** 从剪贴板读回的画布快照原始载荷（结构由消费方校验，见 plugin-clipboard 的 coerceClipboardSnapshot） */
export interface CanvasClipboardPayload {
  /** 快照节点（只要求是对象；字段校验交给消费方） */
  nodes: unknown[]
  /** 快照边（同上） */
  edges: unknown[]
  /**
   * 复制时刻（写载荷的实例的 Date.now()）。
   *
   * 用途：同一页面里"自己刚复制的"与"从别的页面复制来的"要分开对待 —— 前者的内存快照与本页
   * 同源（blob: 地址在本页有效、无需重建），后者必须按资源引用重建地址。靠它比对即可分辨。
   */
  copyTime?: number
}

/**
 * 生成写进系统剪贴板的**完整载荷**（节点 + 边）。
 *
 * 为什么把节点数据本身放上剪贴板（而不是只放个标记、数据留在插件内存）：内存快照是
 * **按画布实例**隔离的（P2-4），另一个浏览器页面 / 标签页里根本没有这份内存 —— 用户
 * 2026-10-12 报的"复制一个节点，无法在另一个浏览器页面粘贴"就是它。系统剪贴板是唯一在
 * 两个页面之间同时存在的东西，跨窗口互贴只能把数据放它上面。
 */
export function canvasClipboardPayload(
  nodes: readonly unknown[],
  edges: readonly unknown[],
  copyTime?: number,
): string {
  return JSON.stringify({
    v: CANVAS_CLIPBOARD_PAYLOAD_VERSION,
    ...(copyTime !== undefined ? { copyTime } : {}),
    nodes,
    edges,
  })
}

/**
 * 解析剪贴板里的载荷文本（自定义 MIME 是裸 JSON；text/plain 带前缀）。
 * 不是画布载荷（外部文本 / 标记 JSON）一律返回 undefined —— 判据是"带 nodes/edges 两个数组"。
 */
export function parseCanvasClipboardText(text: string | undefined | null): CanvasClipboardPayload | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined
  const body = text.startsWith(CANVAS_CLIPBOARD_TEXT_PREFIX)
    ? text.slice(CANVAS_CLIPBOARD_TEXT_PREFIX.length)
    : text
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const nodes = (parsed as { nodes?: unknown }).nodes
  const edges = (parsed as { edges?: unknown }).edges
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return undefined
  const copyTime = (parsed as { copyTime?: unknown }).copyTime
  return typeof copyTime === 'number' && Number.isFinite(copyTime)
    ? { nodes, edges, copyTime }
    : { nodes, edges }
}

/**
 * 从一次粘贴载荷里读出画布快照（先自定义 MIME，再 text/plain 前缀兜底）。
 *
 * 两条都读不到 = 剪贴板里不是画布节点（外部拷来的图片/文本），调用方据此让位给 file-drop。
 */
export function readCanvasClipboardPayload(
  payload: ClipboardPastePayload,
): CanvasClipboardPayload | undefined {
  const fromMime = parseCanvasClipboardText(payload.getData(CANVAS_CLIPBOARD_MIME))
  if (fromMime) return fromMime
  return parseCanvasClipboardText(payload.getData('text/plain'))
}

// ---------------------------------------------------------------------------
// 复制/剪切载荷与处理器
// ---------------------------------------------------------------------------

/** 一次复制/剪切事件（宿主归一后交给各处理器） */
export interface ClipboardWritePayload {
  /** 原生 copy/cut 事件 */
  event: ClipboardEvent
  /**
   * 往系统剪贴板写一项；返回是否成功（无 clipboardData 时 false）。
   * 处理器只调它，不直接摸 event.clipboardData —— 写口单一，便于测试替换。
   */
  write(mime: string, data: string): boolean
}

/**
 * 复制/剪切处理器：**同步**返回是否接管这次复制。
 * 不接管（返回 false）= 放行浏览器默认行为（复制页面选中的文字等）。
 */
export type ClipboardWriteHandler = (payload: ClipboardWritePayload) => boolean

// ---------------------------------------------------------------------------
// 粘贴载荷与处理器
// ---------------------------------------------------------------------------

/**
 * 一次粘贴事件（宿主读一次原生事件、归一后交给各处理器；处理器不再各自解析 event）。
 *
 * 内容快照都**同步**可得（真机验证：paste 事件里 getData 同步可读）—— 因为"归不归我"必须当场判定。
 */
export interface ClipboardPastePayload {
  /** 原生 paste 事件（读 clipboardData / 阻止默认行为） */
  event: ClipboardEvent
  /** clipboardData.files 快照（系统剪贴板里的图片/视频/文本文件；同步可得） */
  files: File[]
  /** 剪贴板 MIME 类型列表（同步可得） */
  types: string[]
  /** 剪贴板里 string 项的 MIME 列表（同步可得；判"有没有文本"用它比 types 稳） */
  stringTypes: string[]
  /** 同步读某个 MIME 的内容（无则空串） */
  getData(mime: string): string
  /** 读某个 string 项的内容（如 'text/plain'）；项不存在或读失败返回空串 */
  readText(mime: string): Promise<string>
}

/**
 * 粘贴处理器：**同步**返回是否接管这次粘贴。
 *
 * 为什么返回同步 boolean：仲裁必须在事件处理栈里当场决定（要不要 preventDefault、谁来处理），
 * 不能等异步。需要异步干活的处理器（读文件、建节点）在返回 true **之后**自己异步做。
 */
export type ClipboardPasteHandler = (payload: ClipboardPastePayload) => boolean

/** 场里一条（只取派发需要的形状：value；order 已由 RegistryImpl 排好序） */
export interface ClipboardEntry<T> {
  value: T
}

// ---------------------------------------------------------------------------
// 归一与派发（纯函数，Node 可单测）
// ---------------------------------------------------------------------------

/** 从 items 里提取 'file' 项（仅在 clipboardData.files 为空时兜底用） */
function fileItemsOf(items: DataTransferItem[]): File[] {
  const out: File[] = []
  for (const item of items) {
    if (item.kind === 'file') {
      const f = item.getAsFile?.()
      if (f) out.push(f)
    }
  }
  return out
}

/** 把原生 copy/cut 事件归一成写载荷 */
export function buildClipboardWritePayload(event: ClipboardEvent): ClipboardWritePayload {
  const dt = event.clipboardData
  return {
    event,
    write(mime: string, data: string): boolean {
      if (!dt) return false
      try {
        dt.setData(mime, data)
        return true
      } catch {
        return false
      }
    },
  }
}

/** 把原生 paste 事件归一成读载荷 */
export function buildClipboardPastePayload(event: ClipboardEvent): ClipboardPastePayload {
  const dt = event.clipboardData
  const items = dt?.items ? Array.from(dt.items) : []
  // 文件只有**一份**事实来源，优先 clipboardData.files（它是完整列表）。
  //
  // 为什么不能把 files 与 items 合并：真机实测 —— 粘贴一张图时 clipboardData.files 有 1 个 File，
  // items 里也有 1 个 'file' 项，但 item.getAsFile() 返回的是**另一个 File 对象**（内容相同、
  // 引用不同）。按对象身份去重对它们无效，结果同一张图被算成两份 → 粘贴建出两个节点
  // （用户 2026-10-10 报的"一张图贴出两张"）。故只在 files 为空时才回落到 items。
  const fromFiles = dt ? Array.from(dt.files ?? []) : []
  const files = fromFiles.length > 0 ? fromFiles : fileItemsOf(items)
  const types = dt ? Array.from(dt.types ?? []) : []
  const stringTypes = items.filter((i) => i.kind === 'string').map((i) => i.type)
  return {
    event,
    files,
    types,
    stringTypes,
    getData(mime: string): string {
      if (!dt) return ''
      try {
        return dt.getData(mime) ?? ''
      } catch {
        return ''
      }
    },
    readText(mime: string): Promise<string> {
      if (!dt) return Promise.resolve('')
      for (const item of items) {
        if (item.kind === 'string' && item.type === mime) {
          return new Promise<string>((resolve) => {
            try {
              item.getAsString((s) => resolve(s ?? ''))
            } catch {
              resolve('')
            }
          })
        }
      }
      // 回落到 getData（部分浏览器只给 getData 路径）
      try {
        return Promise.resolve(dt.getData(mime) ?? '')
      } catch {
        return Promise.resolve('')
      }
    },
  }
}

/**
 * 写剪贴板仲裁：按 order 升序问每个处理器，第一个接管的赢。
 *
 * 接管时一并 preventDefault：否则浏览器会用它自己的默认内容（页面选中的文字等）**覆盖**
 * 处理器刚写进去的标记 —— 那会让"最后一次复制来自画布"这条判定失效。
 *
 * @returns 是否被某个处理器接管（false = 放行浏览器默认行为）
 */
export function dispatchClipboardWrite(
  entries: readonly ClipboardEntry<ClipboardWriteHandler>[],
  payload: ClipboardWritePayload,
): boolean {
  for (const entry of entries) {
    let claimed = false
    try {
      claimed = entry.value(payload)
    } catch {
      /* 单个处理器抛错只跳过它，不阻断后续候选（与注册场"坏订阅者不误伤别人"同原则） */
      continue
    }
    if (claimed) {
      try {
        payload.event.preventDefault()
      } catch {
        /* preventDefault 失败不影响"已被接管"这一事实 */
      }
      return true
    }
  }
  return false
}

/**
 * 粘贴仲裁：按 order 升序问每个处理器，第一个接管的赢并 preventDefault，后面的不再问。
 * @returns 这次粘贴是否被某个处理器接管
 */
export function dispatchClipboardPaste(
  entries: readonly ClipboardEntry<ClipboardPasteHandler>[],
  payload: ClipboardPastePayload,
): boolean {
  for (const entry of entries) {
    let claimed = false
    try {
      claimed = entry.value(payload)
    } catch {
      continue
    }
    if (claimed) {
      try {
        payload.event.preventDefault()
      } catch {
        /* preventDefault 失败不影响"已被接管"这一事实 */
      }
      return true
    }
  }
  return false
}

/** 剪贴板里是否带"来自画布"的标记（同步判定，粘贴仲裁用） */
export function hasCanvasClipboardMarker(payload: ClipboardPastePayload): boolean {
  if (payload.types.includes(CANVAS_CLIPBOARD_MIME)) return true
  // 兜底：只认 text/plain 的场景看前缀
  const text = payload.getData('text/plain')
  return typeof text === 'string' && text.startsWith(CANVAS_CLIPBOARD_TEXT_PREFIX)
}

/** 生成写进剪贴板的画布标记值（小 JSON） */
export function canvasClipboardMarker(nodeCount: number, edgeCount: number): string {
  return JSON.stringify({ v: 1, nodes: nodeCount, edges: edgeCount })
}
