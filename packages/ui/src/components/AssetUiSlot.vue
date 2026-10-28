<script setup lang="ts">
/**
 * AssetUiSlot —— 资产的两个浮层（资产管理弹窗 / 全屏预览）**常驻挂载点**。
 *
 * 为什么要有它、而且必须挂在 `<CanvasHost>#ui` 槽里（用户口径 2026-10-08）：
 *   Agent 对话里的资产引用标签点一下要能看东西 —— 而那个「点」的消息是 Agent 插件广播的
 *   系统事件（`agent:ref-click`）。监听要用 `ctx.on`，`ctx` 只有**画布渲染子树内**的组件拿得到
 *  （`useCanvasRender()` 的 provide 由 CanvasSurface 提供）；左侧抽屉是 CanvasShell 的兄弟节点，
 *   不在那棵子树里。
 *   另外，浮层里的 `MediaViewer` 是**主题注册件**（`mediaViewer`），也只有子树内才取得到。
 *
 * 所以：监听 + 两个浮层都收进这里，作为一个**没有自己外观**的宿主挂在 `#ui` 槽。
 * 与 MiniMap 的挂法同一种（都是「必须待在渲染子树里」的东西）。
 *
 * 开关本身住在 composables/assetUiBus.ts：抽屉里的行点击 / Agent 那边的事件都只写它，
 * 本组件只管把开关渲染成浮层。
 */
import { computed, ref, watch } from 'vue'
import AssetManageDialog from './AssetManageDialog.vue'
import { MediaViewer } from '@mini-canvas/plugin-theme-default'
import { assetManager, assetPreview, closeAssetManager } from '../composables/assetUiBus'
import { currentAssetPreview, setAssetPreviewIndex } from '../composables/assetUiBus'
import { peekPack } from '../composables/nodePack'
import { useAssetRefOpen } from '../composables/useAssetRefOpen'
import { useUi } from '../composables/ui'

const ui = useUi()

// 监听 Agent 插件广播的「引用被点了」：资产文件 → 全屏预览；资产文件夹 → 资产管理并展开到那一层
useAssetRefOpen()

/** 弹窗每次打开都用一个新的组件实例（折叠状态只由 props 决定，不残留） */
const dialogKey = computed(() => 'am-' + assetManager.value.focusToken)

/**
 * 节点包解出来的界面（只缓存**一份**：当前正在看的那张）。
 *
 * 为什么不写回 assetUiBus：写回会让 previewItem 重算、watch 再触发 —— 形成自激循环
 *（第一版就踩了：切包时页面卡住几十秒）。取包结果只是"这一张的渲染内容"，
 * 放在外壳本地最省事；换张时按 url 判断是否命中。
 */
const packView = ref<{ url: string; html?: string; error?: string } | null>(null)

/** 预览项：外壳与 MediaViewer 的契约形状对齐 */
const previewItem = computed(() => {
  // 取「当前正在看的那一张」：← / → 切过之后 index 变了，url / name / id 都要跟着它走。
  // 为什么必须在这里解好再传：MediaViewer 的标题读 item.name、音频分支读 item.url
  //（它内部的 currentUrl 只喂图片分支）—— 底栏 MediaPreviewOverlay 也是在外面解好再传。
  const p = currentAssetPreview()
  // html / text 也要带上：可视化节点（kind='ui'）没有 url，它的内容是**一段 HTML**
  // （用户口径 2026-10-14：「可以在预览中添加一个 iframe 预览框」）——
  // 早先这里只透传 name/kind/url，于是 iframe 拿不到内容、显示成"还没画过"。
  if (!p) return null
  // 节点包：内容来自 packView（按 url 命中）；未命中 = 还在读，html 保持 undefined
  const pack = p.kind === 'ui' && packView.value?.url === p.url ? packView.value : null
  if (pack?.error !== undefined) {
    // 读包失败：换成文字态，把原因说清楚（别让用户盯着一句"还没画过"）
    return {
      name: p.name ?? '',
      kind: 'text',
      url: p.url ?? '',
      text: pack.error,
    }
  }
  return {
    name: p.name ?? '',
    kind: p.kind,
    url: p.url ?? '',
    ...(pack ? { html: pack.html } : {}),
    // 首次点开时总线里已经带着 html（openAssetPreviewFromAsset 解好的那份）；
    // 切张之后由 packView 现取。两处都要透传，少一处就显示成"还没画过"。
    ...(p.html !== undefined ? { html: p.html } : {}),
    ...(p.text !== undefined ? { text: p.text } : {}),
    // 同层清单原样透传：MediaViewer 认 list / index，自带 ← / → 与页码
    //（用户口径 2026-10-14：「全局预览都提供一个列表，可以通过左右快捷键来回切换」）。
    ...(p.list && p.list.length > 1
      ? { list: p.list, index: Math.min(Math.max(p.index ?? 0, 0), p.list.length - 1) }
      : {}),
  }
})

/**
 * 需要取包的地址：当前张是节点包、且本地还没有它的界面 → 返回 url；否则 null。
 * 切到另一个包时它会立刻变成新 url（旧界面不再被命中），所以画面一定跟着换。
 */
const packRequest = computed(() => {
  const p = currentAssetPreview()
  if (!p || p.kind !== 'ui') return null
  if (packView.value?.url === p.url) return null
  return p.url ?? ''
})

watch(packRequest, async (url) => {
  if (!url) return
  try {
    const pack = await peekPack(url)
    // 等包的时候用户可能又切走了：只认还在等的那个地址
    if (packRequest.value === url) packView.value = { url, html: pack.html }
  } catch (err) {
    if (packRequest.value === url) {
      packView.value = { url, error: '这个节点包读不出来：' + (err instanceof Error ? err.message : String(err)) }
    }
  }
})

/** 右上角删除按钮只在「当前这张是宿主自己的资产」时出现（从引用打开的不带 id） */
const canDelete = computed(() => Boolean(currentAssetPreview()?.id))

/** 预览里点删除（只有带 id 的资产才有；从引用打开时没有 id，也就没有删除按钮） */
function onPreviewDelete(): void {
  // 按**当前正在看的那张**删（← / → 切过之后，删的必须是当前这张）
  const id = currentAssetPreview()?.id
  if (id) void ui.deleteAssetById(id)
  assetPreview.value = null
}
</script>

<template>
  <!-- 资产管理：开关由 assetUiBus 决定（抽屉行点击 / 引用标签事件都写它） -->
  <AssetManageDialog
    v-if="assetManager.open"
    :key="dialogKey"
    :initial-folder-id="assetManager.folderId"
    :focus-token="assetManager.focusToken"
    :from-ref="assetManager.fromRef"
    @close="closeAssetManager()"
  />

  <!-- 全屏预览：与底栏素材卡 / 生成历史是同一只组件 -->
  <MediaViewer
    :item="previewItem"
    :on-delete="canDelete ? onPreviewDelete : undefined"
    @index="setAssetPreviewIndex"
    @close="assetPreview = null"
  />
</template>
