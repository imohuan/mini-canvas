/**
 * VideoContent 渲染契约（SSR 拿真 HTML 断言）。
 *
 * 本文件从"视频元素"换成"帧图"之后，断言重心也变了 ——
 * 画面元素在 SSR 里是**异步抓帧**的（真浏览器才有 canvas/video），所以这里只锁两件
 * 与"有没有渲染出来"无关、但用户最在意的事：
 *
 * 1. **未播放时不渲染 video 元素**（用户硬要求："只有点播放的时候才真正加载视频"）——
 *    这条必须守住，包括"帧图还没抓好"的那一瞬间；
 * 2. 播放控件与可达性（纯图标按钮都要有 title + aria-label）、裁剪中不渲染控件、空态/失效态。
 *
 * 取景几何（裁剪框 → 放大偏移的百分比）**不在这里重复断言**：
 * 它由 canvas-render 的 mediaFit.test.ts 直接测（含脏数据边界），这里再走一遍 DOM
 * 只是把同一份数学抄第二遍。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import VideoContent from '../VideoContent.vue'
import { beginOverlay, endOverlay } from '../videoSession'
import { framingStyle } from '../videoCrop'

const VIDEO = '/api/canvases/c1/resources/abc.mp4'

/** 最小渲染上下文：组件还要用 ctx.get('command'/'settings') 与 ctx.on */
function renderCtx(selectedIds: string[] = []): CanvasRenderContext {
  /**
   * selection 服务的最小桩：useSoleNodeSelected 只读 ids.size / has / onChange。
   * 传 [id] = 单选；传两个 = 多选；空 = 未选中。
   */
  const selectionIds = new Set(selectedIds)
  const services: Record<string, unknown> = {
    nodeStore: { getNode: () => undefined, getNodes: () => [] },
    graph: { updateNode: () => {} },
    command: { execute: () => undefined },
    settings: { get: () => undefined, onChange: () => ({ dispose: () => {} }) },
    selection: {
      ids: selectionIds,
      has: (id: string) => selectionIds.has(id),
      onChange: () => () => {},
    },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      on: () => ({ dispose: () => {} }),
      // 极简上下文：没有主题 ui 目录 → 空态回落到组件自身的一行灰字
      registryOf: () => new RegistryImpl(),
    },
    flow: { viewport: { value: { zoom: 1 } } },
    // 可视区闸门（生成帧图前会问一句"这个节点在不在视野里"）
    visibleNodes: () => [{ id: 'v1', x: 0, y: 0, w: 100, h: 100 }],
  } as unknown as CanvasRenderContext
}

function render(id: string, data: Record<string, unknown>, selectedIds: string[] = []): Promise<string> {
  const app = createSSRApp({ render: () => h(VideoContent as Component, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, renderCtx(selectedIds))
  return renderToString(app)
}

/**
 * 取出播放控件那一个 div 的 class 串。
 *
 * 为什么不用 `/class="video-controls[^"]*"/`：静态 class 与 :class 在 SSR 里
 * 合成同一个属性，合并后的顺序不一定是"video-controls 开头"，
 * 于是正则一个都匹配不到、测试静默通过（或报 '' 不含关键字）。
 * 这里改用「找出含 video-controls 的那个 class 属性」，顺序无关。
 */
function videoControlsClass(html: string): string {
  const all = html.match(/class="[^"]*"/g) ?? []
  return all.find((c) => c.includes('video-controls')) ?? ''
}

describe('未播放：不加载视频字节', () => {
  it('有视频地址但没点过播放 → 不渲染 video 元素', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('<video')
  })

  it('抓帧还没好（SSR 就是这种情况）也不挂 video —— 宁可先空着', async () => {
    // 这条防的是"帧图未就绪时用 video 顶上"的退让：那会立刻开始加载视频，
    // 正是用户要求"点播放才加载"要避免的
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1920, videoHeight: 1080 })
    expect(html).not.toContain('<video')
    expect(html).not.toContain('src=""')
  })
})

describe('取景几何（裁剪框 → 放大与偏移）', () => {
  // 用纯函数断言，不走 DOM：几何同源（framedMediaStyle），且 SSR 里画面元素是异步的
  it('裁剪框写进 style 的百分比与框位置一致', () => {
    const style = framingStyle({ x: 400, y: 200, width: 800, height: 400 }, 1600, 800)
    // 1600/800 = 200%；-400/800 = -50%；-200/400 = -50%
    expect(style).toMatchObject({ width: '200%', height: '200%', left: '-50%', top: '-50%' })
  })

  it('没裁过 / 脏数据 → 空样式（不施加放大偏移）', () => {
    expect(framingStyle(undefined, 1600, 800)).toEqual({})
    expect(framingStyle({ x: 0, y: 0, width: 0, height: 0 }, 1600, 800)).toEqual({})
  })

  /**
   * 回归（2026-10-30 用户实测）：裁剪后的缩略图比例不对。
   *
   * 根因：取景块的高度也按「原宽 ÷ 框宽」放大，再用 object-fit: fill 填进去。
   * 卡片与裁框比例只要差一点（手动拖过卡片 / 后台舍入 / 4:3 卡片装 16:9 画面），
   * 画面就会被横向或纵向拉伸 —— 看起来就像「没有裁好」。
   */
  it('★ 取景块必须保持裁框比例（4:1 裁框不能按卡片比例拉伸）', () => {
    expect(framingStyle({ x: 0, y: 0, width: 800, height: 200 }, 1600, 800)).toMatchObject({
      width: '200%',
      height: '400%',
    })
  })

  /**
   * 口径反转（用户 2026-10-31）：「这里让你提供一份默认的缩略图，就是不携带参考的」。
   *
   * 缩略图是全站共用的一张整幅原片（左侧栏 / 底栏 / 标签都复用），
   * 所以**裁剪只能由显示端用 CSS 取景实现**。视频与预览图必须套同一套规则，
   * 否则裁过的节点会先把剪掉的区域显示出来。
   */
  it('★ 预览图与视频套同一套取景（缩略图永远是整幅原片）', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(path.resolve(__dirname, '../VideoContent.vue'), 'utf8')
    const rule = /(\.video-stage\.is-framed\s+[^{]+\{[^}]*\})/.exec(src)
    expect(rule).not.toBeNull()
    // 视频和预览图都要命中这条规则
    expect(rule![1]).toContain('video.video-media')
    expect(rule![1]).toContain('img.video-media')
    // 预览图的 style 必须复用视频那套取景，不能自己写死铺满
    expect(src).toMatch(/const posterStyle = computed<Record<string, string>>\(\(\) => videoStyle\.value\)/)
  })
})

describe('播放控件与可达性', () => {
  /**
   * 用户口径 2026-10-31：「把点击视频节点播放暂停的功能删除掉，
   * 只有点击左下角的那个播放按钮时他才进行播放和暂停」。
   *
   * 原来的单击是 250ms 延迟 + togglePlay，点一下节点就把自动播的视频停了；
   * 而点节点本来只是"选中"，用户根本没想停播。
   */
  it('★ 画面单击不再绑定播放/暂停（只剩双击全屏）', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(path.resolve(__dirname, '../VideoContent.vue'), 'utf8')
    // 舞台元素的绑定：只留 dblclick，不许有 @click
    const stage = /<div ref="stageRef"[^>]*>/s.exec(src)?.[0] ?? ''
    expect(stage).toContain('@dblclick')
    expect(stage).not.toMatch(/@click=/)
    // 旧实现的两个特征都不该还在：延迟计时器 + 那个点击处理函数
    expect(src).not.toContain('stageClickTimer')
    expect(src).not.toContain('function onStageClick')
  })

  /**
   * 停播只能有一个入口：激活态消失（鼠标离开且未单选）。
   *
   * 用户 2026-10-31 报的现象是「我选中图片，视频就停了」。
   * 从前"点画布空白"也挂了一条 stopPlayback，与指针离开各自判一次，
   * 谁先触发就决定用户看到什么 —— 那是随机行为。现在只剩一条路。
   */
  it('★ 停播只有一个入口（点空白不停播，交给激活态）', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(path.resolve(__dirname, '../VideoContent.vue'), 'utf8')
    // stopPlayback 的定义 1 处 + 唯一调用点 1 处
    const calls = [...src.matchAll(/stopPlayback\(\)/g)].filter((m) => !src.slice(0, m.index).endsWith('function '))
    expect(calls.length).toBe(1)
    // PaneClick 里不许再出现它
    const pane = /PaneClick[\s\S]{0,200}/.exec(src)?.[0] ?? ''
    expect(pane).not.toContain('stopPlayback')
  })

  /**
   * 用户口径 2026-10-31：「只有 hover 能触发播放和控件显示，
   * 选中（单选）时效果要和 hover 保持一致」。
   *
   * 这两条锁住"选中 = 悬停"：控件不再只在鼠标进来时才露，
   * 单选状态下也要常显（否则用户选中节点后找不到播放按钮）。
   */
  it('★ 单选状态 → 控件与衬底常显（与 hover 一致）', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 }, ['v1'])
    expect(html).toContain('video-controls')
    expect(videoControlsClass(html)).not.toContain('is-hidden')
  })

  it('未选中且未 hover → 控件与衬底收起', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(videoControlsClass(html)).toContain('is-hidden')
  })

  /**
   * 多选时**不能**进入激活态：框选三个视频就三个一起播，既吵又费解码器。
   * 与图片/文本节点的操作栏同一条语义（只在单选时出现）。
   */
  it('★ 多选 → 不进入激活态（控件仍收起）', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 }, ['v1', 'v2'])
    expect(videoControlsClass(html)).toContain('is-hidden')
  })

  it('有视频时渲染播放/进度/截图/全屏，且纯图标按钮都有 title + aria-label', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(html).toContain('video-controls')
    // 2026-10-29 控件条抽成共用组件：节点形态必须有截图插槽、没有循环开关
    expect(html).toContain('aria-label="截取画面"')
    expect(html).not.toContain('aria-label="循环播放"')
    expect(html).toContain('aria-label="播放"')
    expect(html).toContain('aria-label="播放进度"')
    expect(html).toContain('aria-label="截取画面"')
    expect(html).toContain('aria-label="静音"')
    expect(html).toContain('aria-label="全屏播放"')
  })

  it('播放条显示整段原片时长，不随剪辑区间变（用户口径 2026-10-31）', async () => {
    const html = await render('v1', {
      videoUrl: VIDEO,
      videoWidth: 1280,
      videoHeight: 720,
      videoDuration: 60,
      clipStart: 10,
      clipEnd: 40,
    })
    // 节点承载的仍是整段视频：播放条总时长 = 1:00，剪辑只决定"播到哪停"
    expect(html).toContain('1:00')
    expect(html).not.toContain('0:30')
  })

  it('裁剪中不渲染播放控件（免得和裁剪手势抢）', async () => {
    beginOverlay('v1', 'crop')
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1600, videoHeight: 800 })
    expect(html).not.toContain('video-controls')
    endOverlay('v1')
  })
})

describe('空态与失效态', () => {
  it('没有视频 → 显示"（无视频）"，不渲染画面元素', async () => {
    const html = await render('v1', {})
    expect(html).toContain('（无视频）')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('<img')
  })

  it('没有视频 → 不渲染底部渐变衬底（空节点保持白板底色）', async () => {
    // 用户实测：没有视频时底部挂着一块灰渐变，看着像没加载完的画面。
    // 衬底只是播放控件的背景，空节点不该有它。
    const html = await render('v1', {})
    const htmlNoVideo = await render('v1', { videoWidth: 1280, videoHeight: 720 })
    expect(html).not.toContain('vc-scrim')
    expect(htmlNoVideo).not.toContain('vc-scrim')
  })

  it('有视频 → 衬底与控件一起渲染，但默认是收起态（未 hover 不显示渐变）', async () => {
    const html = await render('v1', { videoUrl: VIDEO, videoWidth: 1280, videoHeight: 720 })
    expect(html).toContain('vc-scrim')
    expect(html).toContain('is-hidden')
  })

  it('失效不会在首次渲染就出现（它是会话事实，由播放报错触发）', async () => {
    const html = await render('v1', { videoUrl: VIDEO })
    expect(html).not.toContain('视频已失效')
  })
})

