<script setup lang="ts">
/**
 * GroupTopToolbar —— 分组节点「上控制栏」里的操作：解组 + 背景颜色。
 *
 * 用户要求："这边的操作都是显示在这个上下控制栏里面，你可以参考节点中上下这个控制栏是如何实现的，
 * 它是悬浮在节点外的"；"这边分组还支持选择这里的背景颜色，放在它的上浮控制栏中"。
 *
 * 为什么从内容区（GroupContent 右上角那个小图标）搬到这里：
 * - 位置语义统一 —— 节点上的操作一律走 out:top / out:bottom，不再是"内容组件里自己绝对定位一个角"；
 * - 显隐统一 —— 壳（BaseNode）按"框选中/多选收起"统一压掉这一层，不必每个组件各判一遍；
 * - 定位统一 —— 贴边距离/居中/反缩放由壳给，本组件只放内容。
 *
 * 与图片节点的 ImageTopToolbar 逐字同形：**定位不在这里**，选中态也不在这里。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { GROUP_COLOR_SWATCHES, resolveGroupBackgroundColor } from './groupEngine'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
/**
 * 显隐门：**恰好单独选中我**时才出现（与图片/文本节点的上控制栏同一判据）。
 *
 * 为什么必须自己判：壳（BaseNode）只做"压制"（框选中/多选时收起），它**不负责显示** ——
 * 见 BaseNode 的注释"单选时的显隐仍由各段组件自己的 useSoleNodeSelected 决定"。
 * 少了这一句，未选中或选中别人时这条栏也会一直挂在那儿（用户实测报的就是这个）。
 */
const visible = useSoleNodeSelected(props.id)
/** 设计系统件按名取（§4.5 目录）：换主题时这里一行不改 */
const ThemedButton = useUiComponent('button')
const ThemedDropdown = useUiComponent('dropdown')

/** 解组图标（与 GroupContent 里那枚同源写法：内联 SVG 字符串） */
const ICON_UNGROUP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8h8v8H8z"/><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/></svg>'

/**
 * 解组：调 group 服务（唯一写入口在服务里 —— 它自己包历史、还原子节点绝对坐标）。
 * 只读服务名，不 import 任何 group 内部实现，保持"UI 与逻辑同包但职责分开"。
 */
function onUngroup(): void {
  ctx.get<{ ungroup(groupId: string): void } | undefined>('group')?.ungroup(props.id)
}

// ====== 背景颜色 ======
/** 当前底色（没设过 = 默认石板灰），触发器上的色点画它 */
const currentColor = computed(() => resolveGroupBackgroundColor(props.data?.backgroundColor))

/** 色板浮层开合 */
const colorOpen = ref(false)

/**
 * 落色：色值只来自那张**封闭的预设表**（GROUP_COLOR_SWATCHES），所以不需要额外校验 ——
 * 表里没有"用户手输的字符串"这条路径。写走 doc.updateNodeData（唯一图写入口 → 自动进历史 + 落盘），
 * 与 GroupContent 读的是同一个字段。
 */
function pickColor(color: string): void {
  ctx.get<{ updateNodeData(id: string, data: Record<string, unknown>): void } | undefined>('doc')
    ?.updateNodeData(props.id, { ...props.data, backgroundColor: color })
}

</script>

<template>
  <div v-if="visible" class="group-top-toolbar">
    <!-- 背景颜色：色点触发器 + 下拉的预设色板（只有预制色，不做自定义取色） -->
    <component
      :is="ThemedDropdown"
      v-model="colorOpen"
      placement="bottom-start"
      :offset="8"
      menu-width="112px"
      menu-role="listbox"
      body-class="group-color-menu-body"
      :teleport="true"
    >
      <template #trigger>
        <button
          class="group-color-trigger"
          type="button"
          title="背景颜色"
          aria-label="背景颜色"
          aria-haspopup="listbox"
          :aria-expanded="colorOpen"
        >
          <span class="group-color-trigger__dot" :style="{ backgroundColor: currentColor }" aria-hidden="true" />
        </button>
      </template>
      <template #default="{ close }">
        <div class="group-color-grid" role="listbox" aria-label="分组背景颜色" @click.stop>
          <button
            v-for="swatch in GROUP_COLOR_SWATCHES"
            :key="swatch.id"
            class="group-color-swatch"
            :class="{ 'is-active': swatch.color === currentColor }"
            type="button"
            role="option"
            :aria-selected="swatch.color === currentColor ? 'true' : 'false'"
            :title="swatch.label"
            :aria-label="swatch.label"
            :style="{ backgroundColor: swatch.color }"
            @click.stop="pickColor(swatch.color); close()"
          />
        </div>
      </template>
    </component>

    <component
      :is="ThemedButton || 'button'"
      class="group-top-toolbar__btn"
      type="button"
      title="解散分组"
      aria-label="解散分组"
      :icon="ICON_UNGROUP"
      variant="danger"
      @click="onUngroup"
    >
      解散分组
    </component>
  </div>
</template>

<style scoped>
/* 只管"排一行 + 一个小面板"；位置（贴边/居中/反缩放）由壳的上插槽定位层给。
   配色走通用 UI token + --ntb-*（<html class="dark"> 切换），不再写死白底 ——
   控制栏浮在画布背景上而不是卡片里，暗色主题下必须是深底。 */
.group-top-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--ui-overlay-solid, #ffffff);
  border: 1px solid var(--ui-line, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  box-shadow: var(--ui-shadow-md, 0 20px 40px rgba(0, 0, 0, 0.08));
  white-space: nowrap;
}

/* 色点触发器：与外层按钮同高（32px），保持整排对齐 */
.group-color-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--ntb-fill, rgba(0, 0, 0, 0.04));
  cursor: pointer;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.group-color-trigger:hover {
  background: var(--ntb-fill-hover, rgba(0, 0, 0, 0.06));
}
.group-color-trigger:focus-visible {
  outline: 2px solid var(--ntb-accent-ring, rgba(8, 145, 178, 0.6));
  outline-offset: 1px;
}
.group-color-trigger__dot {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 999px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.42),
    0 0 0 1px rgba(15, 23, 42, 0.28);
}

/* 色板：7 个预设色（4 列两行） */
.group-color-grid {
  display: grid;
  grid-template-columns: repeat(4, 22px);
  gap: 6px;
  padding: 8px;
}
.group-color-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.38),
    0 0 0 1px rgba(15, 23, 42, 0.22);
  transition: transform 120ms ease;
}
.group-color-swatch:hover {
  transform: scale(1.08);
}
.group-color-swatch:focus-visible {
  outline: 2px solid var(--ntb-accent-ring, rgba(8, 145, 178, 0.6));
  outline-offset: 1px;
}
/* 当前色：加一圈环，一眼看出"现在用的是哪个" */
.group-color-swatch.is-active {
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.42),
    0 0 0 2px rgba(8, 145, 178, 0.85);
}

@media (prefers-reduced-motion: reduce) {
  .group-color-trigger,
  .group-color-swatch {
    transition: none;
  }
}
</style>
