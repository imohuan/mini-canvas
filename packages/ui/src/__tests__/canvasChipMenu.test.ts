/**
 * 画布下拉的行尾菜单（用户口径 2026-10-09，附效果图）结构守卫。
 *
 * 要的三件事，缺一都不算完成：
 *   ① 行尾默认显示**右箭头**；hover 到该行时换成**三个点**；当前画布不再显示勾；
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
const statusArea = read('../components/areas/StatusArea.vue')
const dockArea = read('../components/areas/DockArea.vue')
const topRight = read('../components/areas/TopRightArea.vue')
const manageToolbar = read('../components/assets/manage-dialog/ManageDialogToolbar.vue')
const assetToolbar = read('../components/areas/left-drawer/AssetTabToolbar.vue')
const assetUpload = read('../components/AssetUploadDialog.vue')
const canvasTabToolbar = read('../components/areas/left-drawer/CanvasTabToolbar.vue')
const assetTabToolbar = read('../components/areas/left-drawer/AssetTabToolbar.vue')
const leftDrawer = read('../components/areas/LeftDrawer.vue')
const topLeft = read('../components/areas/TopLeftArea.vue')
const drawer = read('../components/areas/LeftDrawer.vue')
const ui = read('../composables/ui/useCanvasList.ts')
const api = read('../composables/projectsApi.ts')

describe('画布下拉行：整行 = shadcn 默认 SubTrigger', () => {
  /**
   * 用户口径 2026-11-05：用 shadcn 的默认二级组件，开合交给组件默认行为
   * （悬停整行就展开二级菜单），不要在模板里加 mouseenter 这类手工开关。
   */
  it('整行是 DropdownMenuSubTrigger（悬停展开交给组件默认行为）', () => {
    expect(cluster).toMatch(/<DropdownMenuSubTrigger[\s\S]{0,200}class="canvas-row"/)
    // 手工 hover 开关与行尾双图标旧结构必须退役
    expect(cluster).not.toContain('@mouseenter')
    expect(cluster).not.toContain('canvas-row-main')
    expect(cluster).not.toContain('canvas-row-more')
    expect(cluster).not.toContain('canvas-row-chevron')
    expect(cluster).not.toContain('canvas-row-dots')
  })

  it('点击整行切画布，选中行保留整行淡底', () => {
    expect(cluster).toMatch(/DropdownMenuSubTrigger[\s\S]{0,300}emit\('pick-canvas', item\.id\)/)
    expect(cluster).toMatch(/\.canvas-row\.is-active \{ background:/)
  })
})

describe('行尾菜单：条目与真实现', () => {
  it('操作菜单四项齐全，且删除是危险项', () => {
    expect(cluster).toContain('在新窗口打开')
    expect(cluster).toContain('重命名画布')
    expect(cluster).toContain('复制画布')
    expect(cluster).toMatch(/<DropdownMenuItem[^>]*variant="destructive"[^>]*>[\s\S]{0,40}删除画布/)
  })

  it('每行自带 SubContent，操作项直接按 item.id 派发（开合交给组件默认行为）', () => {
    expect(cluster).toContain('<DropdownMenuSub')
    expect(cluster).toContain('<DropdownMenuSubContent')
    // 旧的手工开关（分行布尔）必须退役，悬停展开由 shadcn 默认处理
    expect(cluster).not.toContain('actionOpenId')
    expect(cluster).not.toContain('setActionOpen')
    expect(cluster).toMatch(/emit\('open-canvas-window', item\.id\)/)
    expect(cluster).toMatch(/emit\('rename-canvas-item', item\.id\)/)
    expect(cluster).toMatch(/emit\('duplicate-canvas', item\.id\)/)
    expect(cluster).toMatch(/emit\('delete-canvas', item\.id\)/)
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
    expect(cluster).toMatch(/variant="destructive"[\s\S]{0,160}emit\('delete-canvas', item\.id\)[\s\S]{0,40}删除画布/)
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

/**
 * 问题 03（packages/ui 外壳部分）：菜单选中项只保留组件默认勾，不再叠主题色 / 灰色底。
 * 这条盯的是「又有人顺手把选中态写成整行高亮」的回归，不是替代 Chrome 目验。
 */
describe('问题 03：外壳菜单选中只用默认勾', () => {
  it('缩放、筛选、展示、保存位置都用普通菜单项 + 行尾勾，不再手动加选中底', () => {
    for (const source of [statusArea, dockArea, manageToolbar, assetToolbar, assetUpload]) {
      expect(source, '单选组已退场，改回普通菜单项').not.toContain('DropdownMenuRadioGroup')
      expect(source).not.toContain('DropdownMenuRadioItem')
      expect(source).toContain('DropdownMenuItem')
    }
    expect(manageToolbar).toMatch(/DropdownMenuItem[\s\S]{0,200}v-if="k === activeKind"/)
    expect(assetToolbar).toMatch(/DropdownMenuItem[\s\S]{0,200}v-if="k === s\.assetFilterKind"/)
    expect(assetUpload).toMatch(/v-if="targetFolderId === ''"/)
    expect(statusArea).toMatch(/isFixedZoom\(50\)/)
    expect(dockArea).toMatch(/v-if="s\.canvasMode === 'move'"/)
    expect(statusArea).not.toMatch(/DropdownMenuItem[^>]*bg-accent/)
    expect(dockArea).not.toMatch(/DropdownMenuItem[^>]*bg-accent/)
    expect(manageToolbar).not.toMatch(/DropdownMenuItem[^>]*bg-accent/)
    expect(assetToolbar).not.toMatch(/DropdownMenuItem[^>]*bg-accent/)
    expect(assetUpload).not.toMatch(/DropdownMenuItem[^>]*bg-accent/)
  })
})

/**
 * 问题 05：底栏与右上按钮。
 * 这几条都是「样式被另一条规则盖掉」才会复发的错误，用结构断言钉住根因位置。
 */
describe('问题 05：右上实色 / 状态图标替换 / 缩放下拉 / Agent 圆形按钮', () => {
  it('右上角两个按钮用组件自己的 ghost / secondary 样式，不再手写半透明底', () => {
    // 早先这里手写 bg-panel/80；后来统一成 Button 的 variant，半透明问题由组件库兜住。
    // 测试盯住"不要再手写半透明底色"，不再要求源码里出现某个具体类名。
    expect(topRight).not.toContain('bg-panel/80')
    expect(topRight).not.toMatch(/bg-panel\/\d+/)
    expect(topRight).toContain('aria-label="主题切换"')
    expect(topRight).toContain('aria-label="设置"')
    expect(topRight).toMatch(/variant="ghost"/)
    expect(topRight).toMatch(/variant=/)
  })

  it('状态栏小地图关闭态换成另一个真实图标，不只改颜色', () => {
    expect(statusArea).toContain('MapPinOff')
    // ui 是普通对象，模板不会解包嵌套的 computed ref：必须读 .value，
    // 否则 ui.minimapOn 恒为 ref 对象（truthy），图标永远停在 MapPin。
    expect(statusArea).toContain('<MapPin v-if="ui.minimapOn.value"')
    expect(statusArea).toMatch(/<MapPinOff v-else/)
    expect(statusArea).not.toContain('<MapPin v-if="ui.minimapOn"')
  })

  it('缩放触发器不再套 Tooltip（两个浮层抢同一个锚点会让菜单失效）', () => {
    const zoomBlock = statusArea.slice(statusArea.indexOf('id="host/zoom"'))
    const trigger = zoomBlock.slice(0, zoomBlock.indexOf('</DropdownMenuTrigger>'))
    expect(trigger).toContain('aria-label="缩放选项"')
    expect(trigger).not.toContain('<Tooltip')
    expect(trigger).not.toContain('TooltipTrigger')
  })

  it('Agent 按钮固定 40px 真圆形，不再被全局圆角变量改成方角', () => {
    const block = dockArea.slice(dockArea.indexOf('.agent-orb-button {'))
    const rule = block.slice(0, block.indexOf('}'))
    expect(rule).toMatch(/width:\s*2\.5rem/)
    expect(rule).toMatch(/height:\s*2\.5rem/)
    expect(rule).toMatch(/border-radius:\s*9999px/)
    expect(rule).not.toContain('--mct-radius')
  })
})

/** 抽屉工具条：父子事件名必须严格对上，否则菜单永远关闭（用户报「点了没反应」）。 */
describe('左抽屉工具条事件接线', () => {
  it('画布工具条发出 update:menuOpen / update:viewMode，宿主用 kebab 监听', () => {
    expect(canvasTabToolbar).toContain("'update:menuOpen': [value: boolean]")
    expect(canvasTabToolbar).toContain("'update:viewMode': [value: 'list' | 'grid']")
    expect(canvasTabToolbar).not.toMatch(/emit\('updateMenuOpen'/)
    expect(canvasTabToolbar).not.toMatch(/emit\('updateViewMode'/)
    expect(leftDrawer).toContain('@update:menu-open="setMenuOpen"')
    expect(leftDrawer).toContain('@update:view-mode="setViewMode"')
  })

  it('资产工具条发出 update:plusOpen / update:uploadOpen / update:assetSearchActive', () => {
    expect(assetTabToolbar).toContain("'update:plusOpen': [value: boolean]")
    expect(assetTabToolbar).toContain("'update:uploadOpen': [value: boolean]")
    expect(assetTabToolbar).toContain("'update:assetSearchActive': [value: boolean]")
    expect(assetTabToolbar).not.toMatch(/emit\('updatePlusOpen'/)
    expect(assetTabToolbar).not.toMatch(/emit\('updateUploadOpen'/)
    expect(assetTabToolbar).not.toMatch(/emit\('updateAssetSearchActive'/)
    expect(leftDrawer).toContain('@update:plus-open="setPlusOpen"')
    expect(leftDrawer).toContain('@update:upload-open="setUploadOpen"')
    expect(leftDrawer).toContain('@update:asset-search-active="setAssetSearchActive"')
  })
})
