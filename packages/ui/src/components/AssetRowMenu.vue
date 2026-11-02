<script setup lang="ts">
// AssetRowMenu —— 文件夹 / 资产的「⋯」操作菜单（抽屉与资产管理弹窗共用）。
//
// 结构：添加到Agent / 添加到画布 / 更改图标› / 新建子文件夹 / 移动到› /
//       （分隔）/ 下载 / 重命名 / 删除。
// 二级菜单全部用 shadcn 的 DropdownMenuSub（组件嵌套，不手写浮层）。
import { computed, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')
const DropdownMenuSub = useUiComponent('DropdownMenuSub')
const DropdownMenuSubContent = useUiComponent('DropdownMenuSubContent')
const DropdownMenuSubTrigger = useUiComponent('DropdownMenuSubTrigger')
import { FOLDER_ICON_NAMES, folderIconComponent } from '../composables/folderIcons'
import RowMenuShell from './RowMenuShell.vue'

const props = withDefaults(
  defineProps<{
    /** 行类型：文件夹 / 资产 */
    kind: 'folder' | 'asset'
    id: string
    name: string
    /** 该行当前图标名（文件夹） */
    icon?: string
    /** 「移动到 / 添加到」的目标文件夹（已排除自身） */
    folders: { id: string; name: string; depth: number }[]
    /** 标签清单（资产菜单用） */
    tagOptions?: string[]
    /** 资产当前标签（用于打勾） */
    tags?: string[]
    /** 该行当前所在的文件夹 id（空 = 根目录）：菜单里标出当前位置，免得点了「没反应」 */
    currentFolderId?: string
    /** 这行能否被引用；没有本机绝对路径的资产不给「添加到 Agent / 画布」 */
    usable?: boolean
  }>(),
  { usable: true },
)
const emit = defineEmits<{
  addAgent: []
  addCanvas: []
  childFolder: []
  moveTo: [folderId?: string]
  setIcon: [icon: string]
  rename: []
  download: []
  remove: []
  setTags: [tags: string[]]
}>()

const shellRef = ref<{ openAt: (x: number, y: number) => void } | null>(null)
const tagDraft = ref('')
const iconDraft = ref<string>('')
const iconName = computed(() => (iconDraft.value !== '' ? iconDraft.value : props.icon ?? ''))

const ICON_NAMES = FOLDER_ICON_NAMES
const iconCmp = (n: string): unknown => folderIconComponent(n)

/** 「移动到」二级菜单：层级缩进 + 根目录；active 标出当前位置。 */
const moveItems = computed(() => [
  ...props.folders.map((f) => ({
    key: f.id,
    label: f.name,
    indent: 8 + f.depth * 12,
    active: (props.currentFolderId ?? '') === f.id,
  })),
  { key: '', label: '（根目录）个人资产库', indent: 8, active: !props.currentFolderId },
])

function pickIcon(name: string): void {
  iconDraft.value = name
}
function applyIcon(close: () => void): void {
  emit('setIcon', iconDraft.value)
  close()
}
function clearIcon(close: () => void): void {
  iconDraft.value = ''
  emit('setIcon', '')
  close()
}
function pickTag(key: string, close: () => void): void {
  tagDraft.value = key
  const cur = [...(props.tags ?? [])]
  const i = cur.indexOf(key)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(key)
  emit('setTags', cur)
  close()
}

/** 右键唤出：转交外壳，与「⋯」按钮共用同一份菜单。 */
function openAt(x: number, y: number): void {
  shellRef.value?.openAt(x, y)
}
defineExpose({ openAt })
</script>

<template>
  <RowMenuShell ref="shellRef" :name="name" placement="bottom-end" menu-width="180px">
    <template #default="{ close }">
      <DropdownMenuItem v-if="usable" @select="emit('addAgent'); close()">添加到Agent</DropdownMenuItem>
      <DropdownMenuItem v-if="usable" @select="emit('addCanvas'); close()">添加到画布</DropdownMenuItem>

      <DropdownMenuSub v-if="kind === 'folder'">
        <DropdownMenuSubTrigger>更改图标</DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="arm-icon-menu">
          <div class="p-2">
            <p class="mb-2 text-[11px] text-ink-dim">图标选择</p>
            <div class="grid grid-cols-6 gap-1">
              <button
                v-for="n in ICON_NAMES" :key="n"
                class="grid size-7 place-items-center rounded-lg transition-colors"
                :class="iconName === n ? 'bg-hover-strong text-ink' : 'text-ink-dim hover:bg-hover hover:text-ink'"
                type="button" :aria-label="'选择图标 ' + n"
                @click="pickIcon(n)"
              ><component :is="iconCmp(n)" :size="14" /></button>
            </div>
            <div class="mt-2 flex justify-end gap-1.5">
              <button class="h-7 rounded-lg px-2.5 text-[12px] text-ink transition-colors hover:bg-hover" type="button" @click="clearIcon(close)">清除</button>
              <button class="h-7 rounded-lg bg-brand px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-brand/85" type="button" @click="applyIcon(close)">应用</button>
            </div>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem v-if="kind === 'folder'" @select="emit('childFolder'); close()">新建子文件夹</DropdownMenuItem>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>移动到</DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="arm-list-menu">
          <DropdownMenuItem v-for="it in moveItems" :key="it.key || 'root'" :style="{ paddingLeft: it.indent + 'px' }"
            @select="emit('moveTo', it.key || undefined); close()">{{ it.label }}</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub v-if="kind === 'asset'">
        <DropdownMenuSubTrigger>设置标签</DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="arm-list-menu">
          <DropdownMenuItem v-for="t in (tagOptions ?? [])" :key="t" @select="pickTag(t, close)">{{ t }}</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSeparator />
      <DropdownMenuItem @select="emit('download'); close()">下载</DropdownMenuItem>
      <DropdownMenuItem @select="emit('rename'); close()">重命名</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" @select="emit('remove'); close()">删除</DropdownMenuItem>
    </template>
  </RowMenuShell>
</template>

<style scoped>
.arm-icon-menu { width: 212px; padding: 0; }
.arm-list-menu { min-width: 160px; }
</style>
