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
})

