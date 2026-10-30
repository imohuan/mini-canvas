/**
 * 全屏预览底部控制条的**结构契约**（用户口径 2026-10-29）。
 *
 * 用户原话：「你提供了这种 list 可以上下切换的时候，底部应该显示卡片内容」
 * —— 图片有底部那套（页码 · 缩放 · 旋转 · 镜像 · 重置 · 下载），视频/音频没有。
 * 期望：
 *   1. 控制条**常驻**（不再只对图片出现）；页码 + 下载是所有媒体都有的常驻项；
 *   2. 视频：不缩放，但保留旋转 / 镜像 / 下载；
 *   3. 音频 / 文本 / 其它：只有页码 + 下载。
 *
 * 读源码断言（与 historyMediaCardLayout 同手法）：控件条结构住在 MediaViewer 模板里，
 * 渲染它需要 Teleport + 注册件，Node 环境跑不起来。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const viewer = readFileSync(
  new URL('../../../plugins/plugin-theme-default/src/components/ui/MediaViewer.vue', import.meta.url),
  'utf-8',
)

/**
 * 只取 <template> 段：样式里也有 .mv-controls，混在一起断言会假绿。
 * ⚠️ 必须用**最后一个** </template> —— 控件条里有嵌套的 <template v-if="isMultiple">，
 * 用 indexOf 会截到那个内层结束标签，后面整段按钮全被切掉（第一版就踩了）。
 */
const template = viewer.slice(viewer.indexOf('<template>'), viewer.lastIndexOf('</template>'))

describe('全屏预览底部控制条', () => {
  it('控制条常驻（不再用 v-if="canZoom" 只在图片时出现）', () => {
    expect(template, '控制条仍只在 canZoom 时渲染（视频/音频没有底部条）').not.toMatch(/<div v-if="canZoom" class="mv-controls"/)
    expect(template, '找不到常驻的控制条容器').toMatch(/<div class="mv-controls"/)
  })

  it('页码是常驻项（多张时显示，与媒体类型无关）', () => {
    const pageAt = template.indexOf('class="mv-page"')
    expect(pageAt, '控制条里没有页码').toBeGreaterThan(-1)
    // 页码必须在控制条容器内、且不带 canZoom/isImage 条件
    const controlsAt = template.indexOf('class="mv-controls"')
    expect(pageAt, '页码不在控制条容器里').toBeGreaterThan(controlsAt)
    const seg = template.slice(controlsAt, pageAt)
    expect(seg, '页码被 canZoom 条件包住了（视频/音频看不到页码）').not.toMatch(/v-if="canZoom"/)
  })

  it('下载按钮没有任何类型条件（所有媒体都有）', () => {
    const btn = template.match(/<button[^>]*aria-label="下载"[^>]*>/)?.[0] ?? ''
    expect(btn, '找不到下载按钮').not.toBe('')
    expect(btn, '下载按钮带了 v-if 条件（音频/视频就没了）').not.toMatch(/v-if=/)
  })

  it('缩放（缩小/百分比/放大/重置）只在图片出现', () => {
    // 缩小 / 放大 / 重置都被 canZoom 包着；百分比标签也在 canZoom 的 template 里
    for (const label of ['缩小', '放大', '重置']) {
      const re = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`)
      expect(template, `找不到「${label}」按钮`).toMatch(re)
    }
    const zoomAt = template.indexOf('aria-label="缩小"')
    const wrapStart = template.lastIndexOf('<template v-if="canZoom">', zoomAt)
    expect(wrapStart, '缩放组没有包在 canZoom 分支里（视频会出现不能用的缩放）').toBeGreaterThan(-1)
    // 这个分支要一直包到放大按钮之后
    const wrapEnd = template.indexOf('</template>', zoomAt)
    expect(template.slice(zoomAt, wrapEnd), '放大按钮不在 canZoom 分支里').toContain('aria-label="放大"')
  })

  it('旋转 / 镜像对图片与视频都出现（hasTools）', () => {
    for (const label of ['旋转', '镜像']) {
      const btn = template.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? ''
      expect(btn, `找不到「${label}」按钮`).not.toBe('')
      expect(btn, `「${label}」仍只在图片时出现（视频缺这两个功能）`).toMatch(/v-if="hasTools"/)
    }
    expect(viewer, '没有 hasTools 判定（图片+视频）').toMatch(/const hasTools = computed\(\(\) => isImage\.value \|\| kind\.value === "video"\)/)
  })

  it('视频的旋转/镜像作用在舞台盒上，不碰视频元素本身', () => {
    // 变换层上还挂着 ref（量尺寸算缩放系数），所以按 class + style 绑定判，不要求属性紧邻
    expect(template, '视频舞台里没有变换层').toMatch(/<div[^>]*class="mv-video-transform"[^>]*:style="videoTransform"/)
    expect(viewer, '缺少 videoTransform 计算').toMatch(/const videoTransform = computed/)
    // 视频元素本身不该挂 transform 样式（会与插件内部缩放冲突）
    const videoTag = template.match(/<video[^>]*class="mv-video"[^>]*>/)?.[0] ?? ''
    expect(videoTag, '视频元素自己挂了 style（应由外层变换层承担）').not.toMatch(/:style=/)
  })

  it('换张 / 重新打开时视频朝向归零（不继承上一张的旋转）', () => {
    const prev = viewer.slice(viewer.indexOf('function prevImage'), viewer.indexOf('function download'))
    expect(prev, '换张没有重置视频变换').toMatch(/videoTransformReset\(\)/)
    expect(viewer, '打开预览时没有重置视频变换').toMatch(/resetTransform\(\)\s*\n\s*videoTransformReset\(\)/)
  })
})

/**
 * 视频全屏的尺寸下限（2026-10-30 用户口径）：小竖屏视频按 max-width/max-height 收进
 * 舞台后可能只有一小块，看不清。用户口径：最小宽度也要占全屏的 80%（与最大宽度同）。
 * 音频全屏则删掉顶部标题行 —— 名称与插件件自带的名称重复、页码与底部条重复。
 */
describe('全屏视频尺寸下限与音频标题', () => {
  it('tall 模式的根容器有 min-width/min-height 下限（占满屏的 80%）', () => {
    const preview = readFileSync(
      new URL('../../../plugins/plugin-node-video/src/VideoPreview.vue', import.meta.url),
      'utf-8',
    )
    const fit = preview.slice(preview.indexOf('const rootFitStyle'), preview.indexOf('const videoRef'))
    expect(fit, '找不到 rootFitStyle').not.toBe('')
    expect(fit, '没有 min-width 下限（小视频会缩成一小块）').toMatch(/minWidth/)
    expect(fit, '没有 min-height 下限').toMatch(/minHeight/)
    expect(fit, '下限不是 80%').toMatch(/'80%'|"80%"|80%/)
  })

  it('音频全屏没有顶部标题行（名称与插件自带文案重复）', () => {
    expect(template, '音频卡里还留着标题行').not.toMatch(/mv-plugin-title/)
  })
})
