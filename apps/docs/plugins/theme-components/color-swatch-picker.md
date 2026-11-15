# 取色面板 ColorSwatchPicker

**一句话**：一个「预置色 + 自定义取色」的完整颜色面板，点开就能选。
登记在 `ui` 目录名 `colorSwatchPicker`。

源码：`packages/plugins/plugin-theme-components/src/components/ui/ColorSwatchPicker.vue`。
预置色表：同目录的 `colorSwatchPresets.ts`。

## 功能说明

面板分两块：

- **预置颜色**：十个常用色，点一下立刻生效。
- **自定义**：展开主题的取色器（带色相、透明度、棋盘格），能调任意颜色。

图片节点的「绘制」标记色、分组节点的「背景颜色」用的都是这一个件 ——
改一次，两处同时变。

## 活演示

因为面板依赖画布里的 `ui` 目录，演示放在真实画布里最准：

1. 选中一个图片节点，点顶栏「绘制」，再点颜色圆点。
2. 选中一个分组节点（两个节点选中后按 `Ctrl+G` 创建），点顶栏「背景颜色」。

两个面板应该一模一样。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string` | 必填 | 当前颜色（`#rrggbb` 或 `#rrggbbaa`） |
| `label` | `string` | `'选择颜色'` | 触发器标题与无障碍名 |
| `trigger` | `'icon' \| 'label'` | `'icon'` | 触发器形态：只画色块 / 小圆点 + 文字 |
| `closeOnPick` | `boolean` | `false` | 点预置色后是否收起面板 |

## Slots / 插槽

**没有插槽。**

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `update:modelValue` | `string` | 颜色变化（配 `v-model`） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyColorToolbar.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useCanvasRender, useUiComponent } from '@plume-canvas/canvas-render'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const ColorSwatchPicker = useUiComponent('colorSwatchPicker')

const color = computed(() => String(props.data?.fill ?? '#334155'))

function pick(value: string): void {
  ctx.get('doc')?.updateNodeData(props.id, { ...props.data, fill: value })
}
</script>

<template>
  <ColorSwatchPicker
    v-if="ColorSwatchPicker"
    :model-value="color"
    label="填充颜色"
    trigger="label"
    close-on-pick
    @update:model-value="pick"
  />
</template>
```

## 注意事项

1. **面板来自 ui 目录**：用之前判空（`v-if`），别假设主题一定登记了它。
2. **颜色可能是 8 位**：用户调了透明度才有 alpha，消费方别假设固定长度。
3. **预置色表是共用的**：要加颜色改 `colorSwatchPresets.ts`，不要在各插件里各抄一张。
4. **同屏只开一个浮层**：面板走 `Popover`，互斥由组件库统一处理，调用点不用再写。

## 真实插件参照

- 绘制标记色：`packages/plugins/plugin-node-image/src/PaintColorPicker.vue`
- 分组背景色：`packages/plugins/plugin-group/src/GroupTopToolbar.vue`
