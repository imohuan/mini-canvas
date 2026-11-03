/**
 * 历史瀑布流里单张卡的 DOM 构建（从 HistoryModal.vue 原样迁出）。
 *
 * 只负责「怎么把一条历史记录画成卡」：图片卡、视频/音频卡、异常卡、批量勾选层。
 * 墙何时重建、卡片怎么排，在 createHistoryWall.ts。
 *
 * 所有分支、class、文案、事件接线与原实现逐字一致；外部状态改为创建时传入。
 */
import { createApp, h, type Component } from 'vue'
import { esc, mediaAspect } from './historyCardText'

export interface HistItem {
  id?: string
  title: string
  kind: string
  time: string
  urls?: string[]
  canvasId?: string
  nodeId?: string
  /** 提示词 / 参数 / 参考素材 / 媒体元数据（详情弹窗与卡片角标用） */
  prompt?: string
  values?: Record<string, unknown>
  resources?: Array<{ kind: string; url?: string; value?: string }>
  media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
  finishedAt?: number
  error?: string
}

export interface HistoryCardDeps {
  s: any
  thumbOf: (item: HistItem) => string | null
  previewableUrl: (item: HistItem) => string | null
  openHistoryItem: (item: HistItem) => void
  droppedHistoryIds: Set<string>
  uiComponentOf: (name: string) => unknown
  finishCard: (card: HTMLElement, item: HistItem) => HTMLElement
  buildErrorCard: (item: HistItem, opts?: { missingResource?: boolean }) => HTMLElement
  buildDetailButton: (item: HistItem) => HTMLElement
  buildFactsLine: (item: HistItem) => HTMLElement
  buildCheckOverlay: (id: string) => HTMLElement
  showBrokenResourceCard: (card: HTMLElement, item: HistItem) => void
  onCardClick: (item: HistItem) => void
  onAudioCardClick: (item: HistItem) => void
  scheduleImageRelayout: () => void
  wallApps: {
    appsOfWall: (key: string) => Set<unknown>
    appOfCard: WeakMap<HTMLElement, { unmount(): void }>
    MOUNTED_WALL: string
  }
}

export function createHistoryCard(deps: HistoryCardDeps) {
  const {
    s,
    thumbOf,
    previewableUrl,
    openHistoryItem,
    droppedHistoryIds,
    uiComponentOf,
    finishCard,
    buildErrorCard,
    buildDetailButton,
    buildFactsLine,
    buildCheckOverlay,
    showBrokenResourceCard,
    onCardClick,
    onAudioCardClick,
    scheduleImageRelayout,
    wallApps,
  } = deps

  const { appsOfWall, appOfCard, MOUNTED_WALL } = wallApps

function buildAudioControls(item: HistItem, audio: HTMLAudioElement, card: HTMLElement): HTMLElement {
  const row = document.createElement('div')
  row.className = 'hist-card-audio-controls'
  /* 整行两端对齐 + 垂直居中（用户口径 2026-10-28：文字要跟按钮垂直居中）。
     用内联样式而不是只依赖样式表：这张卡是 JS 现拼的，样式表若被裁剪/覆盖也不会丢。 */
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.justifyContent = 'space-between'
  /** 左半：类型 + 当前播放进度 */
  const left = document.createElement('div')
  left.className = 'hist-audio-left'
  const kind = document.createElement('span')
  kind.className = 'hist-card-kind'
  kind.textContent = item.kind
  const progress = document.createElement('span')
  progress.className = 'hist-audio-progress'
  left.appendChild(kind)
  left.appendChild(progress)

  /** 右半：总时长 + 播放按钮（纯图标，无边框无圆角） */
  const right = document.createElement('div')
  right.className = 'hist-audio-right'
  const duration = document.createElement('span')
  duration.className = 'hist-audio-duration'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hist-audio-play'
  btn.setAttribute('aria-label', '播放')
  const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20"/></svg>'
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
  btn.innerHTML = playIcon
  right.appendChild(duration)
  right.appendChild(btn)
  const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00'
    const total = Math.round(sec)
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
  }
  const sync = (): void => {
    progress.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration)
    duration.textContent = fmt(audio.duration)
    btn.innerHTML = audio.paused ? playIcon : pauseIcon
    btn.setAttribute('aria-label', audio.paused ? '播放' : '暂停')
  }
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  })
  audio.addEventListener('timeupdate', sync)
  audio.addEventListener('play', sync)
  audio.addEventListener('pause', sync)
  audio.addEventListener('loadedmetadata', sync)
  sync()
  row.appendChild(left)
  row.appendChild(right)
  return row
}

function buildMediaCard(item: HistItem, url: string, kind: 'audio' | 'video'): HTMLElement {
  const card = document.createElement('div')
  card.className = 'hist-card'
  if (item.id) card.dataset.histId = item.id
  const isAudio = kind === 'audio'
  // 音频/视频卡优先用节点插件注册的预览件（真播放器：波形 / 带控件的视频画面）；
  // 目录里没登记/没就绪才回落到静态装饰。视频以前直接把媒体地址塞 <img>，必然裂图。
  const PluginPreview = isAudio
    ? (uiComponentOf('audioPreview') as Component | undefined)
    : (uiComponentOf('videoPreview') as Component | undefined)
  // 媒体框：与图片卡同一套瀑布流格子。按产物真实宽高比给高度，
  // 这样竖版视频就是竖的、横版就是横的（不再全部写死 180px）。
  const media = document.createElement('div')
  media.className = isAudio
    ? 'hist-card-media hist-card-media--audio'
    : 'hist-card-media hist-card-media--video'
  /**
   * 音频：恢复成最开始那版的**横向细条**（宽度由瀑布流决定、高度 96px、白底），
   * 不做带边框的"卡片面板"（用户口径 2026-10-28：不喜欢现在这种卡片形式）。
   * 播放键与文字说明移到卡片外（见 finishCard 之后挂的 attachAudioControls）。
   * 图片/视频仍按产物真实宽高比。
   */
  if (isAudio) {
    media.style.height = '96px'
  } else {
    media.style.aspectRatio = mediaAspect(item, 16 / 9)
  }
  card.appendChild(media)
  if (PluginPreview) {
      const mount = document.createElement('div')
      mount.className = isAudio ? 'hist-card-audio-plugin' : 'hist-card-video-plugin'
      media.appendChild(mount)
      // 视频件自带「按宽度自适应」：小卡片走小屏态（只有一个居中播放键），宽了给完整控制栏。
      // 信息（类型 / 宽高 / 时长 / 大小）全部放在图外的一行里（见 finishCard），图上只留详情圆钮。
      //
      // 视频卡额外给 expandable + 接 expand：小屏态右下角出现「进入预览」小方块，
      // 点它打开全屏预览（用户口径：视频可以点进全屏）。组件自己不开窗 —— 它不知道
      // MediaViewer 挂在哪，所以由这里把事件接到 openHistoryItem 上。
      const app = createApp({
        render: () =>
          h(
            PluginPreview,
            isAudio
              // 音频：恢复成改之前那版 —— 播放器里带名称/时长/大小那一行信息
              ? { url, name: item.title, compact: true }
              : { url, name: item.title, expandable: true, onExpand: () => openHistoryItem(item) },
          ),
      })
      app.mount(mount)
      // 登记：这张卡的 Vue 应用必须在墙被回收时 unmount（见 appsByWall 的说明）。
      // 一律记在「当前挂载中的墙」名下：建卡可能发生在 rebuild / append / prepend 三条路径，
      // 统一记一个桶，收墙时再整体换名到该墙的缓存 key，逐出时才能精确回收。
      appsOfWall(MOUNTED_WALL).add(app)
      // 单张卡被摘掉（坏资源 → 换占位卡）时也要能单独回收它，不牵连整墙
      appOfCard.set(card, app)
      // 视频件自带的控制条自带 aria-label，不再额外补；这里只记录媒体元素，供加载失败与尺寸同步
      // 详情入口留在图上（右上角小圆钮）；信息行在图外，见 finishCard
      media.appendChild(buildDetailButton(item))
      // 媒体加载失败（文件被清理 / 换地址）：与图片卡同一口径，开关关着就整条隐藏
      const tag = isAudio ? 'audio' : 'video'
      const el = mount.querySelector(tag) as HTMLMediaElement | null
      el?.addEventListener('error', () => showBrokenResourceCard(card, item))
      if (el) {
        /**
         * 老记录没有 media 元数据（历史里还没存宽高/时长）。
         * 媒体加载出 metadata 后自己补上：卡片比例按真实宽高重排，左下角角标补宽高与时长，
         * 这样即使没重新生成，旧视频也能显示"宽高 + 时长"，而不是只有"视频 · 12 天前"。
         * 已经记过的（新记录）不覆盖 —— 后端量出来的值更准，也避免二次跳动。
         */
        const syncFromMedia = (): void => {
          // 视频元素才有 videoWidth/height；音频没有可视尺寸，只补时长
          const v = el as HTMLVideoElement
          const w = !isAudio ? v.videoWidth || 0 : 0
          const h = !isAudio ? v.videoHeight || 0 : 0
          const durSec = Number.isFinite(el.duration) ? el.duration : 0
          if (w > 0 && h > 0) {
            if (!item.media) item.media = {}
            if (!item.media.width) item.media.width = w
            if (!item.media.height) item.media.height = h
            if (!isAudio) media.style.aspectRatio = w + ' / ' + h
          }
          if (durSec > 0 && !item.media?.durationMs) {
            if (!item.media) item.media = {}
            item.media.durationMs = Math.round(durSec * 1000)
          }
          const old = card.querySelector('.hist-card-facts')
          if (old) old.replaceWith(buildFactsLine(item))
          scheduleImageRelayout()
        }
        el.addEventListener('loadedmetadata', syncFromMedia)
        el.addEventListener('loadeddata', syncFromMedia)
        // 音频：把真实时长回写到播放器（卡外那行的时长也用它），避免显示 0:00
        if (isAudio) {
          const durEl = mount.querySelector('.apv-time') as HTMLElement | null
          const fmt = (sec: number): string => {
            if (!Number.isFinite(sec) || sec <= 0) return '0:00'
            const total = Math.round(sec)
            return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
          }
          const syncAudioTime = (): void => {
            if (durEl) durEl.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration)
          }
          el.addEventListener('timeupdate', syncAudioTime)
          el.addEventListener('loadedmetadata', syncAudioTime)
        }
      }

      if (isAudio) card.addEventListener('click', () => onAudioCardClick(item))
      else card.addEventListener('click', () => onCardClick(item))
      // 批量模式下媒体层让位给整卡勾选：点在波形/视频上也要落到卡片本身。
      // 标记由 syncBatchOverlays 统一同步（进入/退出批量模式时也要生效，不只是建卡那一刻）。
      card.classList.toggle('hist-card--batch', s.histBatchMode)
      if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
      if (isAudio && el) {
        /**
         * 音频：卡外放"播放键 + 时间 + 尺寸信息"这一行（波形条内只留白底波形）。
         * 结构仍与图片卡一致：媒体条在上、说明在下。
         */
        const finished = finishCard(card, item)
        const facts = finished.querySelector('.hist-card-facts')
        if (facts) facts.remove()
        finished.appendChild(buildAudioControls(item, el as HTMLAudioElement, finished))
        return finished
      }
      return finishCard(card, item)
  }
  // 没有注册件时的兜底卡面：同样套在 media 框里，保留同一套角标与比例
  const inner = document.createElement('div')
  inner.style.cssText = 'position:absolute;inset:0'
  inner.innerHTML = isAudio
    ? '<div class="hist-card-audio"><span class="hist-card-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div>'
    : '<img src="' + esc(url) + '" alt="" loading="lazy" />'
  inner.insertAdjacentHTML('beforeend', '<div class="hist-card-play">▶</div>')
  media.appendChild(inner)
  media.appendChild(buildDetailButton(item))
  if (!isAudio) {
    const img = inner.querySelector('img')!
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight
        scheduleImageRelayout()
      }
    })
    img.addEventListener('error', () => {
      // 与图片卡同一口径：地址打不开 ≠ 生成失败 —— 用中性「资源走丢」卡，
      // 不亮红色异常卡（否则"显示异常"关着也会冒出红叹号，用户实测 2026-10-27）。
      showBrokenResourceCard(card, item)
    })
  }
  card.addEventListener('click', () => onCardClick(item))
  if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
  card.classList.toggle('hist-card--batch', s.histBatchMode)
  return finishCard(card, item)
}

/** 生成瀑布流里一张卡的 DOM（图片卡带骨架屏 + 底部渐变信息栏；无产物退图标卡） */
function createMasonryElement(item: HistItem): HTMLElement {
  const card = document.createElement('div')
  card.className = 'hist-card'
  if (item.id) card.dataset.histId = item.id
  const url = thumbOf(item)

  // 音频/视频先行：它们的 urls[0] 是媒体地址（不是图片），交给专属媒体卡
  // （之前顺序反了：音频地址先被当图片 <img> 加载 → error → 被误换成"异常卡"，
  //  而点开其实能播 —— 用户实测抓到的就是这个）。
  const isAudio = item.kind === '音频' || item.kind === 'audio'
  const isVideo = item.kind === '视频' || item.kind === 'video'
  if (isAudio || isVideo) {
    /**
     * 媒体地址先过 previewableUrl（2026-10-30 复测：跨端 http://localhost:8033/.../*.mp4
     * 被 <video> 反复自动重试，12 秒上百次请求）。不是本服务地址就别挂 video/audio。
     */
    const mediaUrl = previewableUrl(item)
    if (mediaUrl) return buildMediaCard(item, mediaUrl, isAudio ? 'audio' : 'video')
    /**
     * 不可预览：与"资源走丢"同一条口径 —— 显示异常关着就整条不画（登记已摘，避免补漏
     * 又把它画回来）；开着才画一张中性占位卡。
     */
    if (item.id) droppedHistoryIds.add(item.id)
    if (s.histShowError) return buildErrorCard(item, { missingResource: true })
    const skip = document.createElement('div')
    skip.className = 'hist-card hist-card--skip'
    skip.dataset.histSkip = '1'
    return skip
  }

  if (url) {
    // 图片卡：优先用历史里记下的真实宽高（不用等图加载，卡片不会先闪 1:1 再跳）；
    // 早期记录没有 media 时退回 1/1 骨架，等 onload 再按真实宽高比重设。
    const known = !!(item.media?.width && item.media?.height)
    card.innerHTML =
      '<div class="hist-card-media" style="aspect-ratio:' + (known ? mediaAspect(item, 1) : '1/1') + '">' +
      '<img src="' + esc(url) + '" alt="" loading="lazy" />' +
      (known ? '' : '<div class="hist-card-skeleton"><span class="hist-card-pulse"></span></div>') +
      '</div>'
    const mediaEl = card.querySelector('.hist-card-media') as HTMLElement
    mediaEl.appendChild(buildDetailButton(item))
    const img = card.querySelector('img')!
    const media = card.querySelector('.hist-card-media') as HTMLElement
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight
        card.querySelector('.hist-card-skeleton')?.remove()
        // 老记录没有 media 元数据时，用实测尺寸补到**卡外的信息行**
        if (!item.media) item.media = {}
        if (!item.media.width) item.media.width = img.naturalWidth
        if (!item.media.height) item.media.height = img.naturalHeight
        const facts = card.querySelector('.hist-card-facts')
        if (facts) facts.replaceWith(buildFactsLine(item))
        scheduleImageRelayout()
      }
    })
    img.addEventListener('error', () => {
      // 裂图：记录有产物、文件却被清理/换地址了 —— 同样归入异常，
      // 开关关着时整条隐藏，开着时给中性「资源走丢」卡（不占用红色的"生成失败"）。
      showBrokenResourceCard(card, item)
    })
    /**
     * 加载超时兜底（用户口径 2026-10-28：截图里出现一块空白卡片，拖缩放才消失）。
     *
     * 有些地址既不会触发 error、也不会 load（连接挂住 / 被浏览器静默丢弃 / 缓存层返回空），
     * 卡片就一直是"有格子没画面"的白块。12 秒还没拿到尺寸就按裂图处理：
     * 归入「显示异常」（开关关着整条隐藏）—— 不留白格，也不误留一幅假图。
     */
    window.setTimeout(() => {
      if (!img.isConnected) return
      if (img.complete && img.naturalWidth > 0) return
      if (s.histShowError) return // 用户要看异常时，交给 error 回调统一成中性卡
      showBrokenResourceCard(card, item)
    }, 12000)
    card.addEventListener('click', () => onCardClick(item))
  } else {
    card.appendChild(buildErrorCard(item))
  }
  if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
  card.classList.toggle('hist-card--batch', s.histBatchMode)
  return finishCard(card, item)

}

  return { buildMediaCard, createMasonryElement }
}

