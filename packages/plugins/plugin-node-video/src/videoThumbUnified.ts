/**
 * videoThumbUnified —— **唯一的**视频缩略图服务（模块级共享，所有消费方都走它）。
 *
 * 口径（用户 2026-10-30）：
 * - 一个视频**只有一张**缩略图：名字只跟"源"绑定，不带时刻/档位 ——
 *   视频节点、左侧栏、底栏卡片、输入框标签、标签下拉菜单全都复用这一张，
 *   重启 / 重开画布后资源库 resolve 直接命中，永不重新解码。
 * - 生成走 captureVideoThumb（跳过纯色片头的那套），黑图/白图从源头规避。
 * - 生成一次 → resources.put(固定 ref, derived) 存库 → 以后全是 resolve 命中。
 * - 同会话并发只生成一次（单飞 Promise），消费方共用同一份结果。
 */
import { captureVideoThumb, VIDEO_THUMB_MAX_WIDTH } from './videoThumbService'
import { hash32 } from './videoThumbKey'

/** 资源库端口（与 FrameCache 那份同形状：存字节 + 按引用取地址） */
export interface ThumbResourcePort {
  put(blob: Blob, opts: { kind?: string; name?: string; ref?: string; derived?: boolean }): Promise<string>
  resolve(ref: string): Promise<string | undefined>
}

/**
 * 统一缩略图的资源引用名规则（用户 2026-10-31 定案）。
 *
 *   vthumb-<源哈希>-v4t<档位>w<宽>h<高>q<质量>
 *
 * ## 关键口径：**缩略图永远是整张原片，不带裁剪**
 *
 * 用户原话：「这里让你提供一份默认的缩略图，就是不携带参考的」。
 * 理由很实在 —— 一张全站共用的图，不能是"某个节点当时裁成什么样"的产物：
 * - 左侧栏 / 底栏 / 标签只拿到视频地址，压根不知道节点裁了哪里；
 * - 同一段视频在两个节点上裁法不同，就会变成两张图，"一个视频一张图"就破了。
 *
 * 所以：**生成一律整幅**；节点上看起来是裁过的那块，由显示端用 CSS 取景实现
 * （视频本来就是这么做的，见 VideoContent 的 framingStyle）。
 *
 * 各段进名字的理由：
 * - **源哈希**：不同视频当然不同图；
 * - **档位 + 宽高**：用户改「第二/三档宽高」要重生成，否则一直用旧尺寸的图
 *   （2026-10-15 用户实测报过）。三档各按自己配置的宽高生成，各自一份。
 *   **第 1 档不写宽高** —— 它的框就是源画面本身，而视频节点知道源尺寸、
 *   左侧栏 / 底栏只有地址。写进名字就会算出两个名字、各存一张，复用就破了；
 * - **质量**：改清晰度同理；
 * - **版本号**：算法一变就 +1，历史坏图自动作废。
 */
const THUMB_VERSION = 4

/** 统一缩略图的身份：只描述"要多大、多清晰"，不描述"看哪一块" */
export interface ThumbIdentity {
  /** 档位（1 原生 / 2 中 / 3 小）。缺省 1 */
  tier?: 1 | 2 | 3
  /** 目标框宽高（像素）；缺省 = 源画面尺寸（第 1 档） */
  width?: number
  height?: number
  /** 编码质量 0-1；缺省 0.8 */
  quality?: number
  /**
   * 源画面尺寸（只用来算缩放比例，**不进名字**）。
   *
   * 为什么不进名字：视频节点知道自己视频多大，左侧栏 / 底栏只有地址。
   * 一旦进名字，同一个视频就会算出两个名字、存两张图 —— 复用的前提就破了。
   * 好在同一段视频的源尺寸是固定的，用它算比例不会造成"同名不同图"。
   */
  frameWidth?: number
  frameHeight?: number
}

/**
 * 源地址规范化：**同一个视频必须算出同一个名字**。
 *
 * 为什么需要（用户口径「一个视频一张图，全站复用」）：
 * 同一个视频在不同地方拿到的写法不一样 —— 视频节点里是资源服务给的相对路径
 * （`/api/canvases/x/resources/abc.mp4`），左侧栏 / 底栏卡片可能是绝对地址
 * （`http://127.0.0.1:8865/api/...`）。按原字符串算哈希等于两个源，
 * 结果就是同一段视频被生成两张图、两边各存一份，缓存也各命中各的。
 *
 * 规则：同源的绝对地址折成 path+search；blob: / data: 原样（本来就只在本会话有效）。
 */
export function normalizeThumbSource(videoUrl: string): string {
  if (!videoUrl) return ''
  if (videoUrl.startsWith('blob:') || videoUrl.startsWith('data:')) return videoUrl
  if (typeof location !== 'undefined') {
    try {
      const u = new URL(videoUrl, location.origin)
      if (u.origin === location.origin) return u.pathname + u.search
    } catch {
      /* 非法地址：退回原串 */
    }
  }
  return videoUrl
}

/**
 * 拼统一缩略图的资源引用名；没有地址时返回 undefined。
 *
 * 尺寸**一律**写进名字（含第 1 档）：三档各按自己配置的宽高生成，名字必须能区分。
 * 唯一的约束是**调用方必须传同一组数字** —— 视频节点、底栏、左侧栏都从
 * 同一份设置（videoThumbTier 的三档配置）取框，所以天然一致。
 */
export function unifiedThumbRef(videoUrl: string, identity: ThumbIdentity = {}): string | undefined {
  if (!videoUrl) return undefined
  const source = normalizeThumbSource(videoUrl)
  const tier = identity.tier === 2 || identity.tier === 3 ? identity.tier : 1
  const box = thumbBoxFor(identity)
  const q = Math.max(0, Math.round((identity.quality ?? 0.8) * 100))
  // 第 1 档 = 原生帧：尺寸由源决定、不进名字（见上方说明）
  const size = tier === 1 ? '' : 'w' + box.width + 'h' + box.height
  return 'vthumb-' + hash32(source) + '-v' + THUMB_VERSION + 't' + tier + size + 'q' + q
}

/**
 * 该身份对应的目标框（宽高）。
 *
 * 三档统一走这条：
 * - 调用方给了框 → 用它（三档配置就是这么传的，第 1 档传的是源尺寸）；
 * - 没给框 → 退到源画面尺寸；再拿不到就给 1080（不放大，让截图函数自己定）。
 *
 * ★ 一定要**确定性**：同一个身份必须算出同一个框，否则名字里的 w/h 会漂，
 * 缓存就永远命不中。
 */
function thumbBoxFor(identity: ThumbIdentity): { width: number; height: number } {
  const w = identity.width && identity.width > 0 ? Math.round(identity.width) : 0
  const h = identity.height && identity.height > 0 ? Math.round(identity.height) : 0
  if (w > 0 && h > 0) return { width: w, height: h }
  const fw = identity.frameWidth && identity.frameWidth > 0 ? Math.round(identity.frameWidth) : 0
  const fh = identity.frameHeight && identity.frameHeight > 0 ? Math.round(identity.frameHeight) : 0
  if (fw > 0 && fh > 0) return { width: fw, height: fh }
  return { width: VIDEO_THUMB_MAX_WIDTH, height: VIDEO_THUMB_MAX_WIDTH }
}

/** 同一源的并发单飞 + 已完成结果（模块级共享，跨组件复用） */
const inflight = new Map<string, Promise<string | null>>()
const done = new Map<string, string | null>()

/**
 * 测试用：清空会话内缓存。
 *
 * 缓存是**模块级**的（跨组件复用就是靠它），所以单测之间必须显式清，
 * 否则前一个用例的结果会被后一个命中，测出来的是"缓存命中"而不是被测逻辑。
 */
export function __clearUnifiedThumbs(): void {
  inflight.clear()
  done.clear()
}

/**
 * 取视频缩略图的**显示地址**（唯一入口）。
 *
 * - resources 缺省（极简宿主/单测）→ 只截帧返回 dataURL，不持久化；
 * - 命中缓存（内存或资源库）→ 直接返回，不解码视频；
 * - 未命中 → 单飞生成（跳纯色帧）→ put 库 → 返回显示地址。
 */
export async function unifiedThumbOf(
  videoUrl: string | undefined,
  resources: ThumbResourcePort | undefined,
  identity: ThumbIdentity = {},
): Promise<string | null> {
  if (!videoUrl) return null
  const persistable = !videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')
  const ref = persistable ? unifiedThumbRef(videoUrl, identity) : undefined
  // 会话内缓存键：持久化时用 ref（身份完整），否则用原串 + 档位
  const key = ref ?? normalizeThumbSource(videoUrl) + '|' + (identity.tier ?? 1)
  const memo = done.get(key)
  if (memo !== undefined) return memo
  const running = inflight.get(key)
  if (running) return await running
  const task = (async (): Promise<string | null> => {
    // ① 资源库命中（跨会话复用，省掉一次视频解码）
    if (ref && resources) {
      try {
        const hit = await resources.resolve(ref)
        if (hit) return hit
      } catch { /* 库不可用按未命中处理 */ }
    }
    // ② 单飞生成（跳过纯色片头，黑/白图源头规避）
    const box = thumbBoxFor(identity)
    const dataUrl = await captureVideoThumb(videoUrl, {
      /**
       * captureVideoThumb 的输出规则是「宽度上限 + 保持原比例 + 不放大」：
       * - 横屏画面（宽 ≥ 高）→ 直接给框宽，短边自然落进框内；
       * - 竖屏画面（宽 < 高）→ 给「框高 × 源宽 ÷ 源高」，等价于按高度收口。
       * 从前这里一律取长边，竖屏视频会被"放大"到框高，出来一张比配置更大的图。
       */
      maxWidth: outputWidthFor(box, identity),
      // 不传裁框（用户 2026-10-31）：缩略图是全站共用的那一张，必须是整幅原片。
      // 节点上的裁剪由显示端用 CSS 取景，左侧栏 / 底栏也就天然对得上。
      quality: identity.quality,
    })
    if (!dataUrl) return null
    // ③ 存库（固定 ref + derived）：下次（含重启）直接 ① 命中
    if (ref && resources) {
      try {
        const blob = await (await fetch(dataUrl)).blob()
        if (blob.size > 0) {
          await resources.put(blob, { kind: 'image', name: ref + '.webp', ref, derived: true })
          /**
           * 存完再取一次**资源库地址**，用它当返回值。
           *
           * 为什么不直接返回 dataUrl（用户口径「一个视频一张图、全站复用」）：
           * dataURL 是这一份 base64，每个消费方（视频节点 / 底栏 / 左侧栏）各存一份
           * 几十 KB 的字符串，而且刷新前后地址不一样 —— 排查时看不出"到底命中没命中"。
           * 换成资源库地址后：内存里只有一个短 URL，刷新前后同一个值。
           * 取不到（库异常）就退回 dataUrl，功能不受影响。
           */
          const stored = await resources.resolve(ref).catch(() => undefined)
          if (stored) return stored
        }
      } catch {
        /* 存不进去就用 dataURL，功能不受影响（下次会再试一次） */
      }
    }
    return dataUrl
  })()
  inflight.set(key, task)
  try {
    const url = await task
    done.set(key, url)
    return url
  } finally {
    inflight.delete(key)
  }
}

/**
 * 由目标框与源画面比例算 captureVideoThumb 的"宽度上限"。
 *
 * captureVideoThumb 只会按宽度收口（保持原比例、绝不放大），所以竖屏要换算成宽度：
 *   宽度上限 = 框高 × (画面宽 / 画面高)
 *
 * 三档一律按**各自配置的框**收口（用户 2026-10-31："生成就根据对应设置的宽高进行处理"）：
 * 第 1 档的框来自源尺寸，第 2/3 档来自设置里的宽高，三者各得其所。
 */
function outputWidthFor(box: { width: number; height: number }, identity: ThumbIdentity): number {
  const { width: fw, height: fh } = sourceSizeOf(identity)
  /**
   * 第 1 档 = 原生帧，口径固定：宽度上限 1080、原片更窄就不放大。
   *
   * 为什么不按调用方给的宽高：底栏 / 左侧栏只有地址、拿不到源尺寸，
   * 视频节点却有。按调用方给的值算，同一视频会输出两种尺寸而名字只有一个，
   * 缓存就变成"谁先谁赢"，看起来像图在乱变。
   */
  if ((identity.tier ?? 1) === 1) {
    return fw > 0 ? Math.min(VIDEO_THUMB_MAX_WIDTH, Math.round(fw)) : VIDEO_THUMB_MAX_WIDTH
  }
  if (fw > 0 && fh > 0 && fh > fw) {
    // 竖屏：按高度收口，换算成等价的宽度上限
    return Math.max(1, Math.round((box.height * fw) / fh))
  }
  return Math.max(1, Math.round(box.width))
}

/**
 * 源画面尺寸（调用方给了就用；没给返回 0）。
 *
 * 只用于算比例，**不进缓存名字** —— 见 ThumbIdentity.frameWidth 的说明。
 */
function sourceSizeOf(identity: ThumbIdentity): { width: number; height: number } {
  const fw = identity.frameWidth && identity.frameWidth > 0 ? identity.frameWidth : 0
  const fh = identity.frameHeight && identity.frameHeight > 0 ? identity.frameHeight : 0
  return { width: fw, height: fh }
}
