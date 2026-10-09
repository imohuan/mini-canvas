<script setup lang="ts">
// AssetRowMenu —— 文件夹 / 资产的「…」操作菜单（**抽屉与资产管理弹窗共用**，
// 用户口径：弹窗里对文件夹和文件的操作，效果和侧边栏一样）。
//
// 结构照图 2/3/4：
//   添加到Agent / 添加到画布 / 更改图标› / 新建子文件夹 / 移动到› /（分隔）/ 下载 / 重命名 / 删除
// 资产的菜单：添加到Agent / 添加到画布 / 移动到› / 设置标签› /（分隔）/ 下载 / 重命名 / 删除
//
// 两个二级菜单都用 <AxSubMenu> **组件嵌套**，不手写浮层（用户明确要求）。
import { computed, ref } from 'vue'
import { FOLDER_ICON_NAMES, folderIconComponent } from '../composables/folderIcons'
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'
import AxMenuItem from './AxMenuItem.vue'
import AxSubMenu from './AxSubMenu.vue'

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
    /** 该行**当前所在**的文件夹 id（空 = 根目录）：菜单里标出当前位置，免得点了「没反应」 */
    currentFolderId?: string
    /**
     * 这行能否被引用（默认 true）。
     *
     * 用户口径：**没有本机绝对路径的资产不给「添加到Agent / 添加到画布」**——
     * 它的字节不在本机，引用出去对方也取不到，给了按钮只会让人白点一次。
     */
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

const open = ref(false)
/** 浮层实例（右键唤出时借它的「鼠标点锚点」能力） */
const dropdownRef = ref<{ openAtPoint: (x: number, y: number) => void } | null>(null)
/** 图标草稿（点「应用」才 emit） */
const iconDraft = ref<string>('')
const iconName = computed(() => (iconDraft.value !== '' ? iconDraft.value : props.icon ?? ''))

const ICON_NAMES = FOLDER_ICON_NAMES
const iconCmp = (n: string): unknown => folderIconComponent(n)

/**
 * 「移动到」二级菜单项（层级缩进 + 根目录）。
 *
 * active = 该项就是**当前所在位置** —— 打勾标出来。用户报过「移动到没生效」：
 * 根因是当前位置的目标点了当然没变化，但菜单上没有任何提示，看着像功能坏了。
 */
const moveItems = computed(() => [
  ...props.folders.map((f) => ({
    key: f.id,
    label: f.name,
    indent: 8 + f.depth * 12,
    active: (props.currentFolderId ?? '') === f.id,
  })),
  { key: '', label: '（根目录）个人资产库', active: !props.currentFolderId },
])
/** 标签二级菜单项 */
const tagItems = computed(() =>
  (props.tagOptions ?? []).map((t) => ({ key: t, label: t, active: (props.tags ?? []).includes(t) })),
)

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
function pickTag(close: () => void): void {
  // 单选式切换（与上传弹窗一致：点行即加/移除）
  const cur = [...(props.tags ?? [])]
  const i = cur.indexOf(tagDraft.value)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(tagDraft.value)
  emit('setTags', cur)
  close()
}
/** 二级菜单点击时用来暂存选中项 */
const tagDraft = ref('')

/**
 * 右键唤出：转交给 AxDropdown 的「鼠标点锚点」能力 ——
 * 同一份菜单，按鼠标点定位（翻转/防溢出/互斥/关闭规则全部照旧）。
 */
function openAt(x: number, y: number): void {
  dropdownRef.value?.openAtPoint(x, y)
}
defineExpose({ openAt })
</script>

<template>
  <!-- 菜单项**一律不带图标**（用户口径：要么全带、要么全不带；这里是全不带）。
       二级菜单仍用 <AxSubMenu> 组件嵌套（不手写浮层）。 -->
  <AxDropdown ref="dropdownRef" v-model="open" placement="bottom-end" :offset="4" menu-width="180px">
    <template #trigger>
      <button
        class="grid size-6 flex-none place-items-center rounded-lg text-ink-dim opacity-0 transition-opacity hover:bg-hover hover:text-ink group-hover/row:opacity-100 focus-visible:opacity-100"
        :aria-label="'更多操作 ' + name" :aria-expanded="open"
      ><slot name="trigger"><span class="text-[13px] leading-none">⋯</span></slot></button>
    </template>
    <template #default="{ close }">
      <AxMenu @click.stop>
        <!-- 没有本机绝对路径的资产：这两个入口直接不出现（引用出去对方也取不到） -->
        <AxMenuItem v-if="usable" @click="emit('addAgent'); close()">添加到Agent</AxMenuItem>
        <AxMenuItem v-if="usable" @click="emit('addCanvas'); close()">添加到画布</AxMenuItem>

        <!-- 文件夹：更改图标（二级 = 图标网格，网格里当然要有图标） -->
        <AxSubMenu v-if="kind === 'folder'" label="更改图标" :items="[]" menu-width="212px">
          <template #default="{ close: closeSub }">
            <div class="p-2">
              <p class="mb-2 text-[11px] text-ink-dim">图标选择</p>
              <div class="grid grid-cols-6 gap-1">
                <button
                  v-for="n in ICON_NAMES" :key="n"
                  class="grid size-7 place-items-center rounded-lg transition-colors"
                  :class="iconName === n ? 'bg-hover-strong text-ink' : 'text-ink-dim hover:bg-hover hover:text-ink'"
                  role="button" :aria-label="'选择图标 ' + n"
                  @click="pickIcon(n)"
                ><component :is="iconCmp(n)" :size="14" /></button>
              </div>
              <div class="mt-2 flex justify-end gap-1.5">
                <button class="h-7 rounded-lg px-2.5 text-[12px] text-ink transition-colors hover:bg-hover" @click="clearIcon(closeSub)">清除</button>
                <button class="h-7 rounded-lg bg-brand px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-brand/85" @click="applyIcon(closeSub)">应用</button>
              </div>
            </div>
          </template>
        </AxSubMenu>
        <AxMenuItem v-if="kind === 'folder'" @click="emit('childFolder'); close()">新建子文件夹</AxMenuItem>

        <!-- 移动到（二级 = 文件夹列表） -->
        <AxSubMenu label="移动到" :items="moveItems" @pick="(key: string) => { emit('moveTo', key || undefined); close() }" />

        <!-- 资产：设置标签（二级 = 标签清单） -->
        <AxSubMenu v-if="kind === 'asset'" label="设置标签" :items="tagItems" @pick="(key: string) => { tagDraft = key; pickTag(close) }" />

        <div class="my-1 h-px bg-line"></div>
        <AxMenuItem @click="emit('download'); close()">下载</AxMenuItem>
        <AxMenuItem @click="emit('rename'); close()">重命名</AxMenuItem>
        <AxMenuItem danger @click="emit('remove'); close()">删除</AxMenuItem>
      </AxMenu>
    </template>
  </AxDropdown>
</template>
