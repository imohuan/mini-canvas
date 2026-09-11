<script setup lang="ts">
/**
 * ConnectionMenuNode —— 临时菜单节点的**专属外壳**（本插件自带，注册到 `nodeShell:connection-menu`）。
 *
 * 为什么自带外壳而不是复用主题的默认壳：
 * 这张卡不是"标题 + 内容"那种通用节点，它整体就是一张菜单 —— 没有标题条、不需要卡片底色/边框
 * （菜单自己画）、端口只留落线那一侧、还要反缩放保持屏幕尺寸恒定。
 * 让主题默认壳为它开一堆特判，等于把菜单插件的私有概念泄漏进主题层；
 * 由菜单插件自己画，主题层保持通用、零特判（渲染层按 `nodeShell:<type>` 解析）。
 *
 * 位置/尺寸/缩放由画布负责（它是真节点）；这里只负责"长什么样"。
 */
import { computed } from 'vue'
import { Handle, Position, useVueFlow, useCanvasRender } from '@mini-canvas/canvas-render'
import type { NodeProps } from '@mini-canvas/canvas-render'
import ConnectionMenuContent from './ConnectionMenuContent.vue'
import { CARD_WIDTH, CARD_BORDER, CARD_PADDING_Y, ITEM_HEIGHT } from './connectionMenu'
import { inverseScaleForZoom, inverseScaleOrigin, normalizePortSide } from './cardInverseScale'

const props = defineProps<NodeProps>()
// 透传的 selected 等 VueFlow 内部 prop 不落到根元素
defineOptions({ inheritAttrs: false })

const vf = useVueFlow()
const { ctx } = useCanvasRender()

/** 当前画布缩放（反缩放依据） */
const zoom = computed(() => Math.max(vf.viewport.value?.zoom || 1, 0.01))

/** 落线那一侧（插件建节点时写入 data.portSide）：从输出口拖出 → 新节点用输入口(左) */
const portSide = computed(() => normalizePortSide((props.data as { portSide?: unknown })?.portSide))

/** 菜单项数 → 卡片高度（与建节点时声明的 size 同源，保证端口锚点精确） */
const itemCount = computed(() => {
  const items = (props.data as { items?: unknown[] })?.items
  return Array.isArray(items) ? items.length : 1
})
const cardWidth = CARD_WIDTH
const cardHeight = computed(() => CARD_PADDING_Y + 2 * CARD_BORDER + Math.max(itemCount.value, 1) * ITEM_HEIGHT)

/**
 * 卡片行内样式：反缩放（屏幕尺寸恒定）+ 钉住端口那条边的竖直中点。
 *
 * 边框用**裸 px**：卡片自身 scale(1/zoom)、外层画布又 scale(zoom)，两者相乘 = 1，
 * 卡片内 1 个本地 px 就是 1 个屏幕 px。
 */
const cardStyle = computed<Record<string, string>>(() => ({
  width: `${cardWidth}px`,
  height: `${cardHeight.value}px`,
  transform: `scale(${inverseScaleForZoom(zoom.value)})`,
  transformOrigin: inverseScaleOrigin(portSide.value),
}))

/** 选中环宽度也走裸 px（同上：卡内 1px = 屏幕 1px） */
const selected = computed(() => Boolean(props.selected))
</script>

<template>
  <div class="conn-menu-node" :class="{ 'is-selected': selected }" :style="cardStyle">
    <!-- 输入口(target)：端口在左时才渲染；始终可见（它就是"松手点 = 端口位置"的可视锚点） -->
    <Handle
      v-if="portSide === 'left'"
      id="target"
      type="target"
      :position="Position.Left"
      class="conn-menu-handle conn-menu-handle--left"
    >
      <span class="conn-menu-port-dot" />
    </Handle>

    <!-- 菜单卡片本体（外观对齐右键菜单 ContextMenu.vue） -->
    <ConnectionMenuContent :id="props.id" :data="props.data as any" />

    <!-- 输出口(source)：端口在右时才渲染（从输入口反向拖出的场景） -->
    <Handle
      v-if="portSide === 'right'"
      id="source"
      type="source"
      :position="Position.Right"
      class="conn-menu-handle conn-menu-handle--right"
    >
      <span class="conn-menu-port-dot" />
    </Handle>
  </div>
</template>

<style scoped>
/* 根：菜单卡的定位盒（尺寸由 inline style 给，反缩放也在那里） */
.conn-menu-node {
  position: relative;
  box-sizing: border-box;
}

/* 选中环：与普通节点同款观感（裸 px —— 卡内 1px 就是屏幕 1px） */
.conn-menu-node.is-selected::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 16px;
  box-shadow: 0 0 0 2px var(--canvas-node-ring-soft, rgb(17 24 39 / 0.38));
  pointer-events: none;
}

/* 端口锚点：**0×0** 的真实 VueFlow Handle，贴卡片竖直中点。
   为什么必须 0×0：VueFlow 算边端点用的是 handle 元素的**左缘**（getHandlePosition 对 Left/Right
   只取 x，不加半宽）。若锚点有宽度，端点就会偏半个宽 —— 连线接不到卡片边缘。
   视觉圆点另用子元素画（见 .conn-menu-port-dot），与锚点解耦。 */
.conn-menu-handle {
  position: absolute !important;
  width: 0;
  height: 0;
  min-width: 0 !important;
  min-height: 0 !important;
  border: 0;
  background: transparent;
  overflow: visible;
  pointer-events: all;
}
.conn-menu-handle--left {
  top: 50% !important;
  left: 0;
  transform: translateY(-50%) !important;
}
.conn-menu-handle--right {
  top: 50% !important;
  right: 0;
  transform: translateY(-50%) !important;
}

/* 端口视觉圆点：圆心精确落在锚点上（translate(-50%,-50%)），不参与命中。 */
.conn-menu-port-dot {
  position: absolute;
  left: 0;
  top: 0;
  width: 10px;
  height: 10px;
  border-radius: 9999px;
  background: var(--canvas-node-panel-surface, #fff);
  border: 1px solid var(--canvas-node-border-subtle, rgb(0 0 0 / 0.12));
  box-shadow: 0 1px 2px var(--canvas-node-shadow-subtle, rgb(0 0 0 / 0.06));
  transform: translate(-50%, -50%);
  pointer-events: none;
}
</style>
