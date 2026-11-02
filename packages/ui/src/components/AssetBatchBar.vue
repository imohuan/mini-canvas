<script setup lang="ts">
// AssetBatchBar —— **通用**批量操作悬浮条（用户口径：抽屉窄、弹窗宽，同一套东西）。
// 结构照图 1 / 图 3：× | 已选 N 项 | 添加到▾ | 移动到 | 修改标签 | 下载 | 删除
// 定位由宿主决定（抽屉 = absolute 贴抽屉底；弹窗 = absolute 贴弹窗底），本组件只管长相与动作。
import { computed, ref } from 'vue'
import { X as XIcon, FolderPlus as AddIcon, FolderInput as MoveIcon,
  Tags as TagIcon, Download as DownloadIcon, Trash2 as TrashIcon } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
const Tooltip = useUiComponent('Tooltip')
const TooltipContent = useUiComponent('TooltipContent')
const TooltipProvider = useUiComponent('TooltipProvider')
const TooltipTrigger = useUiComponent('TooltipTrigger')

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
    <!--
      抽屉（compact）里按钮只留图标、没有文字，所以悬停必须能看出这是干什么的（用户口径 2026-10-13：
      「在左侧面板时，这些按钮都没有文字说明；弹出框时因为宽度足够，所以有文字」，给抽屉这侧补提示）。
      宽版（弹窗）本来就有文字，不再挂提示 —— 同一个按钮既有文字又有气泡是噪音。
    -->
    <TooltipProvider :delay-duration="120">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 text-ink-dim hover:text-ink" aria-label="退出批量操作" @click="emit('exit')"><XIcon :size="15" /></Button>
        </TooltipTrigger>
        <TooltipContent side="top">退出批量操作</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <!--
      这里原先还有一颗对勾方块（青底白勾 → 后来改的中性色）。用户口径 2026-10-13：
      「我觉得你这个图标没有留下的必要，可以改为『已选多少项』」—— 抽屉窄，方块白占地方，
      去掉它、文字写成「已选 N 项」就够（宽版弹窗保持「已选择 N 项」的原措辞）。
    -->
    <span class="ml-1 flex flex-none items-center gap-1.5 text-[12px] text-ink" :class="compact ? 'mr-1' : 'mr-2'">
      <span class="whitespace-nowrap">{{ compact ? '已选 ' + count + ' 项' : '已选择 ' + count + ' 项' }}</span>
    </span>
    <DropdownMenu v-model:open="addOpen">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="xs" class="h-7 flex-none text-[12px] text-ink" :aria-expanded="addOpen" aria-label="添加到"><AddIcon :size="13" /><span v-if="!compact">添加到</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" :side-offset="8">
        <DropdownMenuItem v-for="f in folderRows" :key="f.id" :style="f.pad" @select="emit('addTo', f.id)">{{ f.name }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu v-model:open="moveOpen">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="xs" class="h-7 flex-none text-[12px] text-ink" :aria-expanded="moveOpen" aria-label="移动到"><MoveIcon :size="13" /><span v-if="!compact">移动到</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" :side-offset="8">
        <DropdownMenuItem v-for="f in folderRows" :key="f.id" :style="f.pad" @select="emit('moveTo', f.id)">{{ f.name }}</DropdownMenuItem>
        <DropdownMenuItem v-if="folders.length" @select="emit('moveTo', '')"><span class="text-ink-dim">（根目录）</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu v-model:open="tagOpen">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="xs" class="h-7 flex-none text-[12px] text-ink" :aria-expanded="tagOpen" aria-label="修改标签"><TagIcon :size="13" /><span v-if="!compact">修改标签</span></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" :side-offset="8" :style="{ minWidth: '200px' }">
        <DropdownMenuItem v-for="t in tagOptions" :key="t" @select="applyTag(t, () => (tagOpen = false))">{{ t }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <TooltipProvider :delay-duration="120">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 text-ink-dim hover:text-ink" aria-label="下载选中资产" @click="emit('download')"><DownloadIcon :size="14" /></Button>
        </TooltipTrigger>
        <TooltipContent side="top">下载</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <TooltipProvider :delay-duration="120">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="size-7 text-ink-dim hover:bg-danger-soft hover:text-danger" aria-label="删除选中资产" @click="emit('remove')"><TrashIcon :size="14" /></Button>
        </TooltipTrigger>
        <TooltipContent side="top">删除</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
