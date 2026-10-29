<script setup lang="ts">
/**
 * GridSplitWorkbench —— 宫格切分全屏工作台。
 *
 * 视觉对照用户截图：上方一条顶栏（工具按钮群 + 当前图名 + 尺寸 + 关闭），中间整张图片、
 * 每格左上角一个勾选点，底部居中的状态栏放四个动作。
 *
 * 为什么自己画工作台而不是复用 MediaViewer：MediaViewer 的顶栏没有可插入的扩展点，
 * 且它的缩放会改写图片 transform；本工作台要按原图像素精确切格，必须让格子与图片
 * 处在同一个画框里，不能受预览缩放影响。这里只打开一个独立全屏层，不碰现有预览器。
 *
 * 状态全部来自 gridSession（响应式单源）：关闭 = 清会话；勾选 = 改会话里的 Set。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { DocService } from '@mini-canvas/canvas-data'
import { MEDIA_CREATOR_FIELD, type MediaKindCreator } from '@mini-canvas/canvas-render'
import GridSizePicker from './GridSizePicker.vue'
import { allCellKeys, cellKey, gridCells, selectedCells, type GridCell } from './gridLogic'
import { closeGridSession, gridSession, setGridSelection, toggleGridCell } from './session'
import { createStoryboard, publishGrid, type GridActionDeps } from './gridActions'

const { ctx, flow } = useCanvasRender()
const ThemedButton = useUiComponent('button')
const ThemedDropdown = useUiComponent('dropdown')

const busy = ref<'' | 'storyboard' | 'publish'>('')
const notice = ref('')
const noticeKind = ref<'error' | 'info'>('info')
const imageLoaded = ref(false)
const imageError = ref(false)
const selectedNodeId = ref('')
const customOpen = ref(false)

const session = computed(() => gridSession.value)
const cells = computed<GridCell[]>(() => {
  const s = session.value
  return s ? gridCells(s.rows, s.cols, s.width, s.height) : []
})
const chosen = computed(() => (session.value ? selectedCells(cells.value, session.value.selected) : []))
const allSelected = computed(() => !!session.value && chosen.value.length === cells.value.length)

/** 原图像素 → 屏幕：按可用区域等比 contain。切格坐标始终用原图像素，预览只是显示放大 */
const box = ref({ width: 0, height: 0 })
const display = computed(() => {
  const s = session.value
  if (!s) return { width: 0, height: 0, scale: 1 }
  const maxW = Math.max(320, box.value.width)
  const maxH = Math.max(240, box.value.height)
  const scale = Math.min(maxW / s.width, maxH / s.height, 1)
  return { width: Math.max(1, Math.round(s.width * scale)), height: Math.max(1, Math.round(s.height * scale)), scale }
})

const imageStyle = computed(() => ({
  width: display.value.width + 'px',
  height: display.value.height + 'px',
}))

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${session.value?.cols ?? 1}, 1fr)`,
  gridTemplateRows: `repeat(${session.value?.rows ?? 1}, 1fr)`,
}))

const sourceName = computed(() => {
  const id = session.value?.nodeId
  const node = id ? ctx.tryGet<DocService>('doc')?.getNode(id) : undefined
  const label = node?.data?.label
  return typeof label === 'string' && label ? label : '宫格切分'
})

function notify(message: string, kind: 'error' | 'info' = 'info'): void {
  notice.value = message
  noticeKind.value = kind
  if (kind === 'error') {
    const tip = ctx.tryGet<{ show?: (t: string) => void } | undefined>('tip')
    tip?.show?.(message)
  }
}

function sourceUrlOf(data: Record<string, unknown> | undefined): string {
  if (!data) return ''
  return typeof data.imageUrl === 'string' ? data.imageUrl : ''
}

function close(): void {
  closeGridSession()
  imageLoaded.value = false
  imageError.value = false
  notice.value = ''
}

function toggleAll(): void {
  if (!session.value) return
  setGridSelection(allSelected.value ? [] : allCellKeys(session.value.rows, session.value.cols))
}

function onImageError(): void {
  imageError.value = true
  notify('图片加载失败，无法切分', 'error')
}

/** 文档/资源依赖：组件直接取上下文（与项目现行插件写法一致），不让 apply 预读层层传 props */
function actionDeps(): GridActionDeps | null {
  const doc = ctx.tryGet<DocService>('doc')
  if (!doc) {
    notify('画布数据还没准备好', 'error')
    return null
  }
  const resources = ctx.tryGet<{ put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string> } | undefined>('resources')
  const creator = ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD).top('image')?.value
  return {
    doc,
    ...(resources ? { resources } : {}),
    ...(creator && typeof creator.addNode === 'function' ? { mediaCreator: creator } : {}),
    notify: (message, level) => notify(message, level ?? 'error'),
  }
}

/** 读取当前图片节点的“现在能显示的地址”：优先解析 resourceId，旧存档回退 imageUrl */
async function resolveSource(): Promise<{ url: string; nodeId: string } | null> {
  const nodeId = session.value?.nodeId ?? ''
  const node = nodeId ? ctx.tryGet<DocService>('doc')?.getNode(nodeId) : undefined
  if (!node) {
    notify('原图节点已不存在，切分已取消', 'error')
    return null
  }
  const resourceId = typeof node.data?.resourceId === 'string' ? node.data.resourceId : ''
  const legacyUrl = typeof node.data?.imageUrl === 'string' ? node.data.imageUrl : ''
  const resources = ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> } | undefined>('resources')
  let url = typeof legacyUrl === 'string' ? legacyUrl : ''
  if (typeof resourceId === 'string' && resourceId) {
    try {
      url = (await resources?.resolve(resourceId)) || url
    } catch {
      /* 资源服务失败时回退旧地址（同 imageRefs 的口径） */
    }
  }
  if (!url) {
    notify('原图地址已失效，切分已取消', 'error')
    return null
  }
  return { url, nodeId }
}

/** 把新图放哪：原图右侧，留出一段间距；不会覆盖附近的已有节点 */
function originRightOfNode(nodeId: string): { x: number; y: number } {
  const doc = ctx.tryGet<DocService>('doc')
  const layout = ctx.tryGet<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null } | undefined>('nodeLayout')
  const rect = layout?.getNodeRect(nodeId)
  if (rect) return { x: Math.round(rect.x + rect.w + 40), y: Math.round(rect.y) }
  const node = doc?.getNode(nodeId)
  if (node) return { x: Math.round(node.position.x + (node.size?.w ?? 320) + 40), y: Math.round(node.position.y) }
  const vp = flow.viewport.value
  return { x: Math.round(-(vp.x || 0) / Math.max(vp.zoom || 1, 0.01) + 80), y: Math.round(-(vp.y || 0) / Math.max(vp.zoom || 1, 0.01) + 80) }
}

async function publish(): Promise<void> {
  if (busy.value || !session.value || chosen.value.length === 0) {
    if (chosen.value.length === 0) notify('至少选择一个格子', 'error')
    return
  }
  const deps = actionDeps()
  if (!deps) return
  const src = await resolveSource()
  if (!src) return
  busy.value = 'publish'
  notice.value = ''
  try {
    const origin = originRightOfNode(src.nodeId)
    const group = ctx.tryGet<{ createGroup(ids: string[]): string | null } | undefined>('group')
    const result = await publishGrid(deps, {
      source: session.value.imageUrl || src.url,
      cells: cells.value,
      selected: session.value.selected,
      origin,
      namePrefix: '宫格图片',
    })
    if (result.imageNodeIds.length > 0 && group) {
      const groupId = group.createGroup(result.imageNodeIds)
      if (groupId) ctx.tryGet<{ set(ids: Iterable<string>): void } | undefined>('selection')?.set([groupId])
    }
    if (result.failures.length > 0) {
      notify(`已发布 ${result.imageNodeIds.length} 张；${result.failures.length} 张失败`, 'error')
    }
    if (result.imageNodeIds.length > 0) close()
  } catch (err) {
    notify('发布失败：' + (err instanceof Error ? err.message : String(err)), 'error')
  } finally {
    busy.value = ''
  }
}

async function createStoryboardNode(): Promise<void> {
  if (busy.value || !session.value || chosen.value.length === 0) {
    if (!session.value || chosen.value.length === 0) notify('至少选择一个格子', 'error')
    return
  }
  const deps = actionDeps()
  if (!deps) return
  const src = await resolveSource()
  if (!src) return
  busy.value = 'storyboard'
  notice.value = ''
  try {
    const result = await createStoryboard(deps, {
      source: session.value.imageUrl || src.url,
      cells: cells.value,
      selected: session.value.selected,
      rows: session.value.rows,
      cols: session.value.cols,
      origin: originRightOfNode(src.nodeId),
      namePrefix: '宫格分镜',
      cellWidth: Math.max(160, Math.round(session.value.width / session.value.cols)),
      cellHeight: Math.max(120, Math.round(session.value.height / session.value.rows)),
    })
    if (result.nodeId) {
      ctx.tryGet<{ set(ids: Iterable<string>): void } | undefined>('selection')?.set([result.nodeId])
      if (result.failures.length > 0) notify(`已创建分镜组；${result.failures.length} 张失败`, 'error')
      else close()
    }
  } catch (err) {
    notify('创建分镜组失败：' + (err instanceof Error ? err.message : String(err)), 'error')
  } finally {
    busy.value = ''
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (!session.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

function measureBox(): void {
  if (typeof window === 'undefined') return
  box.value = {
    width: Math.max(320, Math.round(window.innerWidth - 112)),
    height: Math.max(240, Math.round(window.innerHeight - 190)),
  }
}

onMounted(() => {
  measureBox()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', measureBox)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', measureBox)
})

void selectedNodeId
void sourceUrlOf
void sourceName
void ThemedDropdown
void ThemedButton
void customOpen
void imageLoaded
void toggleAll
</script>

<template>
  <Teleport to="body">
    <div v-if="session" class="igsw-root" role="dialog" aria-modal="true" aria-label="宫格切分工作台" data-testid="grid-split-workbench"
      @contextmenu.prevent>
      <!-- 顶部工具条：与截图的“图片编辑工作台”同一语义；先只放已实现的动作，避免假按钮 -->
      <header class="igsw-head">
        <div class="igsw-head-left">
          <span class="igsw-brand"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
          <span class="igsw-divider" />
          <component :is="ThemedDropdown || 'div'" v-model="customOpen" placement="bottom-start" :offset="8"
            menu-width="232px" body-class="igsw-size-body" :teleport="true">
            <template #trigger>
              <component :is="ThemedButton || 'button'" type="button" aria-label="修改宫格行列" :aria-expanded="customOpen"
                title="修改宫格行列">宫格 {{ session.rows }}×{{ session.cols }}</component>
            </template>
            <template #default>
              <GridSizePicker :model-value="{ rows: session.rows, cols: session.cols }" :max="5" @confirm="(v) => { closeGridSession(); customOpen = false; }" />
            </template>
          </component>
          <button class="igsw-text-btn" type="button" @click="toggleAll">{{ allSelected ? '取消全选' : '全选' }}</button>
        </div>
        <div class="igsw-meta">
          <span class="igsw-name">{{ sourceName }}</span>
          <span class="igsw-dims">{{ session.width }} × {{ session.height }}</span>
        </div>
        <div class="igsw-head-right">
          <button class="igsw-close" type="button" title="关闭 (Esc)" aria-label="退出宫格切分" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>

      <!-- 舞台：图层和图片同尺寸，格子坐标由 CSS 百分比等分，缩放不漂移 -->
      <main class="igsw-stage" @click.self="close">
        <div class="igsw-paper" :style="imageStyle">
          <img v-if="!imageError" class="igsw-img" :src="session.imageUrl" :alt="sourceName" draggable="false"
            @load="imageLoaded = true" @error="onImageError" />
          <div v-else class="igsw-broken">图片加载失败</div>
          <div class="igsw-grid" :style="gridStyle" role="group" aria-label="宫格选择区">
            <button v-for="cell in cells" :key="cellKey(cell.row, cell.col)" class="igsw-cell" type="button"
              :class="{ 'is-on': session.selected.has(cellKey(cell.row, cell.col)) }"
              :aria-label="`第 ${cell.row + 1} 行第 ${cell.col + 1} 列，${session.selected.has(cellKey(cell.row, cell.col)) ? '已选择' : '未选择'}`"
              :aria-pressed="session.selected.has(cellKey(cell.row, cell.col))"
              @click.stop="toggleGridCell(cellKey(cell.row, cell.col))">
              <span class="igsw-check" aria-hidden="true">
                <svg v-if="session.selected.has(cellKey(cell.row, cell.col))" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
              <span class="igsw-cell-no">{{ cell.row + 1 }}-{{ cell.col + 1 }}</span>
            </button>
          </div>
        </div>
      </main>

      <!-- 底部状态栏：四个动作按截图顺序；高清放大明确置灰，不放假按钮 -->
      <footer class="igsw-foot">
        <div v-if="notice" class="igsw-notice" :class="{ 'is-error': noticeKind === 'error' }" role="status">{{ notice }}</div>
        <div class="igsw-bar">
          <button class="igsw-action igsw-action--quit" type="button" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            退出宫格切分
          </button>
          <span class="igsw-sep" />
          <span class="igsw-count">已选择 {{ chosen.length }} 项</span>
          <span class="igsw-sep" />
          <button class="igsw-action" type="button" :disabled="!!busy || chosen.length === 0" @click="createStoryboardNode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
            {{ busy === 'storyboard' ? '创建中…' : '创建分镜组' }}
          </button>
          <button class="igsw-action" type="button" disabled title="高清放大暂未实现">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/></svg>
            高清放大
          </button>
          <button class="igsw-action igsw-action--primary" type="button" :disabled="!!busy || chosen.length === 0" @click="publish">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><polyline points="21 15 16 10 5 19"/></svg>
            {{ busy === 'publish' ? '发布中…' : '发布到画布' }}
          </button>
        </div>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
/* 全屏层：比 MediaViewer (100200) 低半档，避免用户从预览打开时两个层互相遮挡；
   这里只允许一个工作台实例（会话单源）。颜色走 token，暗色自动跟随。 */
.igsw-root { position: fixed; inset: 0; z-index: 100190; display: flex; flex-direction: column; background: var(--ui-scrim, rgb(15 23 42 / 0.35)); color: var(--ui-tip-ink, #fff); font-family: inherit; }
.igsw-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; margin: 10px 14px 0; padding: 6px 8px 6px 12px; border: 1px solid var(--ui-line, rgb(255 255 255 / 0.12)); border-radius: var(--radius-panel, 16px); background: var(--ui-overlay-solid, rgb(20 20 20 / 0.9)); color: var(--ui-ink, #f7f7f7); backdrop-filter: blur(20px); }
.igsw-head-left, .igsw-head-right, .igsw-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
.igsw-meta { flex: 1; justify-content: center; gap: 10px; overflow: hidden; }
.igsw-brand { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none; color: var(--ui-ink-dim, #6b7280); }
.igsw-brand svg { width: 16px; height: 16px; }
.igsw-divider { width: 1px; height: 18px; background: var(--ui-line, #e2e5ea); }
.igsw-text-btn { height: 28px; padding: 0 8px; border: 0; border-radius: var(--radius-badge, 6px); background: transparent; color: var(--ui-ink-dim, #6b7280); font-size: var(--text-label, 12px); cursor: pointer; }
.igsw-text-btn:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.igsw-name { max-width: 44vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-label, 12px); font-weight: 600; }
.igsw-dims { font-size: var(--text-sm, 11px); color: var(--ui-ink-mute, #8c95a3); font-variant-numeric: tabular-nums; }
.igsw-close { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-control, 8px); background: transparent; color: var(--ui-ink-dim, #6b7280); cursor: pointer; }
.igsw-close:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.igsw-close svg { width: 16px; height: 16px; }
.igsw-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 18px 24px 12px; }
.igsw-paper { position: relative; flex: none; border-radius: var(--radius-control, 8px); overflow: hidden; box-shadow: var(--ui-shadow-lg, 0 24px 64px rgb(15 23 42 / 0.20)); background: var(--ui-panel, #fff); }
.igsw-img { display: block; width: 100%; height: 100%; object-fit: fill; user-select: none; }
.igsw-broken { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: var(--ui-ink-mute, #8c95a3); font-size: var(--text-base, 13px); }
.igsw-grid { position: absolute; inset: 0; display: grid; gap: 1px; background: rgb(0 0 0 / 0.55); }
.igsw-cell { position: relative; display: block; min-width: 0; min-height: 0; padding: 0; border: 0; background: transparent; color: #fff; cursor: pointer; } /* 主题色白名单: 图片上的选区蒙层，固定在图像画面上，与主题无关 */
.igsw-cell::after { content: ''; position: absolute; inset: 0; background: rgb(0 0 0 / 0.28); transition: background-color 140ms ease; } /* 主题色白名单: 同上 */
.igsw-cell.is-on::after { background: transparent; }
.igsw-cell:hover::after { background: rgb(8 145 178 / 0.14); } /* 主题色白名单: 选区悬停强调，图像内固定 */
.igsw-cell:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: -2px; z-index: 2; }
.igsw-check { position: absolute; top: 7px; left: 7px; z-index: 2; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--ui-panel, #fff); color: var(--ui-accent-hover, #0e7490); box-shadow: 0 1px 3px rgb(0 0 0 / 0.28); } /* 主题色白名单: 勾选底为实心白，压在任意图片上保证 readability */
.igsw-check svg { width: 12px; height: 12px; }
.igsw-cell:not(.is-on) .igsw-check { background: rgb(255 255 255 / 0.22); color: transparent; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.85); } /* 主题色白名单: 未选中的空心圈固定白色 */
.igsw-cell-no { position: absolute; right: 7px; bottom: 5px; z-index: 2; font-size: var(--text-xs, 10px); font-weight: 700; font-variant-numeric: tabular-nums; color: rgb(255 255 255 / 0.72); opacity: 0; transition: opacity 120ms ease; text-shadow: 0 1px 3px rgb(0 0 0 / 0.6); } /* 主题色白名单: 图像上的编号 */
.igsw-cell:hover .igsw-cell-no { opacity: 1; }
.igsw-foot { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 24px 18px; }
.igsw-notice { max-width: 78vw; overflow: hidden; padding: 5px 10px; border-radius: var(--radius-badge, 6px); background: var(--ui-tip, rgb(24 32 43 / 0.92)); color: var(--ui-tip-ink, #fff); font-size: var(--text-sm, 11px); text-overflow: ellipsis; white-space: nowrap; }
.igsw-notice.is-error { background: var(--ui-danger, #ef4444); color: #fff; } /* 主题色白名单: 语义错误色 */
.igsw-bar { display: flex; align-items: center; gap: 4px; max-width: calc(100vw - 48px); padding: 6px 8px; border: 1px solid var(--ui-line, rgb(255 255 255 / 0.12)); border-radius: var(--radius-panel, 16px); background: var(--ui-overlay-solid, rgb(20 20 20 / 0.94)); color: var(--ui-ink, #f7f7f7); box-shadow: var(--ui-shadow-md, 0 18px 44px rgb(15 23 42 / 0.16)); overflow-x: auto; }
.igsw-action { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; border-radius: var(--radius-control, 8px); background: transparent; color: inherit; font-size: var(--text-label, 12px); white-space: nowrap; cursor: pointer; }
.igsw-action svg { width: 15px; height: 15px; flex: none; }
.igsw-action:hover:not(:disabled) { background: var(--ui-hover, rgb(255 255 255 / 0.12)); }
.igsw-action:focus-visible { outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.igsw-action:disabled { opacity: 0.45; cursor: not-allowed; }
.igsw-action--quit { color: var(--ui-ink-dim, #6b7280); }
.igsw-action--primary { background: var(--ui-primary-bg, #f7f7f7); color: var(--ui-primary-ink, #111); font-weight: 600; }
.igsw-action--primary:hover:not(:disabled) { background: var(--ui-primary-bg-hover, #e5e5e5); }
.igsw-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--ui-line, rgb(255 255 255 / 0.12)); }
.igsw-count { padding: 0 6px; color: var(--ui-ink-mute, #8c95a3); font-size: var(--text-sm, 11px); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .igsw-cell::after, .igsw-cell-no, .igsw-action, .igsw-close, .igsw-text-btn { transition: none; } }
@media (max-width: 720px) { .igsw-head { margin: 8px; } .igsw-stage { padding: 12px; } .igsw-foot { padding: 0 12px 12px; } .igsw-row--sub { display: none; } }
</style>
