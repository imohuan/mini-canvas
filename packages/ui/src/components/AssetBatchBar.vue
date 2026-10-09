<script setup lang="ts">
// AssetBatchBar —— **通用**批量操作悬浮条（用户口径：抽屉窄、弹窗宽，同一套东西）。
// 结构照图 1 / 图 3：× | ☑ 已选择 N 项 | 添加到▾ | 移动到 | 修改标签 | 下载 | 删除
// 定位由宿主决定（抽屉 = absolute 贴抽屉底；弹窗 = absolute 贴弹窗底），本组件只管长相与动作。
import { computed, ref } from 'vue'
import { X as XIcon, SquareCheck as CheckIcon, FolderPlus as AddIcon, FolderInput as MoveIcon,
  Tags as TagIcon, Download as DownloadIcon, Trash2 as TrashIcon } from 'lucide-vue-next'
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'
import AxMenuItem from './AxMenuItem.vue'

const props = defineProps<{
  count: number
  /** 目标文件夹清单（「添加到 / 移动到」的菜单项；树形平铺成带缩进的行） */
  folders: { id: string; name: string; depth: number }[]
  /** 标签固定清单（「修改标签」菜单项；多选后回调） */
  tagOptions: string[]
  /** 紧凑模式（窄容器如抽屉）：按钮只留图标不显示文字，防止挤变形 */
  compact?: boolean
}>()
const emit = defineEmits<{
  exit: []
  addTo: [folderId: string]
  moveTo: [folderId: string]
  setTags: [tags: string[]]
  download: []
  remove: []
}>()

const addOpen = ref(false)
const moveOpen = ref(false)
const tagOpen = ref(false)
const folderRows = computed(() =>
  props.folders.map((f) => ({ ...f, pad: 'padding-left:' + (8 + f.depth * 14) + 'px' })),
)
/**
 * 点一项标签 = 直接应用并关闭（原来只切勾选、要再点「确定」，于是点完菜单还挂着 —— 用户报的
 * 「点击之后它没有自动消失」）。与 AssetRowMenu / 上传弹窗的标签选择保持同一手感：点即生效。
 */
function applyTag(t: string, close: () => void): void {
  emit('setTags', [t])
  close()
}
</script>

<template>
  <div
    class="pointer-events-auto flex h-11 min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-panel/95 px-2 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl"
    role="toolbar" aria-label="批量操作"
  >
    <button class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="退出批量操作" @click="emit('exit')"><XIcon :size="15" /></button>
    <span class="ml-1 flex flex-none items-center gap-1.5 text-[12px] text-ink" :class="compact ? 'mr-1' : 'mr-2'">
      <span class="grid size-4 place-items-center rounded-[4px] bg-brand text-white"><CheckIcon :size="11" /></span>
      <span class="whitespace-nowrap">{{ compact ? count + ' 项' : '已选择 ' + count + ' 项' }}</span>
    </span>
    <AxDropdown v-model="addOpen" placement="top-end" :offset="8">
      <template #trigger><button class="flex h-7 flex-none items-center gap-1 rounded-lg px-2 text-[12px] text-ink transition-colors hover:bg-hover" :aria-expanded="addOpen" aria-label="添加到"><AddIcon :size="13" /><span v-if="!compact">添加到</span></button></template>
      <template #default="{ close }">
        <AxMenu>
          <AxMenuItem v-for="f in folderRows" :key="f.id" :style="f.pad" @click="emit('addTo', f.id); close()">{{ f.name }}</AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
    <AxDropdown v-model="moveOpen" placement="top-end" :offset="8">
      <template #trigger><button class="flex h-7 flex-none items-center gap-1 rounded-lg px-2 text-[12px] text-ink transition-colors hover:bg-hover" :aria-expanded="moveOpen" aria-label="移动到"><MoveIcon :size="13" /><span v-if="!compact">移动到</span></button></template>
      <template #default="{ close }">
        <AxMenu>
          <AxMenuItem v-for="f in folderRows" :key="f.id" :style="f.pad" @click="emit('moveTo', f.id); close()">{{ f.name }}</AxMenuItem>
          <AxMenuItem v-if="folders.length" @click="emit('moveTo', ''); close()"><span class="text-ink-dim">（根目录）</span></AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
    <AxDropdown v-model="tagOpen" placement="top-end" :offset="8" menu-width="200px">
      <template #trigger><button class="flex h-7 flex-none items-center gap-1 rounded-lg px-2 text-[12px] text-ink transition-colors hover:bg-hover" :aria-expanded="tagOpen" aria-label="修改标签"><TagIcon :size="13" /><span v-if="!compact">修改标签</span></button></template>
      <template #default="{ close }">
        <AxMenu>
          <AxMenuItem v-for="t in tagOptions" :key="t" @click="applyTag(t, close)">{{ t }}</AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
    <button class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="下载选中资产" @click="emit('download')"><DownloadIcon :size="14" /></button>
    <button class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-danger-soft hover:text-danger" aria-label="删除选中资产" @click="emit('remove')"><TrashIcon :size="14" /></button>
  </div>
</template>
