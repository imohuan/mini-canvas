/**
 * 生成历史里视频/音频卡的版式契约（用户口径 2026-10-11）。
 *
 * 钉三件用户明确要的事：
 *   1. 视频预览件**按自己的宽度**在小屏态 / 大屏态之间切（不是由宿主传死值）；
 *   2. 小屏态只留一个居中播放键（+ 可选右下角「进入预览」），大屏态才是完整控制栏；
 *   3. 历史卡片**不再有组件下方那条独立标签条**（视频/音频都不要）。
 *
 * 为什么读源码而不是渲染：组件依赖 ResizeObserver 实测宽度，node 环境量不出来；
 * 与 pageSelectNone / scrollAreaScrollForward 同款「源码结构契约」手法。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const videoPreview = readFileSync(
  new URL('../../../plugins/plugin-node-video/src/VideoPreview.vue', import.meta.url),
  'utf-8',
)
const modalsArea = readFileSync(new URL('../components/areas/ModalsArea.vue', import.meta.url), 'utf-8')
const uiSource = readFileSync(new URL('../composables/ui.ts', import.meta.url), 'utf-8')
const masonrySource = readFileSync(new URL('../composables/useMasonry.ts', import.meta.url), 'utf-8')
const audioWavePlayer = readFileSync(
  new URL('../../../plugins/plugin-node-audio/src/AudioWavePlayer.vue', import.meta.url),
  'utf-8',
)

describe('VideoPreview 按实测宽度切两套 UI', () => {
  it('用 ResizeObserver 量自己的宽度（宽度的真源在组件内部，不由宿主传）', () => {
    expect(videoPreview, '没有用 ResizeObserver 量宽度').toMatch(/new ResizeObserver/)
    expect(videoPreview, 'ResizeObserver 没有 observe 根元素').toMatch(/widthObserver\.observe\(/)
  })

  it('小屏判定 = 量到宽度 且 窄于阈值 且 不是全屏舞台', () => {
    const dense = videoPreview.match(/const dense = computed\([^\n]*\)/)?.[0] ?? ''
    expect(dense, '找不到 dense 判定').not.toBe('')
    expect(dense, 'dense 必须比较宽度').toMatch(/width\.value/)
    expect(dense, 'dense 必须排除全屏舞台（tall 永远给完整控制栏）').toMatch(/!props\.tall/)
  })

  it('模板里小屏态与大屏态互斥（v-if dense / v-else 完整控制栏）', () => {
    expect(videoPreview, '没有小屏态分支').toMatch(/v-if="dense"/)
    expect(videoPreview, '完整控制栏没有挂到 v-else 上').toMatch(/v-else class="vpv-bar"/)
    expect(videoPreview, '小屏态缺居中播放键').toMatch(/vpv-dense-play/)
  })

  it('「进入预览」是可选能力：expandable 开关 + expand 事件（组件自己不开窗）', () => {
    expect(videoPreview, '没有 expandable prop').toMatch(/expandable\?:\s*boolean/)
    expect(videoPreview, '没有声明 expand 事件').toMatch(/defineEmits<\{\s*\(e: "expand"\)/)
    expect(videoPreview, '右下角入口没有 emit expand').toMatch(/emit\(['"]expand['"]\)/)
  })
})

describe('生成历史的视频/音频卡面保持干净（没有任何信息浮层）', () => {
  it('组件下方那条 .hist-card-foot 已删除（视频、音频都不再单列标签）', () => {
    expect(modalsArea, '还在建 hist-card-foot 独立标签条').not.toMatch(/hist-card-foot/)
  })

  it('媒体卡不再加信息浮层（右下角那个时间会压住「进入预览」按钮 —— 用户实测）', () => {
    expect(modalsArea, '还在给媒体卡加信息浮层').not.toMatch(/hist-card-tags--media/)
    expect(modalsArea, '还在建媒体卡的时间浮层').not.toMatch(/♪ 音频|▶ 视频/)
  })

  it('视频卡把小屏态右下角入口接到全屏预览（expandable + onExpand）', () => {
    expect(modalsArea, '没给视频件传 expandable，右下角入口不会出现').toMatch(/expandable:\s*true/)
    expect(modalsArea, '没接 expand 事件，点了没反应').toMatch(/onExpand:\s*\(\)\s*=>\s*openHistoryItem\(item\)/)
  })
})

/**
 * 全屏预览里的音频必须是**黑白灰**（用户口径 2026-10-28）。
 * 覆盖点住在 MediaViewer（scoped），所以这里读它的源码，断言用的是 :deep()。
 */
describe('全屏预览的音频不用主题紫', () => {
  const mediaViewer = readFileSync(
    new URL('../../../plugins/plugin-theme-default/src/components/ui/MediaViewer.vue', import.meta.url),
    'utf-8',
  )

  it('全屏音频的已播放波形 / 进度条改为主题文字色', () => {
    const preview = mediaViewer.slice(mediaViewer.indexOf('<style scoped>'))
    expect(preview, '全屏预览仍让已播放波形吃 --ui-accent（紫色）').toMatch(
      /\.mv-plugin-stage :deep\(\.aw-wave-bar\.is-played\)[^{]*\{[^}]*var\(--ui-ink/,
    )
    expect(preview, '全屏进度条仍是主题强调色').toMatch(
      /\.mv-plugin-stage :deep\(\.aw-progress-fill\)[^{]*\{[^}]*var\(--ui-ink/,
    )
    expect(preview, '全屏进度圆点仍是主题强调色').toMatch(/:deep\(\.aw-progress-thumb\)[^{]*\{[^}]*var\(--ui-ink/)
  })

  it('用 :deep() 穿透 scoped（否则覆盖不到子组件内部的波形）', () => {
    const preview = mediaViewer.slice(mediaViewer.indexOf('<style scoped>'))
    const block = preview.slice(preview.indexOf('.mv-plugin-stage :deep('))
    expect(block, '缺少 :deep() 穿透，规则不会生效').toMatch(/:deep\(/)
    // 反例：不带 :deep() 的裸选择器写在 scoped 里等于没写
    expect(preview, '存在不带 :deep() 的裸覆盖（scoped 下无效）').not.toMatch(
      /^\s*\.mv-plugin-stage \.aw-wave-bar/m,
    )
  })
})

/**
 * 批量勾选钮的样式必须在**全局块**里（用户实测 2026-10-27：勾选后每张卡都是一个大对勾）。
 *
 * 根因：卡片由 createMasonryElement 用 document.createElement 现拼，拿不到 scoped 的
 * data-v 属性 —— 样式写在 scoped 里等于整段不存在，SVG 按默认 300×150 铺满整卡。
 * 这条契约按样式块切分来判，避免靠"文件里出现过 .hist-card-check"误判为已生效。
 */
describe('批量勾选钮样式对动态卡片生效', () => {
  // 取**最后一个**无 scoped 的 <style> 块。之前只用 indexOf 取第一个 <style>，
  // 取到的是 <style scoped> —— 断言会把"写在 scoped 里"当成通过，正是这次要防的坑。
  const globalStart = modalsArea.lastIndexOf('<style>')
  const globalStyle = modalsArea.slice(globalStart, modalsArea.indexOf('</style>', globalStart))

  it('勾选钮的尺寸/定位写在全局样式块', () => {
    expect(globalStart, '找不到不带 scoped 的全局样式块').toBeGreaterThan(-1)
    expect(globalStyle, '全局块里没有 .hist-card-check 的定位（scoped 里写等于没写）').toMatch(/\.hist-card-check\s*\{/)
    const rule = globalStyle.match(/\.hist-card-check\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, '勾选钮没有固定尺寸，会退化成内联 SVG 的默认 300×150').toMatch(/width:\s*20px;/)
    expect(rule, '勾选钮没有绝对定位，会撑开卡片').toMatch(/position:\s*absolute;/)
  })

  it('勾选钮里的对勾 SVG 有 12px 约束', () => {
    expect(globalStyle, '全局块缺 .hist-card-check svg 尺寸约束').toMatch(/\.hist-card-check svg\s*\{[^}]*width:\s*12px;/)
  })

  it('勾选层只由外层卡片挂一次（异常卡自己不再复制一份）', () => {
    // 只取 buildErrorCard 这一个函数体（后面的 showBrokenResourceCard 才负责挂勾选层）
    const errFn = modalsArea.slice(
      modalsArea.indexOf('function buildErrorCard'),
      modalsArea.indexOf('function showBrokenResourceCard'),
    )
    expect(errFn, 'buildErrorCard 里又挂了一次勾选层 → 同一张卡出现两个勾选钮').not.toMatch(/buildCheckOverlay/)
  })

  it('批量模式的主按钮 hover 不退成灰底白字（用户实测：按钮像消失了）', () => {
    const at = modalsArea.indexOf('aria-label="批量操作"')
    const btn = modalsArea.slice(at - 500, at)
    expect(btn, '批量按钮仍会在 hover 时套上 hover:bg-hover（白字落在浅灰底上）').not.toMatch(/'bg-brand text-primary-ink'/)
    expect(btn, '批量按钮 hover 时没有保持品牌底').toMatch(/hover:bg-brand/)
    // 静态 class 里的 hover:bg-hover 排在生成 CSS 后面，会盖住 hover:bg-brand：
    // 它只能出现在「非批量」分支里（三元表达式内），不能写死在 class 上。
    // 从按钮标签里只抽「静态 class=」这一个属性（:class 三元里允许出现 hover:bg-hover）
    const tag = btn.slice(btn.lastIndexOf('<button'))
    const staticClass = tag.match(/\sclass="([^"]*)"/)?.[1] ?? ''
    expect(staticClass, '静态 class 里残留 hover:bg-hover → 悬停时品牌底被灰底盖掉').not.toMatch(/hover:bg-hover/)
  })

  it('批量模式下点整张卡片就能选中（不是只能点左上角圆钮）', () => {
    // 三条卡片路径（媒体卡 / 图片卡 / 无产物卡）都必须走同一个 onCardClick
    // 卡片本体（异常卡 / 媒体卡 / 图片卡 / 裂图重建）都必须走 onCardClick；
    // 左上角圆钮是唯一允许自己处理 click 的（它要 stopPropagation 防止重复切换）。
    const viaHandler = modalsArea.match(/addEventListener\('click', \(\) => onCardClick\(item\)\)/g)?.length ?? 0
    expect(viaHandler, '非音频卡片点击没全部接 onCardClick（批量模式下点卡片不会选中）').toBe(4)
    expect(modalsArea, '音频卡点击没有接专用处理（批量模式下点音频卡不会选中）').toMatch(
      /onAudioCardClick/,
    )
    expect(modalsArea, 'onCardClick 在批量模式下没有切换选中').toMatch(
      /function onCardClick\(item: HistItem\)[\s\S]{0,220}histBatchMode[\s\S]{0,120}toggleHistSelected\(item\.id\)/,
    )
  })

  it('数据比面板晚到时，加载哨兵会在渲染后补挂观察（否则滚到底不翻页）', () => {
    // 哨兵是 v-if；setupLoadSentinel 必须在数据版本变化 + 重建后各补一次
    const dataWatch = modalsArea.slice(modalsArea.indexOf("watch(() => s.histDataVersion"), modalsArea.indexOf("watch(() => s.histZoom"))
    expect(dataWatch, '数据到位后没有补挂哨兵观察器').toMatch(/setupLoadSentinel\(\)/)
    expect(dataWatch, '瀑布流没实例时没有整墙重建（会排成一列且哨兵无人观察）').toMatch(/rebuildMasonry\(\)/)

    const rebuild = modalsArea.slice(modalsArea.indexOf('function rebuildMasonry'), modalsArea.indexOf('/** 只把新增一批'))
    expect(rebuild, '整墙重建后没有补挂哨兵观察器').toMatch(/setupLoadSentinel\(\)/)

    const setup = modalsArea.slice(modalsArea.indexOf('function setupLoadSentinel'), modalsArea.indexOf('function teardownLoadSentinel'))
    expect(setup, '同一哨兵重复 setup 会重复观察').toMatch(/observedSentinel/)
  })

  it('列表不足一屏时主动补拉下一页（不再只等 observer 回调）', () => {
    // 根因：首屏大量记录被过滤后列表比弹窗还短，哨兵一直可见 → observer 不再回调
    expect(modalsArea, '缺少"哨兵是否在视口内"的主动测量').toMatch(/function isSentinelInView/)
    expect(modalsArea, '缺少主动补拉入口').toMatch(/function fillViewportIfNeeded/)

    const rebuild = modalsArea.slice(modalsArea.indexOf('function rebuildMasonry'), modalsArea.indexOf('/** 只把新增一批'))
    expect(rebuild, '整墙重建后没有补拉（列表仍不足一屏就停住）').toMatch(/fillViewportIfNeeded\(\)/)

    const append = modalsArea.slice(modalsArea.indexOf('function appendMasonryItems'), modalsArea.indexOf('/** 滑杆 / 容器宽度变化'))
    expect(append, '追加一批后没有补拉（还是短列表）').toMatch(/fillViewportIfNeeded\(\)/)

    const setup = modalsArea.slice(modalsArea.indexOf('function setupLoadSentinel'), modalsArea.indexOf('function teardownLoadSentinel'))
    expect(setup, '哨兵挂载时没有主动测量（初始即相交时无回调）').toMatch(/fillViewportIfNeeded\(\)/)
  })

  it('加载更多有可见的加载条，且至少显示 1 秒才隐藏', () => {
    // 用户口径 2026-10-28：接口几十毫秒就返回时，加载态一闪而过看不见 → 至少停 1 秒
    expect(uiSource, '缺少「加载态最短显示时长」常量').toMatch(/HIST_LOADING_MIN_MS\s*=\s*1000/)
    expect(uiSource, '取消加载态时没有按最短时长延迟').toMatch(/settleHistLoading/)
    const fn = uiSource.slice(uiSource.indexOf('function beginHistLoading'), uiSource.indexOf('function settleHistLoading'))
    expect(fn, '加载态没有记录起始时刻').toMatch(/histLoadingSince/)
    const tpl = modalsArea.slice(modalsArea.indexOf('hist-loading'), modalsArea.indexOf('hist-load-sentinel'))
    expect(tpl, '加载条渲染在哨兵之后/或被藏掉了').not.toBe('')
    expect(modalsArea, '加载条没有转圈/文案').toMatch(/hist-loading-spinner/)
  })

  it('切页签后不必靠拖缩放滑杆才会继续加载（哨兵失效能自愈）', () => {
    expect(modalsArea, '缺少哨兵自愈巡检').toMatch(/function ensureLoadSentinelAlive/)
    const fn = modalsArea.slice(
      modalsArea.indexOf('function ensureLoadSentinelAlive'),
      modalsArea.indexOf('onBeforeUnmount\(\(\) =>'),
    )
    expect(fn, '哨兵还在却没人观察时不重挂').toMatch(/setupLoadSentinel\(\)/)
    expect(fn, '哨兵在视口里时没有主动补拉').toMatch(/fillViewportIfNeeded\(\)/)
    expect(modalsArea, '没有周期性巡检（切页签后没人再触发）').toMatch(/setInterval\([\s\S]{0,120}ensureLoadSentinelAlive/)
  })

  it('切页签后回填已加载的页数，不把之前翻的页丢掉', () => {
    expect(uiSource, '没有按筛选保存「已加载到第几页」').toMatch(/histPageBySignature/)
    expect(uiSource, '没有保存整表数据缓存（切回来要先秒还原）').toMatch(/histDataCache/)
    const watchFn = uiSource.slice(
      uiSource.indexOf('disposeHistFilterWatch = watch('),
      uiSource.indexOf('function unbindHistoryFilters'),
    )
    expect(watchFn, '切页签仍固定只拉第 1 页（之前的页数全丢）').not.toMatch(/void loadHistory\(1\)/)
    expect(watchFn, '切页签没有走统一入口（缓存优先 + 后台同步）').toMatch(/openHistoryView\(/)
    expect(uiSource, '没有按页大小区分缓存（改列数要重拉）').toMatch(/histPageSize/)
  })

  it('回填期间不提前建墙（否则只画第一页，后面几页追不上）', () => {
    const watchFn = modalsArea.slice(
      modalsArea.indexOf('watch(() => s.histDataVersion'),
      modalsArea.indexOf('watch(() => s.histZoom'),
    )
    const guardAt = watchFn.indexOf('if (s.histRestoring) {')
    const rebuild = watchFn.indexOf('rebuildMasonry()')
    expect(guardAt, '数据 watch 没有识别「回填中」').toBeGreaterThan(-1)
    expect(rebuild, '数据 watch 里找不到整墙重建').toBeGreaterThan(-1)
    // 回填分支必须自己 return —— 否则这一拍会把第一页画上去，后面几页再 append 就丢了
    const guardBlock = watchFn.slice(guardAt, watchFn.indexOf('const mode =', guardAt))
    expect(guardBlock, '回填分支没有提前 return（会先画第一页）').toMatch(/return/)
    expect(uiSource, '回填结束没有补推一拍版本（弹窗不会重建）').toMatch(
      /state\.histRestoring = false[\s\S]{0,160}state\.histDataVersion \+= 1/,
    )
  })

  it('缩放滑杆只有 4 档（删掉最小的一档，用户口径 2026-10-28）', () => {
    expect(modalsArea, 'ZOOM_MAX 仍是 5').toMatch(/const ZOOM_MAX = 4/)
    expect(modalsArea, '最小档位映射还留着第 5 档').not.toMatch(/5: 120/)
    expect(modalsArea, '第 4 档的宽度没有保留').toMatch(/4: 170/)
  })

  it('坏资源被摘掉后瀑布流真的重排（不是留空洞 / 全体堆一格）', () => {
    // 用户口径 2026-10-28：两次打开都是错位，拖一下缩放滑杆才恢复
    expect(masonrySource, '移除卡片时没有调用 Masonry 的 remove（只 layout 会留空洞）').toMatch(/function remove\(/)
    expect(masonrySource, 'remove 退化成只 layout').toMatch(/msnry\.remove\(elements\)/)
    expect(masonrySource, '实例未就绪时丢掉重排请求（异步 init 期间会被吞）').toMatch(/layoutPending/)
    expect(masonrySource, '重新 init 会覆盖新实例（快速开关面板会错乱）').toMatch(/initToken/)

    const fn = modalsArea.slice(
      modalsArea.indexOf('function showBrokenResourceCard'),
      modalsArea.indexOf('/**\n * 点卡片'),
    )
    expect(fn, '摘卡片没走 masonry.remove').toMatch(/masonry\.remove\(\[/)
    expect(fn, '摘卡片后仍在用可选链 layout（实例没建好就空调用）').not.toMatch(/instance\.value\?\.layout/)
  })

  it('图片既不 load 也不 error 时，超时按裂图处理（不留空白卡）', () => {
    const start = modalsArea.indexOf("img.addEventListener('load'")
    const end = modalsArea.indexOf('function buildMediaCard')
    const fn = modalsArea.slice(start, end > start ? end : undefined)
    expect(fn, '缺加载超时兜底（挂住的请求会留一块白卡）').toMatch(/setTimeout\(/)
    expect(fn, '超时没有归入异常处理').toMatch(/showBrokenResourceCard\(card, item\)/)
    expect(fn, '超时把已加载好的图也误摘了').toMatch(/naturalWidth > 0/) 
  })

  it('重开面板时容器还没量到宽度就不建墙（否则格子宽度算错）', () => {
    const fn = modalsArea.slice(
      modalsArea.indexOf('function switchWall'),
      modalsArea.indexOf('function relayoutMasonry'),
    )
    expect(fn.length, '切墙函数体没截到').toBeGreaterThan(200)
    expect(fn, '没有挡住 clientWidth=0 的情况').toMatch(/container\.clientWidth <= 0/)
    expect(fn, '量不到宽度没有下一帧重试').toMatch(/requestAnimationFrame/)
    expect(fn, '仍拿 lastColumnWidth 兜底（会用上一次的错误列宽）').not.toMatch(/\? calcColumns\(containerWidth\)\.columnWidth : lastColumnWidth/)
  })

  it('批量模式只增删勾选层，不重建整面墙（视频不会黑一下）', () => {
    const fn = modalsArea.slice(
      modalsArea.indexOf('function toggleBatchMode'),
      modalsArea.indexOf('/** 监听最后一张卡'),
    )
    expect(fn, '批量模式仍整墙重建（视频黑屏 / 音频波形重建）').not.toMatch(/rebuildMasonry/)
    expect(fn, '批量模式没有就地增删勾选层').toMatch(/syncBatchOverlays\(\)/)
    const sync = modalsArea.slice(
      modalsArea.indexOf('function syncBatchOverlays'),
      modalsArea.indexOf('/** 监听最后一张卡'),
    )
    expect(sync, '勾选层没有加到卡片上').toMatch(/appendChild\(buildCheckOverlay/)
    expect(sync, '退出批量模式没有摘掉勾选层').toMatch(/\.remove\(\)/)
  })

  it('切页签复用已建好的卡片墙（不重新创建视频/音频元素）', () => {
    expect(modalsArea, '没有保存每个页签的墙').toMatch(/wallCache/)
    expect(modalsArea, '切走时没有收墙（会直接销毁 DOM）').toMatch(/function stashCurrentWall/)
    expect(modalsArea, '切回来没有挂回旧墙').toMatch(/function switchWall/)
    const stash = modalsArea.slice(
      modalsArea.indexOf('function stashCurrentWall'),
      modalsArea.indexOf('function switchWall'),
    )
    expect(stash, '收墙时把卡片节点删掉了（媒体会重建）').not.toMatch(/innerHTML = ''/)
    expect(stash, '收墙没有记住滚动位置').toMatch(/scrollTop/)
    // 旧实现里"先 destroy + 清空"的那段会导致切页签闪一下，不能再回来
    const filterWatch = modalsArea.slice(
      modalsArea.indexOf("watch(() => [s.histScope"),
      modalsArea.indexOf('watch(() => s.histDataVersion'),
    )
    expect(filterWatch, '切页签仍先清空容器（会黑屏/重建波形）').not.toMatch(/innerHTML = ''/)
    expect(filterWatch, '切页签仍先销毁瀑布流').not.toMatch(/masonry\.destroy\(\)/)

    // 批量模式下的勾选层：卡片本身带 hist-card-check 的不许再走"重建"
    const batchFn = modalsArea.slice(
      modalsArea.indexOf('function toggleBatchMode'),
      modalsArea.indexOf('/** 监听最后一张卡'),
    )
    expect(batchFn, '批量操作仍在下一帧重建整墙').not.toMatch(/rebuildMasonry/)
  })

  it('新任务到达只把新卡插到最前面（不整墙重画）', () => {
    expect(uiSource, '上下文中没有 prepend 这种更新方式').toMatch(/histUpdateMode = fresh\.length > 0 \? 'prepend' :/)
    expect(modalsArea, '缺少插到最前面的渲染函数').toMatch(/function prependMasonryItems/)
    expect(modalsArea, '没有把新卡插到最前面').toMatch(/masonry\.prepend\(wrappers\)/)
    const subscribeFn = uiSource.slice(
      uiSource.indexOf('function bindHistoryUpdates'),
      uiSource.indexOf('function unbindHistory'),
    )
    const subscribeBody = subscribeFn.slice(subscribeFn.indexOf('svc.subscribe('))
    expect(subscribeBody, '收到新任务信号仍按当前页码整页重拉').not.toMatch(/loadHistory\(\)/)
    expect(subscribeFn, '收到新任务信号没有同步最新第 1 页').toMatch(/syncLatestHistory\(/)
  })

  it('是否还有下一页按 total 判断（末页刚好满页不会白拉一次空页）', () => {
    expect(uiSource, '仍用"本页条数 >= pageSize"判断还有下一页').not.toMatch(/histHasMore = page\.items\.length >=/)
    expect(uiSource, '没有按 total 计算是否还有下一页').toMatch(/histHasMore = page\.page \* page\.pageSize < page\.total/)
  })

  it('数据全拉完但还没渲染完时，哨兵仍然保留（否则余下卡片永远接不上）', () => {
    // 根因：histHasMore=false 时哨兵被 v-if 摘掉 → 剩下一批没渲染的卡永远没触发点
    const tpl = modalsArea.slice(modalsArea.indexOf('ref="loadSentinelEl"') - 900, modalsArea.indexOf('ref="loadSentinelEl"'))
    expect(tpl, '哨兵仍只看 histHasMore').not.toMatch(/v-if="ui\.histVisible\.value\.length && s\.histHasMore"/)
    expect(tpl, '哨兵没有用"还能继续加载"的条件').toMatch(/canLoadMore/)
    expect(modalsArea, '缺少 canLoadMore 计算（未渲染完也应保留哨兵）').toMatch(/const canLoadMore = computed/)
    expect(modalsArea, '没有渲染计数这个维度').toMatch(/renderedCount\.value < ui\.histVisible\.value\.length/)
  })

  it('切页签后不会被旧的补页请求挤掉第 1 页（点音频却还是图片）', () => {
    expect(uiSource, '第 1 页在途时没有拦住补页').toMatch(/historyFirstPagePending/)
    expect(uiSource, '仍在用会静默丢请求的时间窗口守卫').not.toMatch(/historyFilterSwitchedAt/)
    expect(uiSource, '筛选变化没有显式回到第 1 页（会沿用旧页码）').toMatch(/state\.histPage = 1/)
    expect(uiSource, '筛选变化没有重置在途请求').toMatch(/resetHistoryRequest\(\)/)
    expect(uiSource, '补页没有把页码与筛选签名一起定格').toMatch(/loadHistory\(nextPage, signature\)/)
  })

  it('音频恢复成白底波形细条，播放键与说明在卡片外', () => {
    const globalStyle = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    // ✅ 用户口径 2026-10-28 最终版：波形要有**卡片边框**包住（附红框截图）
    expect(globalStyle, '波形没有被卡片边框包住').toMatch(/\.hist-card-media--audio\s*\{[^}]*border:\s*1px/)
    expect(globalStyle, '音频条不是白底').toMatch(/\.hist-card-media--audio\s*\{[^}]*background:\s*var\(--ui-panel/)
    expect(globalStyle, '播放器自带底栏没有隐藏（会与卡外说明重复）').toMatch(/\.hist-card-audio-plugin \.apv-bar\s*\{\s*display:\s*none/)
    expect(globalStyle, '缺少卡外控制行样式').toMatch(/\.hist-card-audio-controls\s*\{/)
    expect(modalsArea, '音频卡没有生成卡外播放键').toMatch(/buildAudioControls\(item, el as HTMLAudioElement/)
    expect(modalsArea, '音频条高度没有恢复成 96px').toMatch(/media\.style\.height = '96px'/)
  })

  it('音频底栏布局：左=类型+进度，右=时长+无边框播放按钮', () => {
    const fn = modalsArea.slice(modalsArea.indexOf('function buildAudioControls'), modalsArea.indexOf('/** 整张卡的最后一行'))
    expect(fn, '缺少左半区（类型 + 当前进度）').toMatch(/hist-audio-left/)
    expect(fn, '左半区没有类型标签').toMatch(/className = 'hist-card-kind'/)
    expect(fn, '左半区没有播放进度').toMatch(/hist-audio-progress/)
    expect(fn, '缺少右半区（时长 + 播放按钮）').toMatch(/hist-audio-right/)
    expect(fn, '右半区没有时长').toMatch(/hist-audio-duration/)
    expect(fn, '播放按钮不在右半区').toMatch(/right\.appendChild\(duration\)[\s\S]{0,80}right\.appendChild\(btn\)/)

    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    const playRule = style.match(/\.hist-audio-play\s*\{[^}]*\}/)?.[0] ?? ''
    expect(playRule, '播放按钮仍带边框（用户口径：不要圆角边框）').not.toMatch(/border:\s*1px/)
    expect(playRule, '播放按钮仍有圆角').toMatch(/border:\s*0;[^}]*border-radius:\s*0;/)
  })

  it('音频底栏垂直居中：flex + items-center（文字与按钮同一中心线）', () => {
    const fn = modalsArea.slice(modalsArea.indexOf('function buildAudioControls'), modalsArea.indexOf('/** 整张卡的最后一行'))
    expect(fn, '控制行没有用 flex 布局').toMatch(/row\.style\.display = 'flex'/)
    expect(fn, '控制行没有垂直居中').toMatch(/row\.style\.alignItems = 'center'/)

    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    const rule = style.match(/\.hist-card-audio-controls\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, '样式表里底栏没有 align-items: center').toMatch(/align-items:\s*center/)
    expect(rule, '样式表里底栏没有 justify-content: space-between').toMatch(/justify-content:\s*space-between/)
  })

  it('音频卡普通模式点卡片不打开全屏（点击/拖动交给波形 seek）', () => {
    const fn = modalsArea.slice(
      modalsArea.indexOf('function onAudioCardClick'),
      modalsArea.indexOf('/** 历史条目类型'),
    )
    expect(fn, '缺少音频卡专用点击处理').toMatch(/function onAudioCardClick/)
    expect(fn, '普通模式又打开了全屏预览').not.toMatch(/openHistoryItem/)
    expect(fn, '批量模式没有切换选中').toMatch(/histBatchMode[\s\S]{0,120}toggleHistSelected/)
    const media = modalsArea.slice(
      modalsArea.indexOf('function buildMediaCard'),
      modalsArea.indexOf('/** 生成瀑布流里一张卡'),
    )
    expect(media, '音频卡没有走专用点击处理').toMatch(
      /isAudio\) card\.addEventListener\('click', \(\) => onAudioCardClick\(item\)\)/,
    )
    expect(media, '视频卡不再打开全屏预览').toMatch(
      /else card\.addEventListener\('click', \(\) => onCardClick\(item\)\)/,
    )
  })

  it('音频底栏的播放按钮右侧有独立全屏按钮', () => {
    const fn = modalsArea.slice(
      modalsArea.indexOf('function buildAudioControls'),
      modalsArea.indexOf('/** 整张卡的最后一行'),
    )
    expect(fn, '缺少全屏按钮').toMatch(/hist-audio-expand/)
    const playAt = fn.indexOf('right.appendChild(btn)')
    const expandAt = fn.indexOf('right.appendChild(expand)')
    expect(playAt, '播放按钮没有挂到右半区').toBeGreaterThan(-1)
    expect(expandAt, '全屏按钮不在播放按钮右侧').toBeGreaterThan(playAt)
    expect(fn, '全屏按钮没有打开预览').toMatch(
      /expand\.addEventListener\('click'[\s\S]{0,200}openHistoryItem\(item\)/,
    )
    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    const rule = style.match(/\.hist-audio-expand\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, '全屏按钮带边框/圆角（应与播放按钮同一套无边框样式）').toMatch(
      /border:\s*0;[^}]*border-radius:\s*0;/,
    )
  })

  it('历史卡的波形可点/可拖 seek（只在紧凑模式，不拦画布节点拖动）', () => {
    expect(audioWavePlayer, '缺少波形指针 seek').toMatch(/function onWavePointerDown/)
    expect(audioWavePlayer, '波形 seek 没有限制在紧凑模式').toMatch(/if \(!props\.compact\) return/)
    expect(audioWavePlayer, '波形区没有接 pointerdown').toMatch(/@pointerdown="onWavePointerDown"/)
    // 批量模式要能点波形选中卡片：波形不拦 click，只拦 pointer 手势
    expect(audioWavePlayer, '波形上挂了 click 拦截，批量模式点波形会选不中').not.toMatch(/@click=/) 
    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    expect(style, '批量模式下波形仍接收指针事件（点波形选不中整卡）').toMatch(
      /\.hist-card--batch \.hist-card-audio-plugin[^{]*\{[^}]*pointer-events:\s*none/,
    )
    // 详情钮挂在媒体框上（不是插件层）：媒体框不能一起关指针，否则详情点不开
    expect(style, '批量模式把媒体框的指针也关了 → 右上角详情点不开').not.toMatch(
      /\.hist-card--batch \.hist-card-media--audio\s*\{[^}]*pointer-events/,
    )
  })

  it('视频卡走与图片一致的瀑布流（不再写死 180px 高）', () => {
    // 旧实现：.hist-card-video-plugin { height: 180px } + 卡片固定 16:9 —— 视频整排等高、与图片不齐
    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    expect(style, '视频卡仍写死高度，瀑布流按真实比例排布会失效').not.toMatch(/\.hist-card-video-plugin\s*\{[^}]*height:\s*180px/)
    expect(style, '视频媒体框没有铺满媒体区').toMatch(/\.hist-card-video-plugin\s*\{[^}]*position:\s*absolute/)
    expect(style, '媒体框缺少按产物宽高比排布的能力（aspect-ratio 未与 media 元数据联动）').toMatch(/\.hist-card-media\s*\{/)
    expect(modalsArea, '卡片没有用 media 元数据给真实比例').toMatch(/function mediaAspect/)
  })

  it('方案 5：信息全部在图片外，一行 = 类型标签 + 宽高 · 时长 · 大小', () => {
    const fn = modalsArea.slice(modalsArea.indexOf('function buildFactsLine'), modalsArea.indexOf('/** 整张卡的最后一行'))
    expect(fn, '信息行没有类型标签').toMatch(/hist-card-kind/)
    expect(fn, '信息行没显示宽高').toMatch(/item\.media\.width\s*\+\s*'×'\s*\+\s*item\.media\.height/)
    expect(fn, '信息行没显示时长').toMatch(/formatDuration\(item\.media\?\.durationMs\)/)
    expect(fn, '信息行没显示文件大小').toMatch(/formatBytes\(item\.media\?\.bytes\)/)
    // 图片上不许再有任何信息浮层
    const globalStyle = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    expect(globalStyle, '图片上还压着渐变信息条').not.toMatch(/\.hist-card-tags\s*\{/)
    expect(modalsArea, '还有地方把信息角标挂回图片里').not.toMatch(/media\.appendChild\(buildMediaTags/)
    // 三类卡（媒体卡 / 媒体兜底 / 图片卡）都要走同一个出口补信息行
    expect(modalsArea.match(/return finishCard\(card, item\)/g)?.length ?? 0, '有卡片没走统一的信息行出口').toBeGreaterThanOrEqual(2)
  })

  it('音频没有宽高：信息行不显示尺寸；视频/图片才显示', () => {
    const fn = modalsArea.slice(modalsArea.indexOf('function buildFactsLine'), modalsArea.indexOf('/** 整张卡的最后一行'))
    // 音频不推送宽高（媒体没有可视尺寸），只推送时长与大小
    expect(fn, '音频被塞了宽高').toMatch(/item\.media\?\.width\s*&&\s*item\.media\?\.height/)
    expect(modalsArea, '音频没有画面，不该补 videoWidth/videoHeight').toMatch(/const w = !isAudio \? v\.videoWidth/)
  })

  it('音频卡在亮色主题下不用主题强调色（白底 + 中性波形）', () => {
    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    expect(style, '音频兜底卡仍在用主题强调色渐变').not.toMatch(/\.hist-card-audio\s*\{[^}]*--ui-accent-soft/)
    expect(style, '音频兜底卡没有改成中性底色').toMatch(/\.hist-card-audio\s*\{[^}]*--ui-veil/)
    expect(style, '历史卡里的音频波形仍会吃主题强调色').not.toMatch(/\.hist-card-audio-plugin \.aw-wave-bar\.is-played[^}]*--ui-accent/)
  })

  it('坏掉的媒体归入「显示异常」：关着时整条隐藏（与图片同一口径）', () => {
    const fn = modalsArea.slice(modalsArea.indexOf('function showBrokenResourceCard'), modalsArea.indexOf('/** 历史条目类型'))
    expect(fn, '坏媒体没有走统一的异常处理').toMatch(/if \(!s\.histShowError\)/)
    expect(fn, '关掉开关时没有把整格摘除').toMatch(/slot\.remove\(\)/)
    expect(modalsArea, '视频/音频元素没有接 error → 坏媒体不会归入异常').toMatch(/addEventListener\('error', \(\) => showBrokenResourceCard\(card, item\)\)/)
  })

  it('卡片有「详情」入口，弹窗展示提示词/参数/参考素材/产物信息', () => {
    expect(modalsArea, '卡片上没有详情按钮构建函数').toMatch(/function buildDetailButton/)
    expect(modalsArea, '详情入口没有挂到卡片上').toMatch(/appendChild\(buildDetailButton\(item\)\)/)
    expect(modalsArea, '详情弹窗没有提示词').toMatch(/detailItem\.prompt/)
    expect(modalsArea, '详情弹窗没有生成参数').toMatch(/detailItem\.values/)
    expect(modalsArea, '详情弹窗没有参考素材').toMatch(/detailItem\.resources/)
  })

  it('评级相关 UI 隐藏（逻辑保留，只收起入口）', () => {
    expect(modalsArea, '缺少评级 UI 开关常量').toMatch(/const SHOW_RATING_UI = false/)
    // 筛选下拉与批量评级按钮都必须受开关控制
    expect(modalsArea, '评级筛选仍无条件渲染').toMatch(/<template v-if="SHOW_RATING_UI">[\s\S]{0,400}aria-label="所有评级"/)
    expect(modalsArea, '批量评级按钮仍无条件渲染').toMatch(/<button v-if="SHOW_RATING_UI"[\s\S]{0,220}aria-label="批量评级"/)
    // 逻辑不许删：以后要恢复，只是把开关改成 true
    expect(uiSource, '评级筛选逻辑被删了（要求隐藏不删除）').toMatch(/histRating:/)
    expect(uiSource, '批量评级逻辑被删了（要求隐藏不删除）').toMatch(/batchRateHistory/)
  })

  it('「保存到资产」走右键菜单同一条上传弹窗（不是静默入库）', () => {
    const start = uiSource.indexOf('function batchSaveAssets')
    // 函数体到下一个顶层注释块 / 顶层函数为止（用花括号配平更稳，避免被内部注释截断）
    let depth = 0
    let end = start
    for (let i = uiSource.indexOf('{', start); i < uiSource.length; i++) {
      if (uiSource[i] === '{') depth++
      else if (uiSource[i] === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
    const fn = uiSource.slice(start, end)
    expect(fn, '仍直接调后台静默入库（用户点了看不到上传弹窗）').not.toMatch(/batch-save-assets/)
    expect(fn, '没有把选中的产物贴进上传总线').toMatch(/queueUploads\(items\)/)
    expect(fn, '没有从选中记录取产物地址').toMatch(/const url = e\.urls/)
  })
})

