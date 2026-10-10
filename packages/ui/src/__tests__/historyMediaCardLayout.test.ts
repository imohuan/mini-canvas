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

