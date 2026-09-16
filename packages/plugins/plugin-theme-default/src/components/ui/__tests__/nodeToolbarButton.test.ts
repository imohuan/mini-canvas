/**
 * NodeToolbarButton 渲染契约（用户可见行为）。
 *
 * 用户要求："你这里可以实现一个通用的按钮什么的" —— 插件往节点的上/下插槽里放按钮时，
 * 不该每个插件再抄一份 32×32 / 圆角 8 / hover 态 / focus 环的样式（此前图片顶部条、
 * 图片生成栏、文本生成栏各写了一份 .xx-icon-btn，数值已经开始漂移）。
 *
 * 按 docs/design/ui-style-guide.md §3.3 + §5：纯图标按钮必须同时有 title 与 aria-label；
 * 禁用要真的加 disabled；强调色只有青（active/primary）与红（danger）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import NodeToolbarButton from '../NodeToolbarButton.vue'

const UPLOAD_ICON =
  '<svg viewBox="0 0 24 24" data-probe="icon-hit"><path d="M12 3v12"/></svg>'

function render(props: Record<string, unknown>, slots: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(NodeToolbarButton, props, {
        default: slots.default as never,
      }),
  })
  return renderToString(app)
}

describe('NodeToolbarButton：无障碍与图标形态', () => {
  it('纯图标按钮：title 与 aria-label 同时给到（规范硬性要求）', async () => {
    const html = await render({ title: '上传图片', icon: UPLOAD_ICON })
    expect(html).toContain('title="上传图片"')
    expect(html).toContain('aria-label="上传图片"')
  })

  it('SVG 字符串图标 → 内联渲染出来', async () => {
    const html = await render({ title: '上传图片', icon: UPLOAD_ICON })
    expect(html).toContain('data-probe="icon-hit"')
  })

  it('Vue 组件图标 → 也支持（句柄 opaque，与节点 icon 同源）', async () => {
    const Icon = { name: 'IconComp', render: () => h('svg', { 'data-comp': 'hit' }) }
    const html = await render({ title: '裁剪图片', icon: Icon })
    expect(html).toContain('data-comp="hit"')
  })

  it('没给图标 → 不渲染图标位（不留一个空壳）', async () => {
    const html = await render({ title: '发送' }, { default: () => '发送' })
    expect(html).not.toContain('ntb-icon')
    expect(html).toContain('发送')
  })
})

describe('NodeToolbarButton：状态', () => {
  it('禁用 → 真的加 disabled 属性（不是只变灰）', async () => {
    const html = await render({ title: '裁剪图片', icon: UPLOAD_ICON, disabled: true })
    expect(html).toMatch(/<button[^>]*disabled/)
  })

  it('给了 active 才当开关按钮报 aria-pressed；没给就不报（普通按钮不该被读屏当开关）', async () => {
    const on = await render({ title: '对齐', icon: UPLOAD_ICON, active: true })
    expect(on).toContain('aria-pressed="true"')
    expect(on).toContain('is-active')

    const off = await render({ title: '对齐', icon: UPLOAD_ICON, active: false })
    expect(off).toContain('aria-pressed="false"')
    expect(off).not.toContain('is-active')

    // 不传 active：既不带激活样式，也不冒充开关
    const plain = await render({ title: '上传图片', icon: UPLOAD_ICON })
    expect(plain).not.toContain('aria-pressed')
    expect(plain).not.toContain('is-active')
  })

  it('variant 三种：默认灰底 / primary 青底 / danger 悬停转红', async () => {
    expect(await render({ title: 'a', icon: UPLOAD_ICON })).toContain('ntb-btn--ghost')
    expect(await render({ title: 'a', icon: UPLOAD_ICON, variant: 'primary' })).toContain('ntb-btn--primary')
    expect(await render({ title: 'a', icon: UPLOAD_ICON, variant: 'danger' })).toContain('ntb-btn--danger')
  })

  it('没有 size 参数：交互目标固定 32px（规范 §5 第 4 条，不给"缩到 28"这条违规捷径）', async () => {
    const html = await render({ title: 'a', icon: UPLOAD_ICON })
    expect(html).toContain('is-icon-only')
    // 尺寸只在样式表里，不接受外部覆盖
    expect(html).not.toContain('--ntb-size')
  })
})

describe('NodeToolbarButton：行为', () => {
  it('点击触发 click（按钮是 type=button，不会误提交表单）', async () => {
    const html = await render({ title: '上传图片', icon: UPLOAD_ICON })
    expect(html).toContain('type="button"')
  })
})
