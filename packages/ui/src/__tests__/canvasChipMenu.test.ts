/**
 * 画布下拉的行尾菜单（用户口径 2026-10-09，附效果图）结构守卫。
 *
 * 要的三件事，缺一都不算完成：
 *   ① 当前画布那一行常显**勾**；hover 到该行时勾**换成三个点**；
 *   ② 点三个点弹出**该画布**的操作菜单：在新窗口打开 / 重命名画布 / 复制画布 / 删除画布；
 *   ③ 四个动作必须有**真实现**（占位 toast 一律不算）。
 *
 * 为什么用静态结构判定而不是跑浏览器：这三条是「接线是否接上」的契约
 * （谁传给谁、事件叫什么、宿主有没有落到真函数）。浏览器里两种写法都能看着像做完了，
 * 但占位实现点了没反应。这类约束只能盯源码结构（与本仓 assetTreeStructure 同一口径）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const cluster = read('../components/ProjectCluster.vue')
const topLeft = read('../components/areas/TopLeftArea.vue')
const drawer = read('../components/areas/LeftDrawer.vue')
const ui = read('../composables/ui.ts')
const api = read('../composables/projectsApi.ts')

describe('画布下拉行：勾 ⇄ 三个点', () => {
  it('行是「主按钮 + 行尾按钮」两个真按钮（不再在一个按钮里套可点的 span）', () => {
    expect(cluster).toContain('class="canvas-row-main"')
    expect(cluster).toContain('class="canvas-row-more"')
    // 旧的写法（菜单行里塞一个 aria-hidden 的 span 当按钮）必须消失
    expect(cluster).not.toContain('class="canvas-more"')
  })

  it('行尾同时渲染勾（Check）与三个点（MoreHorizontal）', () => {
    expect(cluster).toMatch(/import \{[^}]*\bCheck\b[^}]*\} from 'lucide-vue-next'/)
    expect(cluster).toMatch(/import \{[^}]*\bMoreHorizontal\b[^}]*\} from 'lucide-vue-next'/)
    expect(cluster).toContain('class="canvas-row-check"')
    expect(cluster).toContain('class="canvas-row-dots"')
    // 勾只给当前画布那一行
    expect(cluster).toMatch(/v-if="item\.id === canvasId"[\s\S]{0,200}class="canvas-row-check"/)
  })

  /**
   * 显隐规则（用户口径：选中显示勾、hover 变三个点）。
   * 判据是「这一行里同时有 hover 到勾/点的切换规则」—— 写在别处（比如全局样式）就说明
   * 换了实现方式，得回来改这条。
   */
  it('选中行常显勾、hover 到该行时勾让位给三个点', () => {
    expect(cluster).toMatch(/\.canvas-row-more\.is-pinned \.canvas-row-check \{ opacity: 1/)
    expect(cluster).toMatch(/\.canvas-row:hover \.canvas-row-more\.is-pinned \.canvas-row-check \{ opacity: 0/)
    expect(cluster).toMatch(/\.canvas-row:hover \.canvas-row-more\.is-pinned \.canvas-row-dots \{ opacity: 1/)
    // 未选中的行平时不显三个点，hover 行（或键盘聚焦按钮）才显
    expect(cluster).toMatch(/\.canvas-row-more:not\(\.is-pinned\) \.canvas-row-dots \{ opacity: 0/)
    expect(cluster).toMatch(/\.canvas-row:hover \.canvas-row-more:not\(\.is-pinned\) \.canvas-row-dots/)
    expect(cluster).toMatch(/\.canvas-row-more:focus-visible \.canvas-row-dots/)
    // 动效必须有 reduced-motion 降级（ui-style-guide §2.7）
    expect(cluster).toMatch(/prefers-reduced-motion: reduce[\s\S]{0,200}canvas-row-check/)
  })

  it('动效只动 opacity（不动 width/height/top/left —— ui-style-guide §2.7 硬性）', () => {
    const block = cluster.slice(cluster.indexOf('.canvas-row-check, .canvas-row-dots'))
    const rule = block.slice(0, block.indexOf('}'))
    expect(rule).toContain('transition: opacity')
    // 只检查 transition 列表里没有几何属性：定位（position/left/top）与固定尺寸不参与动画。
    // 勾/点在 44px 行尾里绝对定位是为了给 shadcn 的子菜单箭头留出右格。
    const transition = rule.slice(rule.indexOf('transition'))
    expect(transition).not.toMatch(/(width|height|top|left)\s*:/)
  })

  /**
   * 底色打在**整行**上，行里的按钮自己是透明的 —— 用户口径两句话合起来就是这个形状：
   *   ① 「这个按钮不要给 hover 的背景颜色，就直接给这个图标颜色就行」→ 行尾按钮 hover 只变色；
   *   ② 「hover 的是整块的一个背景」→ 行 hover 要给**整行**一块底。
   *
   * 为什么必须钉住（实测踩过）：底若打在 `.canvas-row-main` 上，只染主按钮那半块 ——
   * 行尾「⋯」与中间留白成了缺口，用户看到的正是「只有左侧有背景」。
   */
  it('行 hover 给**整行**一块底（不是只给行里的按钮）', () => {
    const row = /\.canvas-row:hover\s*\{([^}]*)\}/.exec(cluster)
    expect(row, '没找到 .canvas-row:hover 规则').toBeTruthy()
    expect(row![1], '整行 hover 要有底色').toMatch(/background:\s*var\(--ui-hover/)
    // 旧形状（染色主按钮那半块）必须消失
    expect(cluster).not.toMatch(/\.canvas-row:not\(\.is-active\) \.canvas-row-main:hover/)
    // 选中态仍要有自己的整行淡底
    expect(cluster).toMatch(/\.canvas-row\.is-active \{ background:/)
  })

  it('行尾按钮自己不给底色，hover 只提亮图标', () => {
    const rule = /\.canvas-row-more:hover\s*\{([^}]*)\}/.exec(cluster)
    expect(rule, '没找到 .canvas-row-more:hover 规则').toBeTruthy()
    expect(rule![1], 'hover 不许给 background（底色由整行给）').not.toMatch(/background/)
    expect(rule![1], 'hover 要提亮图标颜色').toMatch(/color:/)
    // 按钮是浮在行底上的：自己必须透明，否则会叠出第二块色
    const base = /\.canvas-row-more \{([^}]*)\}/.exec(cluster)
    expect(base![1], '行尾按钮底色应为透明').toMatch(/background:\s*transparent/)
  })
})

describe('行尾菜单：条目与真实现', () => {
  it('操作菜单四项齐全，且删除是危险项', () => {
    expect(cluster).toContain('在新窗口打开')
    expect(cluster).toContain('重命名画布')
    expect(cluster).toContain('复制画布')
    expect(cluster).toMatch(/<DropdownMenuItem[^>]*variant="destructive"[^>]*>[\s\S]{0,40}删除画布/)
  })

  it('行尾「⋯」是画布列表的子菜单（列表留着、子菜单并排）', () => {
    expect(cluster).toContain('<DropdownMenuSub')
    expect(cluster).toMatch(/<DropdownMenuSubTrigger[\s\S]{0,260}canvas-row-more/)
  })

  /** 两个浮层并存：清单是父菜单、行尾操作是子菜单，父菜单不因开子菜单而关闭。 */
  it('操作菜单是列表的**子菜单**（列表留着不消失，两个菜单并排）', () => {
    expect(cluster).toContain('<DropdownMenuSub :open="actionOpenId === item.id"')
    expect(cluster).toContain('<DropdownMenuSubContent')
    // 子菜单打开时不主动关闭列表（列表只在「切画布 / 新建」这类完成动作后才收）
    expect(cluster).not.toMatch(/openActions[\s\S]{0,200}update:menuOpen', false/)
  })

  /**
   * 回归：每行必须有自己的开关（存画布 id），不能共用一个 boolean。
   * 共用时点开一行，v-for 里所有行的 SubContent 会同时展开，叠成十几份
   * 「在新窗口打开」（用户截图 2026-11-02）。
   */
  it('行尾子菜单按画布 id 分行开关，不共用同一个布尔值', () => {
    expect(cluster).toContain('const actionOpenId = ref<string | null>(null)')
    expect(cluster).not.toMatch(/const actionOpen = ref\(false\)/)
    expect(cluster).toMatch(/setActionOpen\(item, v\)/)
  })

  it('两个宿主都把行数据换成 id + 名字（只传名字没法按 id 操作）', () => {
    for (const host of [topLeft, drawer]) {
      expect(host).toContain(':canvas-items="ui.canvasOptions.value"')
      expect(host).toContain(':canvas-id="ui.currentCanvasId.value"')
      // 旧的「按 label 反查 id」写法必须消失（重名画布会切错）
      expect(host).not.toContain('canvasOptions.value.find((c) => c.label === $event)')
    }
  })

  it('两个宿主都接上四个真动作（不是占位 toast）', () => {
    for (const host of [topLeft, drawer]) {
      expect(host).toContain('@open-canvas-window="ui.openCanvasInNewWindow($event)"')
      expect(host).toContain('@rename-canvas-item="ui.renameCanvasById($event)"')
      expect(host).toContain('@duplicate-canvas="ui.duplicateCanvas($event)"')
      expect(host).toContain('@delete-canvas="ui.deleteCanvas($event)"')
      expect(host).toContain('@pick-canvas="ui.openCanvas($event)"')
      // 旧的占位：点行尾三个点只弹一句 toast
      expect(host).not.toMatch(/@more-canvas=/)
    }
    expect(drawer).not.toMatch(/ui\.showToast\(\$event/)
  })

  it('四个动作在 ui.ts 里都有真实现（落盘 / 请求 / 导航）', () => {
    expect(ui).toMatch(/function openCanvasInNewWindow\(/)
    expect(ui).toMatch(/function renameCanvasById\(/)
    expect(ui).toMatch(/function duplicateCanvas\(/)
    expect(ui).toMatch(/function deleteCanvas\(/)
    // 新窗口：先把当前画布写完再开（否则新标签读到的是旧数据）
    expect(ui).toMatch(/openCanvasInNewWindow[\s\S]{0,400}await flushCanvasSave\(\)[\s\S]{0,200}window\.open/)
    // 重命名：写回后端 + 刷新清单
    expect(ui).toMatch(/renameCanvasById[\s\S]{0,700}apiRenameCanvas\(id, next\)/)
    // 复制 / 删除：走真接口
    expect(ui).toMatch(/duplicateCanvas[\s\S]{0,300}apiDuplicateCanvas\(id\)/)
    expect(ui).toMatch(/deleteCanvas[\s\S]{0,700}apiDeleteCanvas\(id\)/)
    // 删除前有确认 + 当前画布删完要跳到剩下的那张（否则停在已不存在的 hash 上白屏）
    expect(ui).toMatch(/deleteCanvas[\s\S]{0,500}window\.confirm/)
    expect(ui).toMatch(/deleteCanvas[\s\S]{0,900}await openCanvas\(next\.id\)/)
  })

  it('projectsApi 有复制 / 删除画布的接口（地址与后端契约一致）', () => {
    // 复制：POST /api/canvases/:id/duplicate
    expect(api).toMatch(/\/api\/canvases\/' \+ id \+ '\/duplicate'[\s\S]{0,120}method: 'POST'/)
    expect(api).toMatch(/export async function duplicateCanvas\(id: string\): Promise<CanvasSummary>/)
    // 删除：DELETE /api/canvases/:id
    expect(api).toMatch(/export async function deleteCanvas\(id: string\): Promise<void>/)
    expect(api).toMatch(/\/api\/canvases\/' \+ id, \{ method: 'DELETE' \}/)
  })

  /**
   * 「删除画布」**永远可点**（用户口径 2026-10-09）：
   *   「不管是哪个画布都支持删除，即使是当前选中的也支持删除，只不过删除之后跳转到第一个画布就行」。
   *
   * 历史（两轮）：先是 `v-if="canDelete"` **隐藏**（菜单比别的行少一条，用户报「没显示完整」）→
   * 改成灰掉（用户报「为什么很多时候无法点击删除，搞得我很难受」）→ 现在是**没有任何条件**：
   * 内置画布也删、当前选中也删。收尾（跳第一张 / 删空了补建一张）在宿主 ui.deleteCanvas 里。
   */
  it('「删除画布」没有任何条件（不隐藏、不置灰）', () => {
    expect(cluster, '删除项不许再带条件').not.toMatch(/v-if="canDelete"/)
    expect(cluster).not.toMatch(/:disabled="!canDelete"/)
    expect(cluster, 'canDelete 这个开关整个该消失').not.toMatch(/canDelete/)
    expect(cluster).toMatch(/variant="destructive"[\s\S]{0,160}pickAction\('delete-canvas'[\s\S]{0,40}删除画布/)
    // deletable 这个「谁不许删」的概念也一并退役
    expect(ui).not.toMatch(/deletable: c\.id !== 'default'/)
  })

  /**
   * 删完的收尾（用户口径：删了之后跳第一张）。两条缺一就白屏：
   *   ① 删的正是当前这张 → 跳剩下清单里的第一张；
   *   ② 一张不剩 → 现建一张再跳过去（没地方跳 = 白屏）。
   */
  it('删除后跳第一张；删空了补建一张（都不许停在已不存在的 hash 上）', () => {
    expect(ui).toMatch(/async function deleteCanvas\(id: string\): Promise<void> \{[\s\S]{0,900}apiDeleteCanvas\(id\)/)
    expect(ui).toMatch(/deleteCanvas[\s\S]{0,1000}await openCanvas\(next\.id\)/)
    expect(ui).toMatch(/deleteCanvas[\s\S]{0,1200}await newCanvas\(\)/)
    // 旧的「只剩一张就不给删」护栏必须消失（用户要的是任何画布都能删）
    expect(ui).not.toMatch(/deleteCanvas[\s\S]{0,300}canvasOptions\.value\.length <= 1\) return/)
  })
})
