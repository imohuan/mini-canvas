<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { AnimatePresence, motion } from 'motion-v'
import LibIcon from '../../LibIcon.vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useUi } from '../../../composables/ui'

const props = defineProps<{
  menuOpen: boolean
  viewMode: 'list' | 'grid'
}>()

const emit = defineEmits<{
  updateMenuOpen: [value: boolean]
  updateViewMode: [value: 'list' | 'grid']
  expandAll: []
  collapseAll: []
}>()

const ui = useUi()
const s = ui.state
const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const Input = useUiComponent('Input')

type InputRef = HTMLInputElement & { $el?: HTMLInputElement }
function focusInput(el: InputRef | null): void {
  const target = el?.$el ?? el
  if (typeof target?.focus === 'function') target.focus()
}
const searchInput = ref<InputRef | null>(null)
async function openSearch(): Promise<void> {
  s.searchOpen = true
  await nextTick()
  focusInput(searchInput.value)
}
function closeSearch(): void {
  s.searchOpen = false
  s.searchQuery = ''
}

const localMenuOpen = computed({
  get: () => props.menuOpen,
  set: (value: boolean) => emit('updateMenuOpen', value),
})
const localViewMode = computed({
  get: () => props.viewMode,
  set: (value: 'list' | 'grid') => emit('updateViewMode', value),
})
</script>

<template>
  <div v-if="s.leftTab === 'canvas'" class="relative flex h-12 flex-none items-center gap-1 p-2">
    <div class="pointer-events-none absolute inset-y-0 left-2 right-2 z-10 flex items-center">
      <AnimatePresence>
        <motion.div v-if="s.searchOpen" class="pointer-events-auto flex h-9 w-full items-center gap-1"
          :initial="{ width: 36, opacity: 0 }" :animate="{ width: '100%', opacity: 1 }"
          :exit="{ width: 36, opacity: 0 }" :transition="{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }">
          <div class="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] bg-chip px-2.5">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" class="flex-none text-ink-dim" aria-hidden="true">
              <path d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
                fill="currentColor" fill-rule="evenodd" />
            </svg>
            <Input ref="searchInput" v-model="s.searchQuery"
              class="h-full w-auto min-w-0 flex-1 rounded-lg border-0 bg-transparent px-0 md:text-[13px] leading-normal shadow-none focus-visible:border-transparent focus-visible:ring-0"
              placeholder="搜索节点" aria-label="搜索节点" @keydown.esc="closeSearch()" />
          </div>
          <DropdownMenu v-model:open="s.filterTypeOpen">
            <DropdownMenuTrigger as-child><Button variant="ghost" size="icon-sm" class="flex-none rounded-lg text-ink/85"
                aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" :side-offset="4">
              <DropdownMenuItem v-for="t in ['全部', '图片', '视频', '音频', '文本', '分组']" :key="t"
                @select="s.filterType = t; s.filterTypeOpen = false">{{ t }}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" class="flex-none rounded-lg text-ink/85"
            aria-label="关闭搜索" @click="closeSearch()">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </Button>
        </motion.div>
      </AnimatePresence>
    </div>

    <template v-if="!s.searchOpen">
      <Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85" aria-label="搜索节点" @click="openSearch">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path :d="'M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5'"
            fill="currentColor" fill-rule="evenodd" />
        </svg>
      </Button>
      <DropdownMenu v-model:open="s.filterTypeOpen">
        <DropdownMenuTrigger as-child><Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85"
            aria-label="筛选：全部"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" :side-offset="4">
          <DropdownMenuItem v-for="t in ['全部', '图片', '视频', '音频', '文本', '分组']" :key="t"
            @select="s.filterType = t; s.filterTypeOpen = false">{{ t }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span class="flex-1"></span>
      <DropdownMenu v-model:open="localMenuOpen">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85"
            aria-label="展示设置" :aria-expanded="menuOpen">
            <LibIcon name="display-grid" :size="16" class="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" :side-offset="4" :style="{ minWidth: '180px' }">
          <DropdownMenuItem :class="{ 'bg-accent': viewMode === 'list' }" @select="localViewMode = 'list'; localMenuOpen = false">
            <LibIcon name="list-view" :size="16" /> 列表展示 <svg v-if="viewMode === 'list'" class="ml-auto"
              width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z"
                fill="currentColor" />
            </svg>
          </DropdownMenuItem>
          <DropdownMenuItem :class="{ 'bg-accent': viewMode === 'grid' }" @select="localViewMode = 'grid'; localMenuOpen = false">
            <LibIcon name="display-grid" :size="16" /> 宫格展示 <svg v-if="viewMode === 'grid'" class="ml-auto"
              width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M13.8 4.2a.7.7 0 0 1 0 1L6.6 12.4a.7.7 0 0 1-1 0L2.2 9a.7.7 0 0 1 1-1l2.9 2.9 6.7-6.7a.7.7 0 0 1 1 0z"
                fill="currentColor" />
            </svg>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="emit('expandAll'); localMenuOpen = false">
            <LibIcon name="expand-groups" :size="16" /> 展开全部分组
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('collapseAll'); localMenuOpen = false">
            <LibIcon name="collapse-groups" :size="16" /> 收起全部分组
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>
  </div>
</template>
