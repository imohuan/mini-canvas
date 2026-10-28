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
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'
import AxMenuItem from './AxMenuItem.vue'

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
// 用 AxDropdown 的「鼠标点锚点」（openAtPoint，行右键菜单同款）：菜单挂 body 下、按点击坐标定位，
// 所以外层列表在它弹出时被互斥关掉也不影响它 —— 锚点不依赖那个随即卸载的行 DOM。
const actionOpen = ref(false)
const actionRef = ref<{ openAtPoint: (x: number, y: number) => void } | null>(null)
const actionTarget = ref<CanvasOption | null>(null)

// 外层**画布列表**的浮层实例：操作菜单要**挂在它旁边**（而不是把它顶掉）。
const listRef = ref<{ isOpen?: boolean; chainId?: string } | null>(null)
/** 操作菜单的父浮层上下文：不点开列表时（null）它就是普通下拉 */
const actionParent = (): { chain: string; open: boolean } | undefined => {
  const list = listRef.value
  if (!list?.chainId) return undefined
  return { chain: list.chainId, open: list.isOpen === true }
}

/** 点行尾的「⋯」/「勾」：记下是哪张画布，在按钮下方弹出操作菜单（**列表留着**） */
function openActions(e: MouseEvent, item: CanvasOption): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  actionTarget.value = item
  // 同屏并存：操作菜单是列表的**子浮层**（nestedIn），列表不收、操作菜单挂在按钮下。
  // 锚点取按钮**右缘**：菜单从列表右边展开，与列表并排（就是用户效果图里的摆法）。
  // 若这一份菜单正开着（连着点另一行的「⋯」），AxDropdown 内部会按新坐标重算位置。
  actionRef.value?.openAtPoint(r.right + 2, r.bottom + 4)
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
    <button class="logo-button" aria-label="项目菜单" aria-haspopup="dialog" @click="emit('open-menu')">
      <svg viewBox="0 0 25 14.5" width="25" height="14.5" fill="none" aria-hidden="true"><path fill="currentColor" d="M5.258 10.803h12.458l-1.064 3.742H0L3.099 3.726h4.194zm14.493-7.061H7.293L8.357 0h16.668L21.91 10.82h-4.194z"/></svg>
      <ChevronDown :size="12" class="logo-chevron" />
    </button>
    <input
      class="project-name"
      aria-label="画布名称"
      :value="canvas"
      maxlength="120"
      @change="emit('rename-canvas', ($event.target as HTMLInputElement).value)"
    />
    <span class="divider"></span>
    <AxDropdown
      ref="listRef"
      :model-value="menuOpen"
      placement="bottom-start"
      menu-width="214px"
      arrow
      @update:model-value="emit('update:menuOpen', $event)"
    >
      <template #trigger>
        <button class="canvas-chip" aria-label="当前画布" :aria-expanded="menuOpen">
          <span>画布 {{ canvasIndex }}</span><ChevronDown :size="12" />
        </button>
      </template>
      <template #default="{ close }">
        <AxMenu>
          <div class="canvas-menu-head">
            <span>画布</span>
            <button class="canvas-new" aria-label="新建画布" @click="emit('new-canvas'); close()"><Plus :size="13" /></button>
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
              @click="emit('pick-canvas', item.id); close()"
            >
              <span class="canvas-open">{{ item.label }}</span>
            </button>
            <!-- 悬停/聚焦才显形；选中行的「勾」也靠 hover 让位给「⋯」（一组 hover 场景切换，故写在本行里） -->
            <button
              type="button"
              class="canvas-row-more"
              :class="{ 'is-pinned': item.id === canvasId }"
              :aria-label="'画布操作 ' + item.label"
              :aria-expanded="actionOpen && actionTarget?.id === item.id"
              @click.stop="openActions($event, item)"
            >
              <Check v-if="item.id === canvasId" class="canvas-row-check" :size="14" aria-hidden="true" />
              <MoreHorizontal class="canvas-row-dots" :size="14" aria-hidden="true" />
            </button>
          </div>
        </AxMenu>
      </template>
    </AxDropdown>

    <!--
    画布操作菜单（点行尾「⋯」弹出）。锚点走 AxDropdown 的「鼠标点锚点」，与行右键菜单同一套机制：
      翻转 / 防溢出 / 互斥 / 点外关闭全照旧，不另写一份定位。
       它没有触发器（只为借那个锚点能力），所以整块藏起来 —— 浮层本体是 teleport 到 body 的，
       藏住这个空壳不影响菜单弹出（也不在胶囊里多占一个格）。
    -->
    <span class="canvas-action-host">
      <AxDropdown
        ref="actionRef"
        v-model="actionOpen"
        placement="bottom-start"
        :arrow="false"
        menu-width="176px"
        :nested-in="actionParent"
      >
        <template #default="{ close }">
          <AxMenu @click.stop>
            <AxMenuItem @click="pickAction('open-canvas-window', close)">在新窗口打开</AxMenuItem>
            <AxMenuItem @click="pickAction('rename-canvas-item', close)">重命名画布</AxMenuItem>
            <AxMenuItem @click="pickAction('duplicate-canvas', close)">复制画布</AxMenuItem>
            <div class="my-1 h-px bg-line"></div>
            <!-- 删除：**永远可点**（任何画布都能删，含内置画布与当前画布） -->
            <AxMenuItem danger @click="pickAction('delete-canvas', close)">删除画布</AxMenuItem>
          </AxMenu>
        </template>
      </AxDropdown>
    </span>
  </div>
</template>

<style scoped>
/* 全部走主题变量：亮色下 logo 用深墨色，暗色下用浅色，避免"浅底浅图标"看不清 */
.project-cluster { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0; border: 1px solid var(--ui-line); border-radius: 8px; background: var(--ui-panel); }
/* 只借「鼠标点锚点」能力的空壳（没有触发器），不占胶囊里的位置 */
.canvas-action-host { display: none; }
.logo-button { width: 57px; height: 32px; display: flex; align-items: center; justify-content: center; gap: 3px; padding: 0 8px; color: var(--ui-ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.logo-chevron { color: var(--ui-ink-dim); }
.project-name { width: 86px; height: 22px; padding: 0 4px; color: inherit; border: 0; border-bottom: 1px dashed transparent; outline: 0; background: transparent; font-family: inherit; font-size: 13px; }
.project-name:hover { border-bottom-color: var(--ui-line); }
.divider { width: 1px; height: 21px; margin: 0; background: var(--ui-line); }
.canvas-chip { height: 32px; display: flex; align-items: center; gap: 4px; padding: 0 8px; color: inherit; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 13px; }
.logo-button:hover, .canvas-chip:hover { background: var(--ui-hover); }
.canvas-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 8px; font-size: 12px; }
.canvas-new { width: 22px; height: 22px; display: grid; place-items: center; color: var(--ui-ink); border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.canvas-new:hover { background: var(--ui-hover); }
/* ===== 画布列表行 =====
   行 = 主按钮（切画布）+ 行尾按钮（操作菜单）。两者都要是 32px 的可点目标（ui-style-guide §5 第 4 条）。 */
.canvas-row { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
/* 底必须打在**行**上，不能打在行里的按钮上（用户口径 2026-10-09：
   「hover 的是整块的一个背景」）。打在按钮上只会染主按钮那半块 ——
   行尾「⋯」与两者之间的留白就成了没底的缺口，看着像「只有左侧有背景」。
   选中行（与「勾」一起表达「当前就是这张」）与 hover 行都给整行一块底。 */
.canvas-row.is-active { background: var(--ui-hover-soft, var(--ui-hover)); }
.canvas-row:hover { background: var(--ui-hover); }
.canvas-row-main { display: flex; flex: 1; min-width: 0; align-items: center; height: 32px; padding: 0 8px; color: var(--ui-ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-family: inherit; font-size: 12px; text-align: left; }
.canvas-row-main:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: -1px; }
.canvas-open { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 行尾：默认 32×32 占位（行内不跳动的锚），勾/三个点叠在同一格里换显 */
.canvas-row-more { position: relative; display: grid; flex: none; place-items: center; width: 32px; height: 32px; padding: 0; color: var(--ui-ink-dim); border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
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
