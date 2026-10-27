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
    expect(viaHandler, '卡片点击没全部接 onCardClick（批量模式下点卡片不会选中）').toBe(4)
    expect(modalsArea, 'onCardClick 在批量模式下没有切换选中').toMatch(
      /function onCardClick\(item: HistItem\)[\s\S]{0,220}histBatchMode[\s\S]{0,120}toggleHistSelected\(item\.id\)/,
    )
  })

  it('数据比面板晚到时，加载哨兵会在渲染后补挂观察（否则滚到底不翻页）', () => {
    // 哨兵是 v-if；setupLoadSentinel 必须在数据版本变化 + 重建后各补一次
    const dataWatch = modalsArea.slice(modalsArea.indexOf("watch(() => s.histDataVersion"), modalsArea.indexOf("watch(() => s.histZoom"))
    expect(dataWatch, '数据到位后没有补挂哨兵观察器').toMatch(/setupLoadSentinel\(\)/)
    expect(dataWatch, '瀑布流没实例时没有整墙重建（会排成一列且哨兵无人观察）').toMatch(/needsRebuild/)

    const rebuild = modalsArea.slice(modalsArea.indexOf('function rebuildMasonry'), modalsArea.indexOf('/** 只把新增一批'))
    expect(rebuild, '整墙重建后没有补挂哨兵观察器').toMatch(/setupLoadSentinel\(\)/)

    const setup = modalsArea.slice(modalsArea.indexOf('function setupLoadSentinel'), modalsArea.indexOf('function teardownLoadSentinel'))
    expect(setup, '同一哨兵重复 setup 会重复观察').toMatch(/observedSentinel/)
  })

  it('视频卡走与图片一致的瀑布流（不再写死 180px 高）', () => {
    // 旧实现：.hist-card-video-plugin { height: 180px } + 卡片固定 16:9 —— 视频整排等高、与图片不齐
    const style = modalsArea.slice(modalsArea.lastIndexOf('<style>'))
    expect(style, '视频卡仍写死高度，瀑布流按真实比例排布会失效').not.toMatch(/\.hist-card-video-plugin\s*\{[^}]*height:\s*180px/)
    expect(style, '视频媒体框没有铺满媒体区').toMatch(/\.hist-card-video-plugin\s*\{[^}]*position:\s*absolute/)
    expect(style, '媒体框缺少按产物宽高比排布的能力（aspect-ratio 未与 media 元数据联动）').toMatch(/\.hist-card-media\s*\{/)
    expect(modalsArea, '卡片没有用 media 元数据给真实比例').toMatch(/function mediaAspect/)
  })

  it('视频/音频卡显示宽高比、时长、文件大小（与图片卡同一套角标）', () => {
    const tags = modalsArea.slice(modalsArea.indexOf('function buildMediaTags'), modalsArea.indexOf('function buildDetailButton'))
    expect(tags, '角标没显示宽高').toMatch(/width\s*\+\s*'×'\s*\+\s*height/)
    expect(tags, '角标没显示时长').toMatch(/formatDuration\(durationMs\)/)
    expect(tags, '角标没显示文件大小').toMatch(/formatBytes\(bytes\)/)
    expect(modalsArea, '媒体卡没有调用统一角标').toMatch(/media\.appendChild\(buildMediaTags\(item\)\)/)
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

