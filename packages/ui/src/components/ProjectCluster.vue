<script setup lang="ts">
// ProjectCluster —— 左上角「块 A」：logo + **当前画布名（可直接改）** + 画布 chip。
//
// 这个组件在同一个页面里被**渲染两次**（左上角悬浮栏 / 左侧抽屉头部），
// 两块 UI 完全一致，同一时刻只显示一个：抽屉打开时左上角那份隐藏。
//
// 名字语义（用户口径）：左边那个可编辑的名字 = **当前画布的名字**（改了就是改这张画布，
// 下拉里出现的也是这些名字）；右边的小胶囊显示「画布 + 索引」，只是位置提示。
//
// 画布列表行（用户口径 2026-11-05）：
//   整行就是一个 shadcn 的 DropdownMenuSubTrigger —— 悬停整行即展开二级菜单
//   （在新窗口打开 / 重命名画布 / 复制画布 / 删除画布），开合时机交给组件默认行为；
//   点击整行仍然是切画布。当前画布只用整行浅色背景表示选中，不显示勾。
import { ChevronDown, Plus } from 'lucide-vue-next'
import { computed } from 'vue'
// 外壳按钮与下拉菜单从画布 ctx 的 ui 注册表按名取；行内交互保持不变。
import { useUiComponent } from '@mini-canvas/canvas-render'

const Button = useUiComponent('Button')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuSeparator = useUiComponent('DropdownMenuSeparator')
const DropdownMenuSub = useUiComponent('DropdownMenuSub')
const DropdownMenuSubContent = useUiComponent('DropdownMenuSubContent')
const DropdownMenuSubTrigger = useUiComponent('DropdownMenuSubTrigger')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')

/** 下拉里的一项：画布 id + 显示名 */
export interface CanvasOption {
  id: string
  label: string
}

const props = defineProps<{
  /** 当前画布的名字（显示在可编辑输入框里） */
  canvas: string
  /** 当前画布 id（判断哪一行显示选中背景） */
  canvasId: string
  /** 画布清单（下拉列出每一项；点了切过去） */
  canvasItems: CanvasOption[]
  menuOpen: boolean
}>()

const emit = defineEmits<{
  'update:menuOpen': [boolean]
  'open-menu': []
  'new-canvas': []
  /** 切到某张画布（发 id） */
  'pick-canvas': [string]
  /** 改当前画布的名字（输入框失焦 / 回车时发） */
  'rename-canvas': [string]
  /** 在新窗口打开某张画布（发 id） */
  'open-canvas-window': [string]
  /** 重命名某张画布（发 id） */
  'rename-canvas-item': [string]
  /** 复制某张画布（发 id） */
  'duplicate-canvas': [string]
  /** 删除某张画布（发 id） */
  'delete-canvas': [string]
}>()

/** 右侧小胶囊只显示「画布 + 索引」（位置提示）；画布名显示在左边的输入框里 */
const canvasIndex = computed(() => Math.max(1, props.canvasItems.findIndex((c) => c.id === props.canvasId) + 1))

// 「删除画布」**永远可点**（用户口径 2026-10-09）：
//   「不管是哪个画布都支持删除，即使是当前选中的也支持删除，只不过删除之后跳转到第一个画布就行」
// 所以这里不再有任何「能不能删」的判断 —— 内置画布也删、当前画布也删；
// 删完跳到第一张（一张不剩就自动补建一张）的收尾在宿主 ui.deleteCanvas 里做。
</script>

<template>
  <div class="project-cluster">
    <Button variant="ghost" class="logo-button h-8 w-[57px] gap-[3px] rounded-lg px-2 font-normal"
      aria-label="项目菜单" aria-haspopup="dialog" @click="emit('open-menu')">
      <svg viewBox="0 0 25 14.5" width="25" height="14.5" class="size-[25px_14.5px] shrink-0" fill="none" aria-hidden="true"><path fill="currentColor" d="M5.258 10.803h12.458l-1.064 3.742H0L3.099 3.726h4.194zm14.493-7.061H7.293L8.357 0h16.668L21.91 10.82h-4.194z"/></svg>
      <ChevronDown :size="12" class="logo-chevron size-3 shrink-0" />
    </Button>
    <input
      class="project-name"
      aria-label="画布名称"
      :value="canvas"
      maxlength="120"
      @change="emit('rename-canvas', ($event.target as HTMLInputElement).value)"
    />
    <span class="divider"></span>
    <DropdownMenu :open="menuOpen" @update:open="emit('update:menuOpen', $event)">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" class="canvas-chip h-8 gap-1 rounded-lg px-2 font-normal"
          aria-label="当前画布" :aria-expanded="menuOpen">
          <span>画布 {{ canvasIndex }}</span><ChevronDown :size="12" class="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent arrow align="start" :side-offset="2" :style="{ minWidth: '232px' }">
          <!-- 头部也是一条 DropdownMenuItem：加号在行尾，样式与下面的画布行同源。 -->
          <DropdownMenuItem :style="{ fontSize: '12px', color: 'var(--ui-ink-dim)' }" aria-label="新建画布"
            @select="emit('new-canvas'); emit('update:menuOpen', false)">
            画布
            <Plus :size="14" class="ml-auto" />
          </DropdownMenuItem>
          <!-- 整行 = SubTrigger：悬停展开二级菜单（组件默认行为），点击切画布。 -->
          <DropdownMenuSub
            v-for="item in canvasItems"
            :key="item.id"
          >
            <DropdownMenuSubTrigger
              :aria-current="item.id === canvasId ? 'true' : undefined"
              :aria-label="'画布 ' + item.label"
              @click="emit('pick-canvas', item.id); emit('update:menuOpen', false)"
            >
              <span>{{ item.label }}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent :style="{ minWidth: '176px' }">
              <DropdownMenuItem @select="emit('open-canvas-window', item.id); emit('update:menuOpen', false)">在新窗口打开</DropdownMenuItem>
              <DropdownMenuItem @select="emit('rename-canvas-item', item.id); emit('update:menuOpen', false)">重命名画布</DropdownMenuItem>
              <DropdownMenuItem @select="emit('duplicate-canvas', item.id); emit('update:menuOpen', false)">复制画布</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" @select="emit('delete-canvas', item.id); emit('update:menuOpen', false)">删除画布</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<style scoped>
/* 全部走主题变量：亮色下 logo 用深墨色，暗色下用浅色，避免"浅底浅图标"看不清 */
.project-cluster { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0; border: 1px solid var(--ui-line); border-radius: 8px; background: var(--ui-panel); }
.logo-button { color: var(--ui-ink); background: transparent; cursor: pointer; }
.logo-chevron { color: var(--ui-ink-dim); }
.project-name { width: 86px; height: 22px; padding: 0 4px; color: inherit; border: 0; border-bottom: 1px dashed transparent; outline: 0; background: transparent; font-family: inherit; font-size: 13px; }
.project-name:hover { border-bottom-color: var(--ui-line); }
.divider { width: 1px; height: 21px; margin: 0; background: var(--ui-line); }
.canvas-chip { color: inherit; background: transparent; cursor: pointer; font-size: 13px; }
.logo-button:hover, .canvas-chip:hover { background: var(--ui-hover) !important; }
</style>
