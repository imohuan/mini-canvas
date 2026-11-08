import type { ResourceItem } from "../types";

// 全局 item 注册表：toDOM 通过 node.attrs.id 查这里获取 ResourceItem（含 renderEditor）
export const itemRegistry = new Map<string, ResourceItem>()
// 调试探针（仅 dev）：真机上排查「标签拿不到交互回调」时，可在控制台读注册表
if (typeof window !== 'undefined') (window as any).__chipRegistry = itemRegistry
/**
 * 每颗标签**上一次渲染时**的外观/交互签名。
 *
 * 为什么需要：refreshChips 过去只比较文档属性（名字/网址），注册表里新增的交互
 * （onIconClick / onReplaceClick / hoverPreview）不会触发重画 —— DOM 仍是旧的、
 * 不带 resource-chip--editable。真机表现：「标签插进来后左侧图标不会变编辑图标、也点不动」。
 * 记签名后，只有外观/交互真的变了才重建节点（不会每次刷新都产生事务、丢光标）。
 */
export const chipRenderSig = new Map<string, string>()

/** 影响标签 DOM 的那些字段拼成一个可比较的签名 */
export function chipSignature(item: ResourceItem): string {
  return JSON.stringify([
    item.name ?? '',
    item.url ?? '',
    item.thumbnail_url ?? '',
    item.chipKind ?? '',
    item.invalid === true,
    Boolean(item.onIconClick),
    Boolean(item.onReplaceClick),
    Boolean(item.hoverPreview),
    Boolean(item.renderEditor),
  ])
}
/**
 * 点标签**右侧文字**后，光标落到标签之后的延迟（ms）。
 *
 * 用户口径 2026-10-29 复述：「点击右侧文字，过 1 秒把光标调整到标签后面」。
 * 以前是 0.5s —— 手快的人还没反应过来光标就跳了，观感像「点一下光标乱跑」。
 * 导出给单测钉住这条时长（它是交互契约，不是随口一个魔数）。
 */
export const CHIP_CARET_DELAY = 1000
/** 供测试读取（回填后标签外观靠它 —— 没有 renderEditor 就退化成 @名字 样式） */
export function registeredItem(id: string): ResourceItem | undefined {
  return itemRegistry.get(id)
}
/**
 * 往编辑器登记/更新一个资源项（toDOM 渲染时按 id 读它拿外观）。
 *
 * 为什么公开：底栏「待输入」标签的内容随**连线**变化（上传/替换/断开），
 * 调用方在内容变化后把最新 item 登记进来、再调 refreshChips()，
 * 两步合起来才能把正文里的虚线标签刷成实线（换名字/缩略图）。
 */
export function registerItem(item: ResourceItem): void {
  itemRegistry.set(item.id, item)
}

/**
 * 从标签名解析资源类型（用户 2026-10-28：标签名自带类型+索引，别再绕注册表猜）。
 *
 * 为什么必须用名字：类型存在注册表的 mediaType 里，而注册表是运行时态 —— 底栏重开/
 * 组件刷新时条目会被重建（只剩 name/id），mediaType 丢失 → 所有图标退化成文本图标。
 * 名字（图片2 / 视频1 / 音频3 / 文本1）是节点属性，永远在。
 */
export function kindFromName(name: string | null | undefined): 'image' | 'video' | 'audio' | 'text' {
  const s = String(name ?? '').trim()
  if (/^视频\s*\d+$/.test(s)) return 'video'
  if (/^音频\s*\d+$/.test(s)) return 'audio'
  if (/^图片\s*\d+$/.test(s)) return 'image'
  if (/^文本\s*\d+$/.test(s)) return 'text'
  return 'text'
}

/**
 * 一个资源**到底是什么**（用户 2026-10-29：hover 预览要靠它决定弹不弹、按什么画）。
 *
 * 判定顺序（前面的更可信）：
 *   1. 注册表条目上的 chipKind / mediaType —— 底栏绑定节点时写的就是真实类型；
 *   2. 地址特征（mp4 / mp3 / data:image / data:video）—— 冷启动没有注册表时也能认；
 *   3. 名字里的自动编号（图片3 / 视频2）。
 *
 * 为什么不能只看名字：用户会给节点起真名（「泳装少女」「雨声」），名字里没有类型词；
 * 旧实现一律当文本 → 图片标签永远不弹预览。
 */
export function kindOfResource(
  item: { chipKind?: string; mediaType?: string } | undefined,
  fallback: { name?: string; url?: string },
): 'image' | 'video' | 'audio' | 'text' {
  const declared = item?.chipKind ?? item?.mediaType
  if (declared === 'image' || declared === 'video' || declared === 'audio' || declared === 'text') return declared
  const url = String(fallback.url ?? '')
  if (/^data:video\//i.test(url) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return 'video'
  if (/^data:audio\//i.test(url) || /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(url)) return 'audio'
  if (/^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(url)) return 'image'
  return kindFromName(fallback.name)
}

/**
 * 标签身份（用户 2026-10-28 定案）：**认节点，不认序号**。
 *
 * - `ref-node:<节点id>`：已绑定画布节点。显示名永远跟随节点名称；
 * - `ref-name:<名称>`：还没绑定的手打标签（例如 `@雨声`），名称就是身份。
 *   绑定成功后由调用方把 id 换成 `ref-node:<id>`。
 *
 * 为什么不再用 `ref-slot:<kind>:<N>`：序号会随排序/增删变化，
 * 标签追着序号跑就必然错位（用户 2026-10-28 拍板：彻底换掉）。
 */
export const REF_NODE_PREFIX = 'ref-node:'
export const REF_NAME_PREFIX = 'ref-name:'

/** 节点 id → 标签身份 */
export function refNodeChipId(nodeId: string): string {
  return REF_NODE_PREFIX + String(nodeId ?? '')
}

/** 名称 → 待绑定标签身份（名称是画布内唯一的，所以可当身份用） */
export function refNameChipId(name: string): string {
  return REF_NAME_PREFIX + String(name ?? '').trim()
}

/** 标签身份 → 绑定的节点 id（不是节点标签 / 老格式 → null） */
export function nodeIdOfChipId(id: string | null | undefined): string | null {
  const s = String(id ?? '')
  if (!s.startsWith(REF_NODE_PREFIX)) return null
  const nodeId = s.slice(REF_NODE_PREFIX.length)
  return nodeId || null
}

/** 标签身份 → 待绑定名称（不是待绑定标签 → null） */
export function refNameOfChipId(id: string | null | undefined): string | null {
  const s = String(id ?? '')
  if (!s.startsWith(REF_NAME_PREFIX)) return null
  const name = s.slice(REF_NAME_PREFIX.length).trim()
  return name || null
}

/**
 * 造一个参考标签的素材项（唯一入口，三条路径共用：@ 下拉 / 标记 / 连线刷新）。
 *
 * - `bound` 有值 = 已绑定节点：按节点真实类型出图标与缩略图；
 * - 没有 = 待绑定：统一「资源」图标，不猜类型（用户口径：手打的 `@雨生` 无从判断类型）；
 * - `invalid` = 绑定失效：灰掉，底栏禁止发送。
 */
export function buildRefChipItem(input: {
  id: string
  name: string
  /** 显示序号（拖动参考卡后变化；只用于界面，不改引用名） */
  index?: number
  bound?: {
    kind: 'image' | 'video' | 'audio' | 'text'
    url?: string
    value?: string
    /** 视频帧图（mp4 不能当 <img>） */
    thumb?: string
  }
  invalid?: boolean
  onClick?: (item: ResourceItem) => void
  hoverPreview?: () => string | undefined | Promise<string | undefined>
}): ResourceItem {
  const bound = input.bound
  const item: ResourceItem = {
    id: input.id,
    name: input.name,
    category: '素材',
    ...(typeof input.index === 'number' && input.index > 0 ? { chipIndex: input.index } : {}),
    ...(bound ? { chipKind: bound.kind, mediaType: bound.kind === 'text' ? undefined : bound.kind } : {}),
    ...(bound?.url ? { url: bound.url } : {}),
    ...(bound?.thumb ? { thumbnail_url: bound.thumb } : {}),
    ...(bound?.value ? { value: bound.value } : {}),
    ...(input.invalid ? { invalid: true } : {}),
  }
  if (input.onClick) item.onClick = input.onClick
  if (input.hoverPreview) item.hoverPreview = input.hoverPreview
  /**
   * 外观在**渲染时**读注册表最新条目（与老 buildSlotItem 同一条理由）：
   * 连线变化 / 替换节点后，正文里同一颗标签要立刻换名字、换图标、换缩略图。
   */
  item.renderEditor = (self) => {
    const latest = itemRegistry.get(self.id) ?? self
    return renderRefChip(latest)
  }
  return item
}

/** 参考标签的 DOM（编辑器内 chip；唯一一份外观） */
export function renderRefChip(item: ResourceItem): HTMLElement {
  const kind = item.chipKind
  const invalid = item.invalid === true
  // 记下「这次实际画成什么样」：refreshChips 据此判断要不要重建（见 chipSignature）
  if (item.id) chipRenderSig.set(item.id, chipSignature(item))
  const span = document.createElement('span')
  span.className =
    'resource-node resource-chip'
    + (kind ? ' resource-chip--' + kind : ' resource-chip--unbound')
    + (invalid ? ' resource-chip--invalid' : '')
  span.dataset.id = item.id
  span.dataset.name = item.name
  /**
   * 类型写进 data-kind（用户 2026-10-29）：hover 预览要按类型判断弹不弹，
   * 而 DOM 上原来只有 data-url / data-name —— 名字是用户起的真名（「泳装少女」），
   * 从它猜不出类型，于是图片标签被当成文本、预览永远不显示。
   * CSS 侧也用得到（图标/缩略图按类型换）。
   */
  if (kind) span.dataset.kind = kind
  /**
   * 左侧图标可编辑（用户 2026-10-29 定稿）：hover 时把缩略图/类型图标换成**铅笔**，
   * 表示「点它换一个节点」。用 CSS ::after 盖一层，不插额外 DOM（保住加载结构）。
   */
  if (item.onIconClick || item.onReplaceClick) {
    span.classList.add('resource-chip--editable')
  }
  if (kind) span.dataset.kind = kind
  if (invalid) span.dataset.invalid = '1'
  /**
   * 视觉规则（用户 2026-10-29：标签左侧的缩略图/图标会莫名不见）：
   *
   * **图标永远先画出来，图片只是盖在它上面**。
   * 以前是「有 url 就直接 <img>，失败时由加载器 display:none」——一旦地址 404 / 走到
   * 视频取帧失败 / 资源还没 resolve，标签左侧就**只剩空白**（用户看到的就是「图没了」）。
   * 现在：
   *   · 底图 = 类型图标（图片/视频/音频/文本/未绑定资源）；
   *   · 有可画缩略图时，叠一张 <img>；**加载成功才显示**，失败/未完成就露出底图；
   *   · 加载中在图标位加 is-loading 转圈（不改变布局）。
   */
  /**
   * 视频缩略图（用户 2026-11-06 报「视频标签变成图标了」）：
   * 帧图既可能放在 `thumbnail_url`，也可能直接放在 `url`（底栏刷新时就是这么写的）。
   * 以前只认 `thumbnail_url`，于是帧图明明在也画不出来，退回成类型图标。
   * 判断「能不能当图片画」只看地址：mp4/webm 这类视频容器一律不要。
   */
  const urlAsImage = !!item.url && !/\.(mp4|webm|mov|m4v|ogv|mkv)(\?|#|$)/i.test(item.url)
  const thumb =
    kind === 'video' ? (item.thumbnail_url || (urlAsImage ? item.url : '') || '')
    : kind === 'image' ? (item.url || '')
    : ''
  const canThumb = !!thumb && (kind === 'image' || kind === 'video') && !/\.(mp4|webm|mov|m4v|ogv|mkv)(\?|#|$)/i.test(thumb)
  const ic = document.createElement('span')
  ic.className = 'resource-chip-icon'
  // 没有 chipKind = 待绑定 → 统一资源图标（data-icon 缺省 = 通用方块）
  ic.dataset.icon = kind ?? 'resource'
  span.append(ic)
  if (canThumb && !invalid) {
    const img = document.createElement('img')
    img.className = 'resource-chip-thumb'
    img.alt = ''
    img.draggable = false
    /**
     * 加载态：默认隐藏 + 图标位转圈；onload 才显示图片、onerror 保持图标。
     * 这样「图没出来」永远是**有个图标**，不会留下空白。
     */
    img.style.display = 'none'
    ic.classList.add('is-loading')
    img.onload = () => {
      img.style.display = ''
      ic.classList.remove('is-loading')
      ic.classList.add('is-covered')
    }
    img.onerror = () => {
      img.remove()
      ic.classList.remove('is-loading')
    }
    img.src = thumb
    span.append(img)
  }
  const nm = document.createElement('span')
  nm.className = 'resource-chip-name'
  /**
   * 序号走属性 + CSS 的 ::before 画（用户 2026-11-08：「1 · 名字」）。
   *
   * 为什么不直接拼进 textContent：标签名是引用的一部分（serialize / plainText 都读 attrs.name），
   * 拼进去容易被后续逻辑当成真名字；属性只给样式看，名字本身一个字不改。
   */
  if (typeof item.chipIndex === 'number' && item.chipIndex > 0) {
    nm.dataset.chipIndex = String(item.chipIndex)
  }
  nm.textContent = item.name
  span.append(nm)
  return span
}

/** 造一个「待输入 / 已填」槽位素材项（renderEditor 读注册表，缩略图跟着连线变化） */
export function buildSlotItem(
  slotKind: 'image' | 'video' | 'audio' | 'av' | 'text',
  name: string,
): ResourceItem {
  const id = 'ref-slot:' + slotKind + ':' + name.replace(/\D/g, '')
  const item: ResourceItem = {
    id,
    name,
    category: '素材',
    // av / text 都没有单一媒体类型：av 是混合，text 靠名字识别
    mediaType: slotKind === 'av' || slotKind === 'text' ? undefined : slotKind,
  }
  item.renderEditor = (self) => {
    // 渲染时读注册表：待输入 → 已填（连线变化）时外观要跟着变
    const latest = itemRegistry.get(self.id) ?? self
    const span = document.createElement('span')
    /**
     * 「待输入」只对**靠地址判断有没有内容**的类型成立（图片/视频/音频）。
     * 文本标签本来就没有 url（内容是 value），拿 !url 判会把已填的文本标签画成虚线待输入
     *（用户 2026-10-28 截图里「文本1」就是虚线框）。
     */
    const isTextChip = kindFromName(latest.name) === 'text' && /^文本\s*\d+$/.test(String(latest.name ?? '').trim())
    const isPending = !isTextChip && !latest.url
    span.className = 'resource-node resource-chip' + (isPending ? ' is-pending' : '')
    span.dataset.id = self.id
    span.dataset.name = latest.name
    /**
     * 有图就画图（含视频：视频存的 url 是**帧图**，不是 mp4）。
     *
     * 为什么不能只认 `mediaType === 'image'`（用户 2026-10-28 报「刷新后标签变回默认」）：
     * 冷启动时注册表里只有 `registerSlotItemsFromDoc` 造的最小条目，mediaType 可能缺失，
     * 于是视频/图片标签一起落到图标分支 —— 看上去就是「刷新后缩略图没了、变回基础标签」。
     */
    /**
     * 只有「能把 url 当图片」的类型才画 `<img>`；音频是 mp3，塞进去必然加载失败、
     * 编辑器再把失败元素隐藏 —— 标签就只剩名字（用户 2026-10-28 报音频标签没图标）。
     * 视频的 url 是帧图（data:image/…），所以允许。
     */
    const urlIsImage = !!latest.url && !/\.(mp3|wav|ogg|m4a|mp4|webm|mov)(\?|#|$)/i.test(latest.url)
    const canThumb = urlIsImage && !/^文本\s*\d+$/.test(String(latest.name ?? '').trim()) && latest.mediaType !== 'audio'
    if (canThumb) {
      const img = document.createElement('img')
      img.className = 'resource-chip-thumb'
      img.src = String(latest.url ?? '')
      img.alt = ''
      span.append(img)
    } else {
      const ic = document.createElement('span')
      ic.className = 'resource-chip-icon'
      /**
       * 按类型出图标（用户 2026-10-28）：图片/视频/音频/文本各有自己的图标。
       *
       * 类型来源**优先看标签名**（图片2 / 视频1 / 音频3 / 文本1）——名字是节点属性，
       * 刷新多少次都在；mediaType 只存在注册表里，重开底栏时会丢（用户截图 2 全变
       * 文本图标就是这个原因）。名字解析不出来时才退回 mediaType。
       */
      const fromName = kindFromName(latest.name)
      const kindKey: 'image' | 'video' | 'audio' | 'text' =
        fromName !== 'text' || /^文本\s*\d+$/.test(String(latest.name ?? '').trim())
          ? fromName
          : latest.mediaType === 'video' ? 'video'
          : latest.mediaType === 'audio' ? 'audio'
          : latest.mediaType === 'image' ? 'image'
          : 'text'
      /**
       * 图标一律走 **CSS mask + data-icon**，不再内联 svg。
       *
       * 为什么（用户 2026-10-28 报「标签图标大小对不上」）：内联 svg 自带 width/height=16，
       * 而底栏给图标格子的尺寸是 16×16 / 22×22 两套，混在一起就看得出大小不一致；
       * mask 只吃「形状」，尺寸由 CSS 统一控制，两条渲染路径（这里与资源面板插入）完全一致。
       */
      ic.dataset.icon = kindKey
      span.append(ic)
    }
    const nm = document.createElement('span')
    nm.className = 'resource-chip-name'
    nm.textContent = latest.name
    span.append(nm)
    return span
  }
  return item
}
/**
 * 按 doc JSON 把 `ref-slot:*` 标签的样式登记进注册表（幂等）。
 *
 * 为什么需要：标签的 toDOM 渲染时去注册表取 item（决定 chip 外观）。冷启动
 * （底栏刚打开、注册表还是空的）时直接建节点，标签就会退化成默认渲染 ——
 * 用户看到的就是「重开底栏后标签变成 @图片1 文本」（2026-10-27 报的那个）。
 */
export function registerSlotItemsFromDoc(docJson: unknown): void {
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const raw of nodes) {
      const node = raw as {
        type?: string
        attrs?: { id?: unknown; name?: unknown; chipKind?: unknown }
        content?: unknown
      } | null
      if (!node || typeof node !== 'object') continue
      if (node.type === 'resource') {
        const id = String(node.attrs?.id ?? '')
        const name = String(node.attrs?.name ?? '')
        if (!id || itemRegistry.has(id)) {
          // 已有条目（调用方登记过更新的内容）→ 不动
        } else if (id.startsWith(REF_NODE_PREFIX) || id.startsWith(REF_NAME_PREFIX)) {
          const kind = String(node.attrs?.chipKind ?? '')
          itemRegistry.set(id, buildRefChipItem({
            id,
            name: name || id,
            ...(kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'text'
              ? { bound: { kind } }
              : {}),
          }))
        } else if (id.startsWith('ref-slot:')) {
          // 老格式：不兼容（用户拍板），按失效画
          itemRegistry.set(id, buildRefChipItem({ id, name: name || id, invalid: true }))
        }
      }
      walk(node.content)
    }
  }
  const root = docJson as { content?: unknown } | null | undefined
  walk(root?.content)
}
