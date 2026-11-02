<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { AnimatePresence, motion } from 'motion-v'
import { Plus as PlusIcon, FolderPlus as FolderPlusIcon, Upload as UploadIcon } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useUi } from '../../../composables/ui'
import { openAssetManager } from '../../../composables/assetUiBus'

const props = defineProps<{
  assetSearchActive: boolean
  plusOpen: boolean
  assetKinds: string[]
}>()

const emit = defineEmits<{
  updatePlusOpen: [value: boolean]
  updateUploadOpen: [value: boolean]
  updateAssetSearchActive: [value: boolean]
  addFolder: []
  pickAssetKind: [kind: string]
  uploadChange: [e: Event]
}>()

const ui = useUi()
const s = ui.state
const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const Input = useUiComponent('Input')

type InputRef = HTMLInputElement & { $el?: HTMLInputElement }
function focusInput(el: InputRef | null): void {
  const target = el?.$el ?? el
  if (typeof target?.focus === 'function') target.focus()
}
const assetSearchInput = ref<InputRef | null>(null)
async function openAssetSearch(): Promise<void> {
  emit('updateAssetSearchActive', true)
  s.assetSearchQuery = ''
  await nextTick()
  focusInput(assetSearchInput.value)
}
function closeAssetSearch(): void {
  emit('updateAssetSearchActive', false)
  s.assetSearchQuery = ''
}

const localPlusOpen = computed({
  get: () => props.plusOpen,
  set: (value: boolean) => emit('updatePlusOpen', value),
})
const uploadInput = ref<HTMLInputElement | null>(null)
function pickUpload(): void {
  uploadInput.value?.click()
}
</script>

<template>
  <div v-if="s.leftTab === 'assets'" class="relative flex h-12 flex-none items-center gap-1 p-2">
    <div class="pointer-events-none absolute inset-y-0 left-2 right-2 z-10 flex items-center">
      <AnimatePresence>
        <motion.div v-if="assetSearchActive" class="pointer-events-auto flex h-9 w-full items-center gap-1"
          :initial="{ width: 36, opacity: 0 }" :animate="{ width: '100%', opacity: 1 }"
          :exit="{ width: 36, opacity: 0 }" :transition="{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }">
          <div class="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] bg-chip px-2.5">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" class="flex-none text-ink-dim" aria-hidden="true">
              <path d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
                fill="currentColor" fill-rule="evenodd" />
            </svg>
            <Input ref="assetSearchInput" v-model="s.assetSearchQuery"
              class="h-full w-auto min-w-0 flex-1 rounded-lg border-0 bg-transparent px-0 md:text-[13px] leading-normal shadow-none focus-visible:border-transparent focus-visible:ring-0"
              placeholder="搜索资产" aria-label="搜索资产" @keydown.esc.stop="closeAssetSearch()" />
          </div>
          <Button variant="ghost" size="icon-sm" class="flex-none rounded-lg text-ink/85"
            aria-label="关闭搜索" @click="closeAssetSearch()">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
          </Button>
        </motion.div>
      </AnimatePresence>
    </div>
    <template v-if="!assetSearchActive">
      <Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85" aria-label="搜索" @click="openAssetSearch()"><svg
          width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M11 2.25a8.75 8.75 0 0 1 6.7 14.38l3.83 3.84a.75.75 0 1 1-1.06 1.06l-3.84-3.84A8.75 8.75 0 1 1 11 2.25m0 1.5a7.25 7.25 0 1 0 0 14.5 7.25 7.25 0 0 0 0-14.5"
            fill="currentColor" fill-rule="evenodd" />
        </svg></Button>
      <Button variant="ghost" size="icon-sm" class="rounded-lg"
        :class="s.assetBatchOn ? 'bg-brand/15 text-brand' : 'text-ink/85'" aria-label="批量操作"
        :aria-pressed="s.assetBatchOn" @click="ui.toggleAssetBatch()"><svg width="15" height="15" viewBox="0 0 20 20"
          fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" />
          <path d="M5.5 11.5v3a2 2 0 0 0 2 2h1M14.5 8.5v-3a2 2 0 0 0-2-2h-1" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" />
        </svg></Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="rounded-lg"
            :class="s.assetFilterKind !== '全部' ? 'text-brand' : 'text-ink/85'" aria-label="筛选"><svg width="15"
              height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 5h18M7 12h10M10.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" :side-offset="4">
          <DropdownMenuItem v-for="k in assetKinds" :key="k" :class="{ 'bg-accent': s.assetFilterKind === k }"
            @select="emit('pickAssetKind', k)">{{ k }}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span class="flex-1"></span>
      <DropdownMenu v-model:open="localPlusOpen">
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="rounded-lg text-ink/85"
            aria-label="新建或上传" :aria-expanded="plusOpen">
            <PlusIcon :size="16" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" :side-offset="4">
          <DropdownMenuItem @select="localPlusOpen = false; emit('addFolder')">
            <FolderPlusIcon :size="14" class="text-ink-dim" /> 新建文件夹
          </DropdownMenuItem>
          <DropdownMenuItem @select="localPlusOpen = false; emit('updateUploadOpen', true)">
            <UploadIcon :size="14" class="text-ink-dim" /> 上传资产
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="secondary" size="sm" class="h-8 rounded-lg px-2.5 text-[13px] font-normal hover:bg-hover-strong"
        aria-label="资产管理" @click="openAssetManager(undefined, { fromRef: false })">资产管理</Button>
    </template>
    <input ref="uploadInput" type="file" multiple class="hidden" aria-hidden="true" @change="emit('uploadChange', $event)" />
  </div>
</template>
