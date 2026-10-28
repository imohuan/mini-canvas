/**
 * 资产树共用组件的**结构守卫**（静态，不跑浏览器）。
 *
 * 为什么需要它：用户口径（2026-10-07）是「侧边栏资产 tab 与资产管理弹窗的资源树**抽成一个通用组件**，
 * 并支持拖拽」。这种"两处收敛成一处"的约束，浏览器里跑不出来（两处各自还能长得像），
 * 只能盯源码结构：
 *   1. 两处宿主都渲染 <AssetTree>，且没有各自的 <AssetRowMenu>（菜单只有一个来源）；
 *   2. 两处都传了 data-variant（e2e 靠它区分 drawer / dialog）；
 *   3. 右键菜单与「⋯」菜单同源：AssetRowMenu 只声明一次菜单内容（模板里只有一处 <AxDropdown>）；
 *   4. 「拖拽悬停 = 背景 + 阴影、不带边框」的样式仍写在 AssetTree 里（且没有 ring/border 回归）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

const drawer = read('../components/areas/LeftDrawer.vue')
const dialog = read('../components/AssetManageDialog.vue')
const tree = read('../components/AssetTree.vue')
const rowMenu = read('../components/AssetRowMenu.vue')
const dropdown = read('../components/AxDropdown.vue')
const subMenu = read('../components/AxSubMenu.vue')

describe('资产树共用（AssetTree）', () => {
  it('两处宿主都渲染 <AssetTree>（不再各自画行）', () => {
    expect(drawer).toContain('<AssetTree')
    expect(dialog).toContain('<AssetTree')
  })

  it('两处宿主都不再直接使用 AssetRowMenu（菜单只有一个来源）', () => {
    expect(drawer).not.toMatch(/<AssetRowMenu/)
    expect(dialog).not.toMatch(/<AssetRowMenu/)
    expect(drawer).not.toMatch(/import AssetRowMenu/)
    expect(dialog).not.toMatch(/import AssetRowMenu/)
    // 只有共用树里挂菜单
    expect(tree).toMatch(/<AssetRowMenu/)
  })

  it('两处宿主各自声明变体（drawer / dialog），e2e 靠它区分', () => {
    expect(drawer).toMatch(/<AssetTree[\s\S]{0,200}variant="drawer"/)
    expect(dialog).toMatch(/<AssetTree[\s\S]{0,200}variant="dialog"/)
    expect(tree).toContain('data-variant')
  })

  it('契约属性齐全：[data-asset-row] / data-row-kind / data-row-id / is-drop-over', () => {
    expect(tree).toContain('data-asset-row')
    expect(tree).toContain('data-row-kind')
    expect(tree).toContain('data-row-id')
    expect(tree).toContain('is-drop-over')
  })

  /**
   * 悬停视觉：**只有背景**，不要阴影、不要边框/描边。
   *
   * 口径演变（都是用户原话）：
   *   第一版「不要边框，只给一个 over 的背景，一个灰色阴影就行」；
   *   实测后改成「拖拽上去有那种灰色的背景…我感觉你好像设置了什么阴影，把这个阴影给去掉」。
   * 所以这条断言现在是"背景在、阴影不在"——改样式就得回来改这里，反之亦然。
   */
  it('悬停视觉 = 只有背景，没有阴影 / 边框 / 描边（用户口径）', () => {
    const rule = tree.slice(tree.indexOf('.asset-tree .asset-tree-row.is-drop-over'))
    const block = rule.slice(0, rule.indexOf('}'))
    expect(block).toContain('background')
    expect(block).not.toContain('box-shadow')
    expect(block).not.toMatch(/border(-\w+)?\s*:/)
    expect(block).not.toMatch(/outline\s*:/)
  })

  /**
   * 改名输入框的值必须**受控于宿主**（renameValue），不能在组件里留"上一轮的草稿"。
   * 实测事故：点资产的重命名，输入框里却是上一个文件夹的名字 —— 就是草稿兜底优先于宿主值造成的。
   */
  it('改名输入框是受控的（值只来自宿主，不留组件内草稿）', () => {
    // 注释里提到过 renameDraft 这个历史坑，所以只查「有没有真的声明/使用它」
    expect(tree).not.toMatch(/const renameDraft/)
    expect(tree).not.toContain('renameDraft.value')
    expect(tree).toMatch(/const renameVal = computed\(\{[\s\S]{0,160}get: \(\) => props\.renameValue/)
  })

  /**
   * 资产树**自己不再画焦点环**（用户口径 2026-10-14：全界面关掉焦点环，见 ui-style-guide §5 第 1 条
   * 与 app.css 那条全局 `*:focus-visible { outline: none !important }`）。
   *
   * 演进：先是浏览器默认黑框被用户报上来，改成这里画青色环；用户随后明确
   * 「我是不太希望你显示这个焦点环的，能不能在全局把它给关掉」—— 所以环整条撤掉，
   * 统一交给全局那条规则处理。这里留一条守卫，防止它被"顺手"加回来。
   */
  it('树里不再自己画焦点环（全界面已关掉，见 ui-style-guide §5 第 1 条）', () => {
    expect(tree).not.toMatch(/\.asset-tree button:focus-visible/)
  })

  /**
   * 缩略图点了要开预览（用户口径 2026-10-14：「弹出框里左侧的图片 logo，就是文件左侧的图片 logo。
   * 点击它没有预览效果，请修复」）。
   *
   * 它与右侧那个「整行」按钮**语义不同**：整行按钮在两个宿主里行为不一样
   * （抽屉 = 预览、弹窗 = 刻意不预览），而缩略图的意图两边一致 = 看看这张图。
   * 所以树自己 @click.stop 派发 openThumb，两个宿主都必须接上 —— 漏掉任何一边，
   * 那边的缩略图又会变成"点了没反应"。
   */
  it('缩略图自己派发 openThumb，且两处宿主都接上了', () => {
    // 树：缩略图容器上 click.stop + onThumbClick（不再依赖右侧整行按钮的宿主语义）
    expect(tree).toMatch(/@click\.stop="onThumbClick\(row, \$event\)"/)
    expect(tree).toMatch(/function onThumbClick\(row: AssetTreeRow, e: MouseEvent\)[\s\S]{0,160}emit\('openThumb', row, e\)/)
    // 两处宿主各接一次
    expect(drawer).toContain('@open-thumb=')
    expect(dialog).toContain('@open-thumb=')
    // 弹窗那侧真的开了预览（不是又一个空实现）
    expect(dialog).toMatch(/function onOpenThumb\(row: AssetTreeRow\)[\s\S]{0,400}openAssetPreviewFromAsset\(/)
  })

  it('视频行有真缩略图 + 播放圆点（2026-10-28 口径：给首帧、与图片区分）', () => {
    // 首帧：<video preload=metadata muted>（不是塞 mp4 进 img 的裂图老路）
    expect(tree).toMatch(/<video[^>]*v-else-if="\(row\.assetKind \?\? 'other'\) === 'video' && row\.url"[\s\S]{0,200}preload="metadata"[\s\S]{0,120}muted/)
    // 播放圆点：只在视频行出现，尺寸小（size-4），底色走主题 scrim 变量
    const seg = tree.slice(tree.indexOf('v-else-if="(row.assetKind ?? \'other\') === \'video\''), tree.indexOf('</span>', tree.indexOf('polygon points=')))
    expect(seg).toContain('size-4')
    expect(seg).toContain('var(--ui-scrim)')
  })

  /**
   * 节点包缩略图的定位（2026-10-28 真机截图报的「一小块蓝色跑到行外」）：
   * 320px 的 iframe 放进 32px 容器后必须**绝对定位到左上角、原点也在左上角**。
   * 只要改回 grid 居中 / center center，缩完就会整体偏出去 144px —— 这条会立刻红。
   */
  it('★ 节点包迷你窗口贴住容器左上角（缩放后不许跑到行外）', () => {
    const rule = tree.slice(tree.indexOf('.asset-tree .pack-thumb-frame'))
    const block = rule.slice(0, rule.indexOf('}'))
    expect(block).toContain('position: absolute')
    expect(block).toMatch(/left:\s*0/)
    expect(block).toMatch(/top:\s*0/)
    expect(block).toMatch(/transform-origin:\s*0 0/)
    expect(block).not.toContain('center center')
  })

  /** 缩略图只作展示：沙箱不给脚本权限（包内代码找 CanvasUI 会在控制台刷错） */
  it('节点包缩略图不执行包内脚本（只显示静态画面）', () => {
    const seg = tree.slice(tree.indexOf('class="pack-thumb-frame"') - 400, tree.indexOf('class="pack-thumb-frame"'))
    expect(seg).toContain('sandbox=""')
    expect(seg).not.toContain('allow-scripts')
  })

  /** 资源可以拖到画布建节点：树把资产 id 写进 dataTransfer（画布侧据此建对应类型的节点） */
  it('资产行拖拽时带上「这是资源树资产」的标记', () => {
    expect(tree).toContain('application/x-mini-canvas-asset')
    // 两处宿主都要接住「拖到画布」的落点（dragover 放行 + drop 建节点）
    expect(drawer).toContain('onCanvasDragOver')
    expect(drawer).toContain('onCanvasDrop')
  })
})

describe('右键菜单与「⋯」菜单同源', () => {

/**
 * 画布树的行菜单与资产树**同源**（用户口径 2026-10-08）：
 *
 * 原话：「当前在左侧边栏的资产面板中，这些文件夹和资源都支持右键菜单。现在希望画布这边也支持
 * 右键菜单 —— 因为当前这里只有在 hover 点击后面的按钮时，显示的那个按钮才可以触发。」
 * 以及「你的画布和资产里的树结构可以使用同一套组件…… 我希望你可以把这部分抽象成一个组件」。
 *
 * 抽象边界（本文件锁的就是它）：
 *   - **共用**（RowMenuShell）：浮层 + 「⋯」触发器 + 行右键 openAt 的「鼠标点锚点」机制；
 *   - **各写**（CanvasRowMenu / AssetRowMenu）：菜单里有哪些条目 —— 两边的实体不同，
 *     硬合成一份要么堆 if、要么把两边都阉掉。
 * 这条边界一旦被打破（比如画布那边自己又画一个浮层 / 自己再写一份右键定位），这里就红。
 */
describe('画布树行菜单（右键 + ⋯ 同源，外壳与资产共用）', () => {
  const drawer = read('../components/areas/LeftDrawer.vue')
  const shell = read('../components/RowMenuShell.vue')
  const canvasMenu = read('../components/CanvasRowMenu.vue')

  it('画布树的行接了右键（列表行 / 宫格卡片 / 分组行都要有）', () => {
    // 三类行各自都挂 @contextmenu —— 少一类就会出现「这种行右键没反应」
    const hits = (drawer.match(/@contextmenu="openCanvasMenu\(/g) ?? []).length
    expect(hits).toBeGreaterThanOrEqual(3)
    // 处理函数存在，且走「按行 id 取那个菜单实例、在鼠标点打开」
    expect(drawer).toContain('function openCanvasMenu(')
    expect(drawer).toContain('canvasMenuRefs[rowId]?.openAt(')
    expect(drawer).toContain('e.preventDefault()')
  })

  it('画布行渲染 CanvasRowMenu（不是一个自绘浮层），且登记进 openAt 表', () => {
    expect(drawer).toContain('<CanvasRowMenu')
    expect(drawer).toContain('bindCanvasMenu')
    // 画布树里不该再出现「自己画的 ⋯ 浮层」（旧的 AxDropdown + AxMenu 三处）
    expect(drawer).not.toMatch(/<AxDropdown[^>]*>\s*<template #trigger><button[^>]*aria-label="'更多操作/)
  })

  it('外壳只声明一处浮层（RowMenuShell），右键与「⋯」共用同一份', () => {
    const dropdowns = (shell.match(/<AxDropdown/g) ?? []).length
    expect(dropdowns).toBe(1)
    // 右键转交给浮层的「鼠标点锚点」能力，不另绘定位
    expect(shell).toContain('openAtPoint')
    expect(shell).toContain('defineExpose({ openAt })')
  })

  it('菜单条目只发事件、不做动作（动作要读画布数据，属宿主的活）', () => {
    // CanvasRowMenu 不 import 任何服务/composable，只 emit
    expect(canvasMenu).not.toContain("from '../composables/ui'")
    expect(canvasMenu).toContain('const emit = defineEmits<{')
    for (const ev of ['rename', 'locate', 'duplicate', 'addAgent', 'ungroup', 'remove']) {
      expect(canvasMenu).toContain(ev + ': []')
    }
  })

  it('分组行与节点行的菜单条目不同（分组：解散；节点：复制/引用到 Agent）', () => {
    expect(canvasMenu).toMatch(/kind === 'group'[\s\S]{0,120}ungroup/)
    expect(canvasMenu).toMatch(/emit\('duplicate'\)/)
    expect(canvasMenu).toMatch(/emit\('addAgent'\)/)
    // 两条都有的通用项
    expect(canvasMenu).toContain("emit('locate')")
    expect(canvasMenu).toContain("emit('rename')")
    expect(canvasMenu).toContain("emit('remove')")
  })

  it('画布菜单的动作都是真实现（不是占位 toast）', () => {
    // 宿主侧：删除走 doc.removeNodes、复制走 clipboard 命令、引用走 agent 命令、解散走 group 服务
    expect(drawer).toContain('ui.removeNode(')
    expect(drawer).toContain('ui.duplicateNode(')
    expect(drawer).toContain('ui.referenceNodeToAgent(')
    expect(drawer).toContain('ui.ungroupNode(')
    // 旧的占位（toast 假装删除/复制）必须消失
    // 注意：占位文案是「ui.showToast('已删除 ' + 名字)」这种拼串形式，匹配时用片段即可
    expect(drawer).not.toMatch(/ui\.showToast\('已删除 '/)
    expect(drawer).not.toMatch(/ui\.showToast\('已复制 '/)
  })
})
  it('AssetRowMenu 只有一处浮层声明（一条菜单内容，两个入口）', () => {
    const count = (rowMenu.match(/<AxDropdown/g) ?? []).length
    expect(count).toBe(1)
  })

  it('右键入口转交给浮层的「鼠标点锚点」，不另绘浮层', () => {
    expect(rowMenu).toContain('openAtPoint')
    expect(dropdown).toContain('openAtPoint')
    expect(dropdown).toContain('contextAnchor')
  })

  it('二级菜单写「父链 + 自己」的组标记（点外判定不误伤子菜单）', () => {
    expect(subMenu).toContain('data-floating-chain')
    expect(dropdown).toContain('data-floating-chain')
  })

  /**
   * 右键锚点必须与菜单**同处一个坐标系**（真 bug 回归，2026-10-08）。
   *
   * 事故：锚点原先写在 `.axd-root` 里，而锚点用 `position: fixed` 表达「鼠标在视口里的绝对坐标」。
   * CSS 规定**任何非 none 的 transform / translate 都会给后代创建包含块**，后代 fixed 于是改以它为基准 ——
   * 画布树的分组行 / 列表行操作条容器正是靠 `-translate-y-1/2` 垂直居中的，锚点被关进去后
   * `left: 28px` 变成「相对那个容器左边 28px」，整块菜单被推到右边（实测鼠标 x=28 → 菜单 x=282），
   * 而宫格卡片那条操作条没有 translate，落点精确 —— 用户看到的正是
   * 「分组右键菜单位置错了，普通资源的都是正确的」。
   *
   * 判据是**结构**：锚点必须待在 `<Teleport>` 内（与菜单同在 body 下，没有带 transform 的祖先）。
   * 移回 .axd-root 立刻红 —— 不依赖任何具体渲染环境。
   */
  it('右键锚点与菜单同处 Teleport 内（否则带 translate 的行会把它顶偏）', () => {
    const teleportOpen = dropdown.indexOf('<Teleport')
    const teleportClose = dropdown.indexOf('</Teleport>')
    const anchorAt = dropdown.indexOf('ref="contextAnchor"')
    expect(teleportOpen).toBeGreaterThan(-1)
    expect(teleportClose).toBeGreaterThan(teleportOpen)
    expect(anchorAt).toBeGreaterThan(teleportOpen)
    expect(anchorAt).toBeLessThan(teleportClose)
    // 触发器仍留在 Teleport 外（它是行内元素，锚在它身上时本就该按行内文档流走）
    const triggerAt = dropdown.indexOf('ref="triggerRef"')
    expect(triggerAt).toBeLessThan(teleportOpen)
  })

  it('锚点用 fixed 表达视口坐标（这条一旦改成 absolute，上面的包含块论证就不成立了）', () => {
    expect(dropdown).toMatch(/contextAnchorStyle[\s\S]{0,400}position: 'fixed'/)
  })
})

/**
 * 「资产管理」弹窗与左侧抽屉的**行为对齐**（用户口径 2026-10-08）：
 *   ① 点文件夹行 = 展开/折叠（与抽屉一致）——弹窗那一行本来就整行可点，此前却配了
 *      folder-click="open"（只改面包屑/新建落点，不改列表），用户实测「点了没有折叠效果」；
 *   ② 右上角「新建」不再"点一下就建文件夹"，改成加号下拉：新建文件夹 / 上传资产（照左侧抽屉）；
 *   ③ 「上传资产」接真上传弹窗（与抽屉同一个组件，同一条保存口径）；
 *   ④ 下钻入口不靠行点击：深层新建走行菜单「新建子文件夹」（落点 = 该行）；
 *      "双击行 = 进入该层"实测不可靠（第一下折叠会换行），已否决。
 */
describe('资产管理弹窗：折叠语义 + 新建下拉 + 上传弹窗（2026-10-08 用户口径）', () => {
  it('① 点文件夹行 = 展开/折叠（不再 folder-click="open"）；下钻改用显式「进入」按钮', () => {
    expect(dialog).not.toContain('folder-click="open"')
    // 共用树的默认语义就是 expand（抽屉没传这个开关，两边一致）
    expect(tree).toMatch(/folderClick: 'expand'/)
    // 行点击只做折叠：不挂双击（双击实测会因第一下折叠换行而落到别的行），
    // 下钻走弹窗开启的显式「进入」按钮（位置固定，不受行位移影响）
    expect(tree).not.toContain('@dblclick')
    expect(tree).toMatch(/v-if="showEnter && !batchOn"[\s\S]{0,400}openFolder/)
    expect(dialog).toMatch(/<AssetTree[\s\S]{0,600}show-enter/)
    expect(dialog).toContain('@open-folder="goToFolder($event)"')
  })

  it('② 右上角「新建」= 加号下拉，两项：新建文件夹 / 上传资产', () => {
    expect(dialog).toMatch(/aria-label="新建或上传"/)
    expect(dialog).toMatch(/<AxMenuItem[^>]*addFolderIn\(currentFolderId\)[^>]*>[\s\S]{0,160}新建文件夹/)
    expect(dialog).toMatch(/<AxMenuItem[^>]*uploadOpen = true[^>]*>[\s\S]{0,160}上传资产/)
    // 旧的「点一下直接建文件夹」文字按钮不能再回来
    expect(dialog).not.toMatch(/addFolderHere\(\)"/)
  })

  it('③ 「上传资产」挂真上传弹窗：同组件、同保存口径、盖在资产管理之上', () => {
    expect(dialog).toContain('import AssetUploadDialog')
    expect(dialog).toMatch(/<AssetUploadDialog[\s\S]{0,240}:folders="flatFolders"/)
    expect(dialog).toContain('ui.uploadAssetsTo')
    // 两者同为 z-[100000] 浮层：上传弹窗在源码里排在资产管理面板之后
    // （同挂 body 时后者渲染在上层——上传弹窗不能被资产管理弹窗盖住）
    expect(dialog.lastIndexOf('<AssetUploadDialog')).toBeGreaterThan(dialog.indexOf('aria-label="资产管理"'))
    // Esc 联动：上传弹窗开着时资产管理让位（不跟着关）；同时 stopPropagation，
    // 不让 App 的 window 级 Esc 再把抽屉一起关掉（一次 Esc 只关一层）
    const esc = dialog.slice(dialog.indexOf('function onEscKey'))
    expect(esc.slice(0, 900)).toContain('uploadOpen')
    expect(esc.slice(0, 900)).toContain('stopPropagation')
  })

  it('④ 树行菜单「新建子文件夹」落点 = 该文件夹（与左侧抽屉同一口径，不落在当前层）', () => {
    expect(dialog).toContain('addFolderIn($event.id)')
    expect(dialog).not.toMatch(/@child-folder="addFolderHere/)
  })
})
