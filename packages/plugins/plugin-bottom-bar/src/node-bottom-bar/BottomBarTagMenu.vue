<script setup lang="ts">
import { ref } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { nodeIdOfChip } from '../refSlots'
import type { TagMenuEntry, TagMenuKind } from '../tagMenu'

defineProps<{
  open: boolean
  anchorStyle: Record<string, string>
  query: string
  chip: ResourceItem | null
  flat: boolean
  flatItems: TagMenuEntry[]
  sections: { referenced: TagMenuEntry[]; kinds: Array<{ kind: TagMenuKind; label: string; items: TagMenuEntry[] }> }
  activeKind: TagMenuKind | null
  activeItems: TagMenuEntry[]
  thumbOf: (e: { kind: string; url?: string }) => string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:query': [value: string]
  'update:activeKind': [value: TagMenuKind]
  rowEnter: [entry: TagMenuEntry, rowEl: HTMLElement]
  rowLeave: []
  pick: [entry: TagMenuEntry]
}>()

const anchorEl = ref<HTMLElement | null>(null)
const searchBoxEl = ref<HTMLElement | null>(null)
function focusSearch(): void {
  const input = searchBoxEl.value?.querySelector('input')
  input?.focus()
  // 打开即全选：用户多半是直接重打关键词，不是接着上一轮的搜索词继续打
  input?.select?.()
}
defineExpose({ anchorEl, focusSearch })

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
// 搜索框走全局注册的 shadcn 组件（用户 2026-11-06：不要手写原生输入框）
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')
</script>

<template>
  <DropdownMenu :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DropdownMenuTrigger as-child>
      <span ref="anchorEl" class="nb-tagmenu-anchor" aria-hidden="true" :style="anchorStyle" />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="start"
      side="bottom"
      :side-offset="6"
      class="nb-tagmenu-body"
      :style="{ width: flat ? '268px' : '452px', maxHeight: '420px' }"
    >
      <div ref="searchBoxEl" class="nb-tagmenu-searchbox">
        <InputGroup class="nb-tagmenu-search">
          <InputGroupAddon align="inline-start">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </InputGroupAddon>
          <InputGroupInput
            :model-value="query"
            type="search"
            placeholder="搜索"
            aria-label="搜索画布素材"
            @update:model-value="(v: string | number) => emit('update:query', String(v))"
            @keydown.stop
            @keydown.esc.stop="emit('update:open', false)"
          />
          <InputGroupAddon v-if="query" align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="emit('update:query', '')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div v-if="flat" class="nb-tagmenu-list" role="menu" aria-label="搜索结果">
        <Button variant="ghost" size="sm"
          v-for="e in flatItems"
          :key="e.id"
          class="nb-tagmenu-row"
          :class="{ 'is-current': e.id === nodeIdOfChip(String(chip?.id ?? '')) }"
          type="button"
          role="menuitem"
          :data-entry-id="e.id"
          @pointerenter="(ev: PointerEvent) => emit('rowEnter', e, ev.currentTarget as HTMLElement)"
          @pointerleave="emit('rowLeave')"
          @click.stop="emit('pick', e)"
        >
          <span class="nb-tagmenu-thumb" :data-kind="e.kind" aria-hidden="true">
            <img v-if="thumbOf(e)" :src="thumbOf(e)" alt="" draggable="false" />
          </span>
          <span class="nb-tagmenu-name">{{ e.name }}</span>
          <svg v-if="e.referenced" class="nb-tagmenu-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 12 4 4L19 6" />
          </svg>
        </Button>
        <div v-if="flatItems.length === 0" class="nb-tagmenu-empty">没有匹配的节点</div>
      </div>

      <div v-else class="nb-tagmenu-panes">
        <div class="nb-tagmenu-pane nb-tagmenu-pane--nav" role="menu" aria-label="节点类别">
          <template v-if="sections.referenced.length > 0">
            <div class="nb-tagmenu-group-label">已引用</div>
            <Button variant="ghost" size="sm"
              v-for="e in sections.referenced"
              :key="e.id"
              class="nb-tagmenu-row"
              :class="{ 'is-current': e.id === nodeIdOfChip(String(chip?.id ?? '')) }"
              type="button"
              role="menuitem"
              :data-entry-id="e.id"
              @pointerenter="(ev: PointerEvent) => emit('rowEnter', e, ev.currentTarget as HTMLElement)"
              @pointerleave="emit('rowLeave')"
              @click.stop="emit('pick', e)"
            >
              <span class="nb-tagmenu-thumb" :data-kind="e.kind" aria-hidden="true">
                <img v-if="thumbOf(e)" :src="thumbOf(e)" alt="" draggable="false" />
              </span>
              <span class="nb-tagmenu-name">{{ e.name }}</span>
            </Button>
          </template>
          <div v-if="sections.kinds.length > 0" class="nb-tagmenu-group-label">素材引用</div>
          <Button variant="ghost" size="sm"
            v-for="k in sections.kinds"
            :key="k.kind"
            class="nb-tagmenu-row nb-tagmenu-kind"
            :class="{ 'is-active': k.kind === activeKind }"
            type="button"
            :aria-expanded="k.kind === activeKind"
            @pointerenter="emit('update:activeKind', k.kind)"
            @focus="emit('update:activeKind', k.kind)"
            @click.stop="emit('update:activeKind', k.kind)"
          >
            <span class="nb-tagmenu-thumb" :data-kind="k.kind" aria-hidden="true" />
            <span class="nb-tagmenu-name">{{ k.label }}</span>
            <svg class="nb-tagmenu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
            <span class="nb-tagmenu-count">{{ k.items.length }}</span>
          </Button>
        </div>
        <div class="nb-tagmenu-pane nb-tagmenu-pane--items" role="menu" :aria-label="'选择节点'">
          <Button variant="ghost" size="sm"
            v-for="e in activeItems"
            :key="e.id"
            class="nb-tagmenu-row"
            :class="{ 'is-current': e.id === nodeIdOfChip(String(chip?.id ?? '')) }"
            type="button"
            role="menuitem"
            :data-entry-id="e.id"
            @pointerenter="(ev: PointerEvent) => emit('rowEnter', e, ev.currentTarget as HTMLElement)"
            @pointerleave="emit('rowLeave')"
            @click.stop="emit('pick', e)"
          >
            <span class="nb-tagmenu-thumb" :data-kind="e.kind" aria-hidden="true">
              <img v-if="thumbOf(e)" :src="thumbOf(e)" alt="" draggable="false" />
            </span>
            <span class="nb-tagmenu-name">{{ e.name }}</span>
          </Button>
          <div v-if="activeItems.length === 0" class="nb-tagmenu-empty">画布上没有可用的节点</div>
        </div>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
