<script setup lang="ts">
// 弹窗工具行的按钮区：搜索 / 批量 / 筛选 / 新建，保持原有 DOM 与事件顺序。
import { Search as SearchIcon, ListFilter as BatchIcon, Filter as FilterIcon, Plus as PlusIcon, FolderPlus as FolderPlusIcon, Upload as UploadIcon } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'

const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuRadioGroup = useUiComponent('DropdownMenuRadioGroup')
const DropdownMenuRadioItem = useUiComponent('DropdownMenuRadioItem')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')

defineProps<{
  batchOn: boolean
  assetKinds: readonly string[]
  activeKind: string
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const kindOpen = defineModel<boolean>('kindOpen', { required: true })
const plusOpen = defineModel<boolean>('plusOpen', { required: true })

const emit = defineEmits<{
  toggleBatch: []
  pickKind: [kind: string]
  addFolder: []
  openUpload: []
}>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child><button
        class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
        aria-label="搜索">
        <SearchIcon :size="15" />
      </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="4">
      <div class="p-1.5">
        <input v-model="searchQuery"
          class="h-8 w-48 rounded-lg bg-chip px-2.5 text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
          placeholder="搜索资产" aria-label="搜索资产" />
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
  <button class="grid size-8 place-items-center rounded-lg transition-colors hover:bg-hover"
    :class="batchOn ? 'bg-brand/15 text-brand' : 'text-ink/85'" aria-label="批量操作" :aria-pressed="batchOn"
    @click="emit('toggleBatch')">
    <BatchIcon :size="15" />
  </button>
  <DropdownMenu v-model:open="kindOpen">
    <DropdownMenuTrigger as-child><button
        class="grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
        aria-label="筛选" :aria-expanded="kindOpen">
        <FilterIcon :size="15" />
      </button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="4">
      <!-- 类型筛选是单选：当前项用组件自带行尾勾表示，不再叠整行主题色底（问题 03）。 -->
      <DropdownMenuRadioGroup :model-value="activeKind">
        <DropdownMenuRadioItem v-for="k in assetKinds" :key="k" :value="k"
          @select="emit('pickKind', k)">{{ k }}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
  <!-- 加号下拉：新建文件夹 / 上传资产（照左侧抽屉的加号；用户口径 2026-10-08） -->
  <DropdownMenu v-model:open="plusOpen">
    <DropdownMenuTrigger as-child>
      <button
        class="ml-2 grid size-8 place-items-center rounded-lg text-ink/85 transition-colors hover:bg-hover"
        aria-label="新建或上传" :aria-expanded="plusOpen">
        <PlusIcon :size="15" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" :side-offset="4">
        <DropdownMenuItem @select="plusOpen = false; emit('addFolder')">
          <FolderPlusIcon :size="14" class="text-ink-dim" /> 新建文件夹
        </DropdownMenuItem>
        <DropdownMenuItem @select="plusOpen = false; emit('openUpload')">
          <UploadIcon :size="14" class="text-ink-dim" /> 上传资产
        </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
