/**
 * 素材卡 CSS 契约：**卡片的 `transform` 过渡必须为空**。
 *
 * 用户口径（2026-10-12，带截图）：「拖拽有问题啊！一号标是我的鼠标位置，我都拖到这个位置了，
 * 但是你的这个元素只移动了一点点距离。我感觉你这边有种缩放阻尼的感觉，它没有跟随我的鼠标。」
 *
 * 根因（真机实测 + 对照实验定位）：卡片上有 `transition: transform 0.15s`，而拖拽库每一帧都在
 * 给这张卡写 `transform: matrix(..., tx, 0)`（写进去的值本身是精确 1:1 的）——
 * 过渡把这串逐帧变化的位移**补间**起来，移动越快落后越多（量到鼠标走 250px、元素只走 100px）。
 *
 * 还有第二层坑：给被拖拽的那张卡**任何形式的放大**（`transform: scale` 或独立的 `scale` 属性）
 * 都会把库写的位移一起放大 —— 独立属性与 `transform` 是 `translate·rotate·scale·transform` 复合，
 * `scale: 1.06` 会把 translate 的 dx 也乘 1.06（量到 300px 时位置到 317px）。
 *
 * 所以这里逐条锁死（改坏了真机立刻能看出来，但单测能更早拦住）：
 * 1. `.nb-card` 的 transition 里**不能**出现 `transform`；
 * 2. 拖拽三态里**不能**出现 `transform` / `scale`；
 * 3. 按下回弹（`.nb-card:active`）保留缩放，用独立的 `scale` 属性。
 *
 * 追加（2026-10-12 同日）：卡片右上角的**关闭按钮**有一半在卡片外，卡片自己必须留
 * `overflow: visible`，圆角裁剪挪到内层 `.nb-card-clip` —— 否则按钮被裁成半个（用户点名提醒）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SFC = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')

/** 去掉 CSS 注释：注释里会写到「transform」「scale: 1.06」这些词（解释为什么不能这么写），
 *  不剥掉会把说明文字当成真声明查出来（实测踩过）。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 取某条样式块的正文：从该选择器**第一次出现**的位置往后找第一个 `{`，再取到下一个 `}`。
 * 这样 `.nb-card--chosen,\n.nb-card--drag { ... }` 这种多选择器合写也能取到（按第一个名字取）。
 * 该仓库的样式块里没有嵌套大括号，取到下一个 `}` 即可，不做完整 CSS 解析。
 */
function block(selector: string): string {
  const i = SFC.indexOf(selector + ' {')
  const j = i >= 0 ? i : SFC.indexOf(selector)
  if (j < 0) throw new Error('找不到样式块：' + selector)
  const start = SFC.indexOf('{', j) + 1
  const end = SFC.indexOf('}', start)
  return stripComments(SFC.slice(start, end))
}

/** 该选择器所在的整条规则头（含多选择器合写的其它名字），用来确认合写块里没混进别的名字 */
function selectorHead(selector: string): string {
  const j = SFC.indexOf(selector + ' {')
  const k = j >= 0 ? j : SFC.indexOf(selector)
  if (k < 0) throw new Error('找不到选择器：' + selector)
  const brace = SFC.indexOf('{', k)
  // 往回退到上一条 `}` 或 `*/`，中间就是这一条规则的选择器列表
  const before = SFC.slice(0, k)
  const boundary = Math.max(before.lastIndexOf('}'), before.lastIndexOf('*/'), before.lastIndexOf(';'))
  return SFC.slice(boundary + 1, brace)
}

describe('素材卡：拖拽必须跟手（transition / 缩放都不许碰 transform）', () => {
  it('.nb-card 的 transition 里没有 transform（有它就会把库写的逐帧位移补间成「慢半拍」）', () => {
    const css = block('.nb-card')
    const transition = css.match(/transition\s*:([^;]*)/)?.[1] ?? ''
    expect(transition).not.toMatch(/\btransform\b/)
    // 按下回弹仍然要有（只是改走 scale 属性）
    expect(transition).toMatch(/\bscale\b/)
  })

  it('拖拽三态（ghost/chosen/drag）不用 transform，也不用独立的 scale', () => {
    for (const sel of ['.nb-card--ghost', '.nb-card--chosen', '.nb-card--drag']) {
      const css = block(sel)
      expect(css, sel + ' 不该动 transform').not.toMatch(/transform\s*:/)
      expect(css, sel + ' 不该动 scale（会把库写的位移一起放大）').not.toMatch(/(^|[;\s])scale\s*:/)
    }
  })

  it('chosen/drag 是同一个样式块（省得两边漂移）', () => {
    const head = selectorHead('.nb-card--chosen')
    expect(head).toContain('.nb-card--chosen')
    expect(head).toContain('.nb-card--drag')
  })

  it('按下回弹用独立的 scale 属性（不写进 transform，免得与拖拽库抢同一个属性）', () => {
    const css = block('.nb-card:active')
    expect(css).toMatch(/scale\s*:\s*0\.96/)
    expect(css).not.toMatch(/transform\s*:/)
  })
})

describe('素材卡关闭按钮：一半在卡片外（不能被裁剪）', () => {
/**
 * 卡片缩略图**不模糊**（用户 2026-10-29：「这边卡片里面这个图片，不需要给它添加模糊了」）。
 *
 * 历史：2026-10-01 用户要求过图片本身加模糊，于是 .nb-card-img 带了
 * filter: blur(1px) + transform: scale(1.18)（scale 是为了模糊不啃边）。
 * 2026-10-29 明确取消，两行都要去掉 —— 只删 blur 留下 scale 会让图片被无故放大。
 */
describe('素材卡缩略图：不模糊', () => {
  it('没有 filter: blur', () => {
    expect(block('.nb-card-img')).not.toMatch(/filter\s*:\s*blur/)
  })

  it('也没有为模糊补偿的放大（transform: scale）', () => {
    expect(block('.nb-card-img')).not.toMatch(/transform\s*:\s*scale/)
  })

  it('仍然是 cover 铺满正方形', () => {
    const css = block('.nb-card-img')
    expect(css).toMatch(/object-fit\s*:\s*cover/)
    expect(css).toMatch(/width\s*:\s*100%/)
    expect(css).toMatch(/height\s*:\s*100%/)
  })
})

  /**
   * 用户口径（2026-10-12）：「在右上角区域 hover 时，应该显示一个关闭按钮。需要注意：
   * ① 按钮不要被 overflow:hidden 隐藏掉，因为它放在右上角，有一半在外面；
   * ② 点击该按钮后可以进行关闭，即删除与该图片相关的连接线」。
   */
  it('卡片自己 overflow: visible（按钮一半在卡外，裁掉就只剩半个、点不着）', () => {
    expect(block('.nb-card')).toMatch(/overflow\s*:\s*visible/)
  })

  it('圆角裁剪挪到内层 .nb-card-clip（正方形/圆角/图片裁进来仍归它管）', () => {
    const css = block('.nb-card-clip')
    expect(css).toMatch(/overflow\s*:\s*hidden/)
    /**
     * 2026-10-29：圆角**不许再用 inherit**，要写和卡片一样的具体值。
     * 卡片里嵌了主题 Tooltip 的两层透明外壳（.tlt-root / .tlt-trigger，都没圆角），
     * inherit 只继承直接父级 → 拿到 0，用户截图里卡片就变成直角了。
     */
    const clip = css.match(/border-radius\s*:\s*([^;]+)/)?.[1]?.trim()
    const card = block('.nb-card').match(/border-radius\s*:\s*([^;]+)/)?.[1]?.trim()
    expect(clip).toBeTruthy()
    expect(clip).not.toBe('inherit')
    expect(clip).toBe(card)
  })

  it('关闭按钮默认藏起来，hover / 键盘聚焦才露出（且 hover 转危险色）', () => {
    const css = block('.nb-remove')
    expect(css).toMatch(/opacity\s*:\s*0/)
    /**
     * 用户 2026-10-29 报「点不动」后改的口径：**视觉隐藏但始终可点**。
     * 隐藏态若关掉 pointer-events，鼠标从卡片外靠近时那几像素的缝会落到画布上
     * （真机复现：elementFromPoint 命中别的元素）——所以这里明确要求 auto。
     */
    expect(css).toMatch(/pointer-events\s*:\s*auto/)
    // 露出的三条路径：卡 hover / 卡内聚焦 / 按钮自己聚焦
    for (const sel of ['.nb-card:hover .nb-remove', '.nb-card:focus-within .nb-remove', '.nb-remove:focus-visible']) {
      const show = block(sel)
      expect(show, sel + ' 要把按钮露出来').toMatch(/opacity\s*:\s*1/)
      expect(show, sel + ' 要把按钮显现出来').toMatch(/opacity\s*:\s*1/)
    }
    expect(block('.nb-remove:hover')).toMatch(/--ui-danger/)
  })
})
