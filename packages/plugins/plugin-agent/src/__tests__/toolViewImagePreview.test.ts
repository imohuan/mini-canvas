/**
 * 工具卡片「图片点开预览」契约（用户报的缺陷，2026-10-08）。
 *
 * 用户原话：「Agent 里面读取文件的地方，点击时没有进行预览。希望你可以使用预览插件，
 * 添加一个预览组件（你可以参考 生成历史 弹出框的那个预览 api）。」
 *
 * 「读取文件」= read_file 读一张图片 → toolViews.ts 的 file 分支产出「文件预览」卡片，
 * 里面的 images 块由 ToolViewBody 画成 88px 缩略图。缺陷就在这里：那张 <img> 上没有任何
 * 点击处理 —— 点了没反应，只能盯着缩略图看。
 *
 * 本文件从两头锁死修好之后的契约：
 *   ① 组件行为（真挂载、真派发事件）：点图 → emit('preview', 那张图的 src)；
 *      Enter / Space 同样；别的键不响；带 role=button / tabindex=0 / aria-label
 *      （键盘可达、读屏能念出「查看图片 N」）；
 *   ② 宿主接线（源码级）：AgentConversation 的 4 处 ToolViewBody 都接了 @preview →
 *      previewImage，且预览仍只有一只 MediaViewer（复用主题注册的预览 API，不新增第二只）。
 *
 * 为什么 ① 不用 SSR 断言：本包 vitest 跑在 node 环境（没有 jsdom / @vue/test-utils），
 * 而且 .vue 经 SSR 变换后没有客户端 render 函数、挂不起来。这里改用 vue/compiler-sfc
 * 在测试内现场编译出**客户端**渲染函数，再用 Vue 的 createRenderer 打一个极小的内存节点
 * 宿主，挖出真 <img> 把事件真的派发进去 —— 断言的是真组件的真 emit，不是源码里有没有那行字。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import * as lucide from 'lucide-vue-next'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { toolView, type ToolView } from '../toolViews'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

/* —————————————————— 被测组件：现场编译出客户端版本 —————————————————— */

function loadBody(): unknown {
  const { descriptor, errors } = parse(read('../components/ToolViewBody.vue'), { filename: 'ToolViewBody.vue' })
  if (errors.length) throw new Error('ToolViewBody.vue 解析失败：' + errors.map(String).join('；'))
  const compiled = compileScript(descriptor, { id: 'toolview-test', inlineTemplate: true })
  // 组件源码是 TS，转成 JS 才能交给 new Function（类型导入会被抹掉）
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const requireShim = (id: string): unknown => {
    if (id === 'vue') return vue
    if (id === 'lucide-vue-next') return lucide
    throw new Error('不认识这个依赖（测试的 require 只放 vue / lucide）：' + id)
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, requireShim)
  return mod.exports.default
}

const Body = loadBody() as vue.Component

/* —————————————————— 极小的内存节点宿主（够挖元素 + 派发事件） —————————————————— */

interface HNode {
  tag: string
  props: Record<string, unknown>
  children: HNode[]
  parent: HNode | null
  text: string
}

function hnode(tag: string): HNode {
  return { tag, props: {}, children: [], parent: null, text: '' }
}

const { createApp } = vue.createRenderer<HNode, HNode>({
  patchProp(el: HNode, key: string, _prev: unknown, next: unknown) {
    el.props[key] = next
  },
  insert(child: HNode, parent: HNode, anchor: HNode | null | undefined) {
    if (child.parent) {
      const at = child.parent.children.indexOf(child)
      if (at >= 0) child.parent.children.splice(at, 1)
    }
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
    child.parent = parent
  },
  remove(child: HNode) {
    if (!child.parent) return
    const at = child.parent.children.indexOf(child)
    if (at >= 0) child.parent.children.splice(at, 1)
    child.parent = null
  },
  createElement: (type: string) => hnode(type),
  createText(text: string) {
    const n = hnode('#text')
    n.text = text
    return n
  },
  createComment(text: string) {
    const n = hnode('#comment')
    n.text = text
    return n
  },
  setText(n: HNode, text: string) {
    n.text = text
  },
  setElementText(el: HNode, text: string) {
    el.children = []
    el.text = text
  },
  parentNode: (n: HNode) => n.parent,
  nextSibling(n: HNode) {
    if (!n.parent) return null
    const at = n.parent.children.indexOf(n)
    return n.parent.children[at + 1] ?? null
  },
})

/** 渲染 ToolViewBody，并收集它 emit 出来的 preview src */
function mountBody(view: ToolView): { root: HNode; emitted: string[] } {
  const root = hnode('#root')
  const emitted: string[] = []
  createApp({
    render: () => vue.h(Body, { view, args: '{}', onPreview: (src: string) => emitted.push(src) }),
  }).mount(root)
  return { root, emitted }
}

function findAll(n: HNode, tag: string, out: HNode[] = []): HNode[] {
  if (n.tag === tag) out.push(n)
  for (const c of n.children) findAll(c, tag, out)
  return out
}

/** 假键盘事件（Vue 的 .enter / .space / .prevent 要看 key 与 preventDefault） */
function keyEvent(key: string): Record<string, unknown> {
  return { key, target: {}, preventDefault() {}, stopPropagation() {} }
}

/** 派发一个事件：同一个 prop 可能挂着一串处理器（Enter / Space 就是两个），逐个都跑 */
function fire(el: HNode, prop: 'onClick' | 'onKeydown' | 'onError', event: Record<string, unknown>): void {
  const raw = el.props[prop]
  if (typeof raw === 'function') {
    ;(raw as (e: unknown) => void)(event)
    return
  }
  if (Array.isArray(raw)) {
    for (const fn of raw as Array<(e: unknown) => void>) fn(event)
    return
  }
  throw new Error(`<${el.tag}> 上没有 ${prop} —— 点了不会响`)
}

/** 真机场景：read_file 读一张画布资源目录里的图 →「文件预览」卡片 */
const READ_FILE_VIEW = toolView(
  'read_file',
  JSON.stringify({ file_path: 'D:/p/.mini-canvas/assets/files/faaca433.jpeg', canvasId: 'c1' }),
  'image/jpeg, 3.7 MB',
)

describe('images 块的图可点开预览', () => {
  it('read_file 的「文件预览」卡片：点图 → emit preview，带的就是这张图的 src', () => {
    const { root, emitted } = mountBody(READ_FILE_VIEW)
    const imgs = findAll(root, 'img')
    expect(imgs.length).toBe(1)
    expect(imgs[0].props.src).toBe('/api/assets/files/faaca433.jpeg')

    fire(imgs[0], 'onClick', keyEvent(''))
    expect(emitted).toEqual(['/api/assets/files/faaca433.jpeg'])
  })

  it('键盘也可达：Enter / Space 都 emit；别的键不响', () => {
    const { root, emitted } = mountBody(READ_FILE_VIEW)
    const img = findAll(root, 'img')[0]

    fire(img, 'onKeydown', keyEvent('Enter'))
    fire(img, 'onKeydown', keyEvent(' ')) // Space 的 event.key 就是一个空格
    expect(emitted.length).toBe(2)

    fire(img, 'onKeydown', keyEvent('a'))
    expect(emitted.length).toBe(2)
  })

  it('a11y：role=button + tabindex=0 + aria-label（有名字用名字，没名字用序号）；每张图点自己那张', () => {
    const view: ToolView = {
      family: 'resource',
      heading: '资源',
      blocks: [{ kind: 'images', items: [{ src: '/api/a.png', label: '封面.png' }, { src: '/api/b.png' }] }],
    }
    const { root, emitted } = mountBody(view)
    const imgs = findAll(root, 'img')
    expect(imgs.length).toBe(2)

    for (const img of imgs) {
      expect(img.props.role).toBe('button')
      expect(String(img.props.tabindex)).toBe('0')
    }
    expect(imgs[0].props['aria-label']).toBe('查看图片 封面.png')
    expect(imgs[1].props['aria-label']).toBe('查看图片 2')

    fire(imgs[1], 'onClick', keyEvent(''))
    expect(emitted).toEqual(['/api/b.png'])
  })
})

describe('图片加载失败：换占位，不再给裂图（用户口径 2026-10-08）', () => {
  /**
   * 数据层已尽量给对地址，但字节仍可能取不到（资源被删 / 服务端没这条资源）——
   * 此时 <img> 只剩浏览器默认的裂图小图标。契约：error 一次 → <img> 消失，
   * 原位换成同类尺寸的占位（class 含 tvc-img-broken），标题写清「加载失败」。
   */
  const ONE_IMAGE_VIEW: ToolView = {
    family: 'resource',
    heading: '资源',
    blocks: [{ kind: 'images', items: [{ src: '/api/canvases/c1/resources/gone.png', label: 'gone.png' }] }],
  }

  it('img 派发 error → img 消失、出现 tvc-img-broken 占位', async () => {
    const { root } = mountBody(ONE_IMAGE_VIEW)
    const img = findAll(root, 'img')[0]
    expect(img).toBeTruthy()

    fire(img, 'onError', {})
    await vue.nextTick()

    expect(findAll(root, 'img').length).toBe(0)
    const broken = findAll(root, 'span').filter((n) => String(n.props.class ?? '').includes('tvc-img-broken'))
    expect(broken.length).toBe(1)
    expect(broken[0].props.title).toBe('图片加载失败')
    // 图右上角的文件名标签仍在（占位与缩略图同尺寸，布局不跳）
    expect(broken[0].props.role).toBe('img')
  })
})

describe('结构与接线守卫（源码级）', () => {
  const body = read('../components/ToolViewBody.vue')
  const host = read('../components/AgentConversation.vue')

  it('ToolViewBody：缩略图给「放大镜」光标 + 键盘 focus 环（样式渲染不在 node 里跑，盯源码）', () => {
    expect(body).toContain('cursor: zoom-in')
    expect(body).toMatch(/\.tvc-img img:focus-visible\s*\{[^}]*outline/)
  })

  it('紧凑卡片（用户口径 2026-10-08 定稿）：缩略图 40px + 最多 3 张 + 「+N」；详情在卡片下方', () => {
    // 图片尺寸：40px（早先是 88px 网格 —— 用户嫌占高度）
    expect(body).toMatch(/\.tvc-img img \{[^}]*width: 40px;[^}]*height: 40px;/)
    expect(body).toMatch(/\.tvc-media-thumb \{[^}]*width: 40px;[^}]*height: 40px;/)
    // 最多 3 张 + 「+N」
    expect(body).toContain('const STRIP_MAX = 3')
    expect(body).toContain("tvc-img-more")
    // 「详情」折叠块在卡片下方（按钮在内容之后），标签是「工具名称 / 输入 / 输出」三块。
    // 注意别用 indexOf('</template>') 截模板：第一个闭标签是内层 v-for 的，会截掉后半段。
    const tpl = body.slice(body.indexOf('<template>'), body.indexOf('</style>'))
    expect(tpl.indexOf('tvc-details-toggle')).toBeGreaterThan(tpl.indexOf('tvc-body'))
    for (const label of ['工具名称', '输入', '输出']) expect(tpl).toContain(label)
    // 输入为空也写「（无输入）」——不省略、不跳过
    expect(tpl).toContain("（无输入）")
    // 悬停不加背景：折叠行/详情按钮的 hover 只改颜色，不动 background
    expect(host).not.toMatch(/\.ac-tf-toggle:hover\s*\{[^}]*background/)
    expect(body).not.toMatch(/\.tvc-details-toggle:hover\s*\{[^}]*background/)
  })

  it('宿主 AgentConversation：4 处 ToolViewBody 全部接上 @preview', () => {
    const sites = host.split('<ToolViewBody').slice(1)
    expect(sites.length).toBe(4)
    for (const site of sites) expect(site).toContain('@preview="previewImage = $event"')
  })

  it('预览仍只有一只 MediaViewer（复用主题注册的预览 API，不新增第二只）', () => {
    expect((host.match(/<MediaViewer/g) ?? []).length).toBe(1)
    expect(host).toMatch(/<MediaViewer\s+:item="previewItem"\s+@close="previewImage = null"\s*\/>/)
  })

  it('工具分组：收起行不加壳（只有卡片才包灰底，用户口径 2026-10-08）', () => {
    // 早先这条规则同时命中 .ac-tool-fold —— 每条收起行都被灰底 + 8px 内边距裹住。
    expect(host).toMatch(/\.ac-tg-body \.ac-tool-card \{[^}]*\}/)
    expect(host).not.toMatch(/\.ac-tg-body \.ac-tool-fold[,\s]/)
    // 「画布 MCP 自定义卡片」在分组里也走卡片壳（:class 分流要认 hasCardView），普通折叠行不加壳。
    // 用户口径 2026-10-10：**只认 hasCardView** —— 审批不再给底层工具打 card 标记，
    // 所以分流里不该再出现 tool.card（否则 exec_command 又被顶成常驻卡片、丢掉折叠箭头）。
    expect(host).toContain(":class=\"hasCardView(tool) ? 'ac-tool-card' : 'ac-tool-fold'\"")
    expect(host).not.toContain("tool.card || hasCardView(tool)")
  })
})
