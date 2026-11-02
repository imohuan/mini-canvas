<script setup lang="ts">
// ProjectCluster —— 左上角「块 A」：logo + **当前画布名（可直接改）** + 画布 chip。
//
// 这个组件在同一个页面里被**渲染两次**（左上角悬浮栏 / 左侧抽屉头部），
// 两块 UI 完全一致，同一时刻只显示一个：抽屉打开时左上角那份隐藏。
//
// 名字语义（用户口径）：左边那个可编辑的名字 = **当前画布的名字**（改了就是改这张画布，
// 下拉里出现的也是这些名字）；右边的小胶囊显示「画布 + 索引」，只是位置提示。
//
// 画布列表的行尾（用户口径 2026-10-09，附效果图）：
//   ① 当前画布 → 行尾常显一个**勾**（位置提示）；
//   ② 鼠标悬停（或键盘聚焦）这一行 → 勾**换成三个点**；没选中的行则直接现出三个点；
//   ③ 点三个点 → 在它旁边弹出该画布的**操作菜单**（在新窗口打开 / 重命名画布 / 复制画布 / 删除画布）。
//
// 为什么卷标行要拆成「两个按钮」而不是像以前那样在一行里套一个 span 当按钮：
//   行的主点击 = 切画布，行尾 = 另一件事（开操作菜单）。一个 <button> 里再塞一个可点的 span，
//   读屏会把两件事说成一件事，也是 ui-style-guide §5 第 2 条明令禁止的嵌套交互。
import { Check, ChevronDown, MoreHorizontal, Plus } from 'lucide-vue-next'
import { computed, ref } from 'vue'
// 外壳按钮与下拉菜单全部使用 shadcn 原始组件；行内交互保持不变。
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@mini-canvas/ui-kit-shadcn'

/** 下拉里的一项：画布 id + 显示名 */
export interface CanvasOption {
  id: string
  label: string
}

const props = defineProps<{
  /** 当前画布的名字（显示在可编辑输入框里） */
  canvas: string
  /** 当前画布 id（判断哪一行打勾） */
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

// ===== 行尾「⋯」弹的**画布操作菜单** =====
//
// 画布操作菜单与画布列表都使用 shadcn 的 DropdownMenu：
// 行尾「⋯」的菜单是列表的**子菜单**（DropdownMenuSub），列表留着、子菜单并排展开；
// 选中项后一起收起，定位/翻转/点外关闭交给 reka-ui。
const actionOpen = ref(false)
const actionTarget = ref<CanvasOption | null>(null)

/** 点行尾的「⋯」/「勾」：记下是哪张画布（子菜单的条目据此派发） */
function openActions(item: CanvasOption): void {
  actionTarget.value = item
}

/** 操作菜单里选了一项：转发给宿主（宿主才知道怎么改数据），并收起菜单 */
function pickAction(
  ev: 'open-canvas-window' | 'rename-canvas-item' | 'duplicate-canvas' | 'delete-canvas',
  close: () => void,
): void {
  const id = actionTarget.value?.id
  // 逐个 if 而不是 emit(dynamicName, id)：Vue 的 emit 签名按事件名分别声明，
  // 传联合类型会被判成「不匹配任何一个重载」（vue-tsc 报错）。
  if (id) {
    if (ev === 'open-canvas-window') emit('open-canvas-window', id)
    else if (ev === 'rename-canvas-item') emit('rename-canvas-item', id)
    else if (ev === 'duplicate-canvas') emit('duplicate-canvas', id)
    else emit('delete-canvas', id)
  }
  close()
}

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
      <DropdownMenuContent align="start" :side-offset="6" :style="{ minWidth: '232px' }">
          <div class="canvas-menu-head">
            <span>画布</span>
            <Button variant="ghost" size="icon-xs" class="canvas-new size-[22px] rounded-md" aria-label="新建画布"
              @click="emit('new-canvas'); emit('update:menuOpen', false)"><Plus :size="13" class="size-[13px]" /></Button>
          </div>
          <!-- 一行 = 主按钮（切画布）+ 行尾按钮（开操作菜单）。两个动作，两个真按钮。 -->
          <div
            v-for="item in canvasItems"
            :key="item.id"
            class="canvas-row"
            :class="{ 'is-active': item.id === canvasId }"
          >
            <button
              type="button"
              class="canvas-row-main"
              role="menuitem"
              :aria-current="item.id === canvasId ? 'true' : undefined"
              :aria-label="'切换到画布 ' + item.label"
              @click="emit('pick-canvas', item.id); emit('update:menuOpen', false)"
            >
              <span class="canvas-open">{{ item.label }}</span>
            </button>
            <!-- 悬停/聚焦才显形；选中行的「勾」也靠 hover 让位给「⋯」（一组 hover 场景切换，故写在本行里） -->
            <DropdownMenuSub v-model:open="actionOpen" @update:open="(v: boolean) => { if (v) openActions(item) }">
              <DropdownMenuSubTrigger class="canvas-row-more" :class="{ 'is-pinned': item.id === canvasId }"
                :aria-label="'画布操作 ' + item.label">
                <Check v-if="item.id === canvasId" class="canvas-row-check" :size="14" aria-hidden="true" />
                <MoreHorizontal class="canvas-row-dots" :size="14" aria-hidden="true" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent :style="{ minWidth: '176px' }">
                <DropdownMenuItem @select="pickAction('open-canvas-window', () => (actionOpen = false))">在新窗口打开</DropdownMenuItem>
                <DropdownMenuItem @select="pickAction('rename-canvas-item', () => (actionOpen = false))">重命名画布</DropdownMenuItem>
                <DropdownMenuItem @select="pickAction('duplicate-canvas', () => (actionOpen = false))">复制画布</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" @select="pickAction('delete-canvas', () => (actionOpen = false))">删除画布</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>
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
.canvas-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 8px; font-size: 12px; }
.canvas-new { color: var(--ui-ink); background: transparent; cursor: pointer; }
.canvas-new:hover { background: var(--ui-hover) !important; }
/* ===== 画布列表行 =====
   行 = 主按钮（切画布）+ 行尾按钮（操作菜单）。两者都要是 32px 的可点目标（ui-style-guide §5 第 4 条）。 */
.canvas-row { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
/* 底必须打在**行**上，不能打在行里的按钮上（用户口径 2026-10-09：
   「hover 的是整块的一个背景」）。打在按钮上只会染主按钮那半块 ——
   行尾「⋯」与两者之间的留白就成了没底的缺口，看着像「只有左侧有背景」。
   选中行（与「勾」一起表达「当前就是这张」）与 hover 行都给整行一块底。 */
.canvas-row.is-active { background: var(--ui-hover-soft, var(--ui-hover)); }
.canvas-row:hover { background: var(--ui-hover); }
.canvas-row-main { display: flex; flex: 1; min-width: 0; align-items: center; height: 32px; padding: 0 10px; color: var(--ui-ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-family: inherit; font-size: 13px; text-align: left; }
.canvas-row-main:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: -1px; }
.canvas-open { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 行尾：默认 32×32 占位（行内不跳动的锚），勾/三个点叠在同一格里换显 */
.canvas-row-more { position: relative; display: grid; flex: none; place-items: center; width: 32px; height: 32px; padding: 0; color: var(--ui-ink-dim); border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
/* 这个「⋯」本身就是子菜单触发器，ui-kit 会再塞一个 › 箭头，两个图标在 32px 里会叠在一起。
   行尾只留勾/三个点，箭头去掉（用户口径 2026-11-02）。 */
.canvas-row-more :deep(svg.ml-auto) { display: none; }
.canvas-row-check, .canvas-row-dots { grid-area: 1 / 1; transition: opacity .14s ease; }
/* 选中行的勾：常显。鼠标进这一行 → 勾让位给三个点（用户口径：hover 时图标变成三个点）。 */
.canvas-row-more.is-pinned .canvas-row-check { opacity: 1; }
.canvas-row-more.is-pinned .canvas-row-dots { opacity: 0; }
.canvas-row:hover .canvas-row-more.is-pinned .canvas-row-check { opacity: 0; }
.canvas-row:hover .canvas-row-more.is-pinned .canvas-row-dots { opacity: 1; }
/* 未选中的行：平时不占视线，hover 行（或键盘聚焦按钮）才现出三个点。 */
.canvas-row-more:not(.is-pinned) .canvas-row-check { display: none; }
.canvas-row-more:not(.is-pinned) .canvas-row-dots { opacity: 0; }
.canvas-row:hover .canvas-row-more:not(.is-pinned) .canvas-row-dots,
.canvas-row-more:focus-visible .canvas-row-dots { opacity: 1; }
/* 行尾按钮 hover **不给底色**，只把图标颜色提亮（用户口径 2026-10-09：
   「这个按钮不要给 hover 的背景颜色，就直接给这个图标颜色就行」）。 */
.canvas-row-more:hover { color: var(--ui-ink); }
.canvas-row-more:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: -1px; }
@media (prefers-reduced-motion: reduce) {
  .canvas-row-check, .canvas-row-dots { transition: none; }
}
</style>
