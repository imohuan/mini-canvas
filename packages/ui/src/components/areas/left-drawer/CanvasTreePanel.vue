<script setup lang="ts">
import { Folder as FolderIcon, Video as VideoIcon, Type as TypeIcon, Image as ImageIcon, Music as AudioIcon } from 'lucide-vue-next'
import folderImg from '../../../assets/folder.png'
import LibIcon from '../../LibIcon.vue'
import CanvasRowMenu from '../../CanvasRowMenu.vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { CanvasTreeBlock } from '../../../composables/canvasTree'
import { useUi } from '../../../composables/ui'

defineProps<{
  show: boolean
  blocks: CanvasTreeBlock[]
  viewMode: 'list' | 'grid'
  renamingNodeId: string | null
  renamingNodeName: string
  bindCanvasMenu: (rowId: string, el: unknown) => void
}>()

const emit = defineEmits<{
  toggleCollapse: [id: string]
  renameInput: [value: string]
  renameCommit: []
  renameCancel: []
  startRename: [id: string, name: string]
  openMenu: [kind: 'group' | 'node', id: string, e: MouseEvent]
  locate: [id: string]
  ungroup: [id: string]
  duplicate: [id: string]
  addAgent: [id: string]
  remove: [id: string]
}>()

const ui = useUi()
const Button = useUiComponent('Button')
/** 画布树滚动层：与资产面板、设置左栏同一套组件库 ScrollArea。 */
const ScrollArea = useUiComponent('ScrollArea')

const lucideOf = (icon: string) =>
  icon === 'video' ? VideoIcon
    : icon === 'text' ? TypeIcon
      : icon === 'group' ? FolderIcon
        : icon === 'audio' ? AudioIcon
          : ImageIcon
</script>

<template>
  <ScrollArea v-if="show" class="canvas-tree-scroll min-h-0 flex-1">
    <div class="px-2 pb-2">
    <template v-for="block in blocks" :key="block.key">
      <!-- 分组行（任意层）：depth 决定缩进；行内改名与资产树同款（用户口径 2026-10-08） -->
      <div v-if="block.kind === 'group'"
        class="group/grow relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-2 transition-colors hover:bg-hover"
        :style="{ paddingLeft: block.depth * 24 + 'px' }" @contextmenu="emit('openMenu', 'group', block.id, $event)">
        <Button variant="ghost" size="icon-xs" class="flex-none rounded-lg text-ink/85"
          :aria-label="(block.collapsed ? '展开 ' : '折叠 ') + block.name" :aria-expanded="!block.collapsed"
          @click="emit('toggleCollapse', block.id)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
            :class="[block.collapsed ? '-rotate-90' : '', 'h-3.5 w-3.5 shrink-0 transition-transform']">
            <path
              d="M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z"
              fill="currentColor" transform="translate(3.4 5.8)" />
          </svg>
        </Button>
        <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
          :aria-label="(block.collapsed ? '展开 ' : '折叠 ') + block.name" :aria-expanded="!block.collapsed"
          @click="emit('toggleCollapse', block.id)">
          <img :src="folderImg" alt="" class="h-[30px] w-[33px] flex-none object-contain" draggable="false" />
          <input v-if="renamingNodeId === block.id" :value="renamingNodeName" data-canvas-rename
            class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
            aria-label="分组名称" @input="emit('renameInput', ($event.target as HTMLInputElement).value)" @click.stop
            @keydown.enter="emit('renameCommit')" @keydown.esc.stop="emit('renameCancel')" @blur="emit('renameCommit')" />
          <span v-else class="min-w-0 flex-1 truncate pr-0.5 text-sm leading-[22px]">{{ block.name }}</span>
        </button>
        <span
          class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/grow:opacity-100 group-hover/grow:opacity-100">
          <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(block.id, el)" kind="group" :name="block.name"
            @rename="emit('startRename', block.id, block.name)" @locate="emit('locate', block.id)"
            @ungroup="emit('ungroup', block.id)" @remove="emit('remove', block.id)" />
          <Button variant="ghost" size="icon-xs" class="rounded-lg text-ink-dim hover:text-ink"
            :aria-label="'定位到分组 ' + block.name" @click="emit('locate', block.id)">
            <LibIcon name="locate" :size="14" class="size-3.5 shrink-0" />
          </Button>
        </span>
      </div>

      <!-- 同层节点段（任意层）：列表 = 缩进行；宫格 = 一个三列网格（每层各自成网格，缩进不打架） -->
      <template v-else>
        <template v-if="viewMode === 'list'">
          <!--
            pr-2：行尾给那个「⋯」按钮留出真实的空间（不再是 4px 贴边）。
            用户 2026-11-05 截图：悬停时右侧按钮被行背景/滚动条压住。
          -->
          <div v-for="child in block.nodes" :key="child.id"
            class="group/row relative flex h-11 w-full items-center gap-0.5 rounded-[10px] py-1 pr-2 transition-colors hover:bg-hover"
            :style="{ paddingLeft: block.depth * 24 + 'px' }"
            @contextmenu="emit('openMenu', 'node', child.id, $event)">
            <span class="size-6 flex-none" aria-hidden="true"></span>
            <button class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
              :aria-label="'定位到节点 ' + child.name" @click="emit('locate', child.id)">
              <span
                class="relative grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-thumb text-ink-mute">
                <img v-if="child.thumb" :src="child.thumb" alt="" class="h-full w-full object-cover" />
                <template v-else-if="child.video">
                  <video :src="child.video" class="h-full w-full object-cover" muted playsinline preload="metadata"
                    aria-hidden="true"></video>
                  <span
                    class="absolute grid size-5 place-items-center rounded-full bg-[var(--ui-scrim)] text-[var(--ui-tip-ink)]"
                    aria-hidden="true"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="7,4 19,12 7,20" />
                    </svg></span>
                </template>
                <component v-else :is="lucideOf(child.icon)" :size="16" />
              </span>
              <input v-if="renamingNodeId === child.id" :value="renamingNodeName" data-canvas-rename
                class="h-7 min-w-0 flex-1 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
                aria-label="节点名称" @input="emit('renameInput', ($event.target as HTMLInputElement).value)" @click.stop
                @keydown.enter="emit('renameCommit')" @keydown.esc.stop="emit('renameCancel')" @blur="emit('renameCommit')" />
              <span v-else class="min-w-0 flex-1 truncate text-sm leading-[22px]">{{ child.name }}</span>
            </button>
            <span
              class="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
              <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(child.id, el)" kind="node" :name="child.name"
                @rename="emit('startRename', child.id, child.name)" @locate="emit('locate', child.id)"
                @duplicate="emit('duplicate', child.id)" @add-agent="emit('addAgent', child.id)"
                @remove="emit('remove', child.id)" />
              <Button variant="ghost" size="icon-xs" class="rounded-lg text-ink-dim hover:text-ink"
                :aria-label="'定位到节点 ' + child.name" @click="emit('locate', child.id)">
                <LibIcon name="locate" :size="14" class="size-3.5 shrink-0" />
              </Button>
            </span>
          </div>
        </template>

        <!--
          宫格模式：列数按抽屉**实际宽度**自动排（不再是写死 3 列）。
          抽屉可以拖宽 / 拖窄，固定 3 列在窄抽屉里会把方形缩略图压成细条
          （用户 2026-11-06 截图：卡片全变成窄竖条，名字被截成两行）。
          用 auto-fill + minmax 后，窄了自动变 2 列 / 1 列，宽了自动多排。
        -->
        <div v-else class="canvas-node-grid pt-0.5" :style="{ paddingLeft: block.depth * 24 + 'px' }">
          <div v-for="child in block.nodes" :key="child.id"
            class="group/cell relative flex min-w-0 flex-col gap-2 rounded-[16px] p-1 pb-3"
            @contextmenu="emit('openMenu', 'node', child.id, $event)">
            <button v-if="renamingNodeId !== child.id" class="absolute inset-0 z-10 rounded-[16px]"
              :aria-label="'定位到节点 ' + child.name" @click="emit('locate', child.id)"></button>
            <div
              class="canvas-node-thumb relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-thumb-soft transition-colors group-hover/cell:border-line-soft">
              <img v-if="child.thumb" :src="child.thumb" alt="" class="h-full w-full object-cover" />
              <video v-else-if="child.video" :src="child.video" class="h-full w-full object-cover" muted playsinline
                preload="metadata" aria-hidden="true"></video>
              <span
                class="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl text-ink-mute">
                <span v-if="!child.thumb" class="flex w-[26%] shrink-0 items-center justify-center">
                  <component :is="child.video ? VideoIcon : lucideOf(child.icon)" :size="29" :stroke-width="1" />
                </span>
              </span>
              <span v-if="child.video"
                class="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--ui-scrim)] text-[var(--ui-tip-ink)] backdrop-blur-sm"
                aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="7,4 19,12 7,20" />
                </svg></span>
            </div>
            <input v-if="renamingNodeId === child.id" :value="renamingNodeName" data-canvas-rename
              class="h-7 min-w-0 rounded-md border border-brand/60 bg-chip px-1.5 text-[13px] text-ink focus:outline-none"
              aria-label="节点名称" @input="emit('renameInput', ($event.target as HTMLInputElement).value)" @click.stop
              @keydown.enter="emit('renameCommit')" @keydown.esc.stop="emit('renameCancel')" @blur="emit('renameCommit')" />
            <span v-else class="truncate px-0.5 text-[13px] leading-none text-ink">{{ child.name }}</span>
            <span
              class="absolute right-1 top-1 z-20 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100">
              <CanvasRowMenu :ref="(el: unknown) => bindCanvasMenu(child.id, el)" kind="node" :name="child.name"
                @rename="emit('startRename', child.id, child.name)" @locate="emit('locate', child.id)"
                @duplicate="emit('duplicate', child.id)" @add-agent="emit('addAgent', child.id)"
                @remove="emit('remove', child.id)" />
            </span>
          </div>
        </div>
      </template>
    </template>
    </div>
  </ScrollArea>
</template>

<style scoped>
/*
 * 宫格卡片列数：按可用宽度自动排，最小 88px。
 *
 * 为什么不固定 3 列（用户 2026-11-06 截图）：抽屉最小宽度只有两百多像素，
 * 3 列固定宽度会把每张卡压成 40px 宽的竖条，方形缩略图和名字都变形。
 *
 * min(88px, 100%) 兜底：极端窄（<88px）时也只用满宽度，绝不横向溢出。
 * 抽屉默认宽度下仍是一行 3 张；拖宽后自动变 4～5 张，不必再改代码。
 */
.canvas-node-grid {
  display: grid;
  gap: 2px;
  grid-template-columns: repeat(auto-fill, minmax(min(88px, 100%), 1fr));
}

/*
 * 宫格卡 hover = 图案放大（与项目页同一套语言，用户 2026-11-06 定）。
 *
 * 卡片本身不位移；只让缩略图里的图案放大 1.3 倍并转成主题色，
 * 同时铺一层很淡的主题色光。图片 / 视频缩略图同理放大，外框不动，
 * 所以下方名字不会跟着抖。
 */
.canvas-node-thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(100% 100% at 50% 30%, var(--ui-accent-soft, rgb(8 145 178 / 0.12)), transparent 72%);
  opacity: 0;
  transition: opacity 0.22s ease;
  pointer-events: none;
}
.canvas-node-thumb :deep(svg),
.canvas-node-thumb :deep(img),
.canvas-node-thumb :deep(video) {
  position: relative;
  z-index: 1;
  transition: transform 0.32s cubic-bezier(0.2, 0.7, 0.3, 1), color 0.18s ease;
}
.group\/cell:hover .canvas-node-thumb::after {
  opacity: 1;
}
.group\/cell:hover .canvas-node-thumb :deep(svg),
.group\/cell:hover .canvas-node-thumb :deep(img),
.group\/cell:hover .canvas-node-thumb :deep(video) {
  transform: scale(1.3);
}
.group\/cell:hover .canvas-node-thumb :deep(svg) {
  color: var(--ui-accent, #0891b2);
}
@media (prefers-reduced-motion: reduce) {
  .canvas-node-thumb :deep(svg),
  .canvas-node-thumb :deep(img),
  .canvas-node-thumb :deep(video),
  .canvas-node-thumb::after { transition: none !important; }
}
</style>
