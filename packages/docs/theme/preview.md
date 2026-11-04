# 往主题工作台加自己的颜色和预览

**一句话定位**：插件声明 `type: 'color'`，颜色自动出现在「外观 → 主题工作台」；
再往 `theme-preview` 槽注册一个组件，画布上就会多出你这个插件自己的效果。

**它解决什么**：主题页只负责收颜色、给一块画板。节点长什么样、连线怎么走、
选框和刀光画在哪，由**每个插件自己**决定。插件没装，它的颜色和预览就都不存在。

## 这个案例能做到什么

装上你的插件后，主题工作台会多出两样东西：

1. 颜色清单里多出你声明的色块（40 × 40 正方形，亮色 / 暗色各一格）；
2. 上方实时画布里多出你画的那一层。改颜色，它跟着变。

卸载插件后两样一起消失。主题页不需要改一行代码。

## 第一步：声明颜色

颜色还是写在你插件的 `Config` 里，跟别的配置项一样：

```ts
// 文件：my-plugin/src/config.ts
import type { ConfigSchema } from '@mini-canvas/canvas-base'

export const Config = {
  myOutlineColorLight: {
    type: 'color',
    default: '#0891b2',
    label: '描边颜色',
    group: '外观/主题配色',
  },
  myOutlineColorDark: {
    type: 'color',
    default: '#22d3ee',
    label: '描边颜色',
    group: '外观/暗色主题配色',
  },
} satisfies ConfigSchema
```

`group` 必须以 `外观/` 开头，主题工作台才会收集它。亮色一格、暗色一格，
两格用同一个前缀（这里是 `myOutlineColor`），工作台会把它们合成一个色块。

默认值可以留空串（`optional: true`），表示「没配置就跟主题强调色」。

## 第二步：画自己的预览层

预览层就是一个普通 Vue 组件。拿到的坐标、模式、颜色读取器都来自公共场景：

```vue
<!-- 文件：my-plugin/src/ThemePreviewOutline.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useThemePreviewPluginColor, useThemePreviewScene } from '@mini-canvas/canvas-render'

const scene = useThemePreviewScene()
// 读自己申报的两格制颜色；空值自动回落主题强调色
const outline = useThemePreviewPluginColor('myOutlineColor', '#0891b2')

const a = scene.nodes[0]

onMounted(() =>
  scene.registerBounds('my-plugin/outline', {
    x: a.x - 8, y: a.y - 8, w: a.w + 16, h: a.h + 16,
  }),
)
onBeforeUnmount(() => scene.unregisterBounds('my-plugin/outline'))
</script>

<template>
  <div class="my-outline" :style="{ left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px', borderColor: outline }"></div>
</template>

<style scoped>
.my-outline {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 10px;
  pointer-events: none;
}
</style>
```

场景里有这几样东西：

| 拿什么 | 含义 |
| --- | --- |
| `scene.nodes` | 两个默认节点的矩形（`preview-a` / `preview-b`） |
| `scene.mode` | 当前预览是亮色还是暗色 |
| `scene.settings` | 真实 settings 读取器（独立页/单测里可能是 `null`） |
| `scene.revision` | 配置每改一次 +1；读颜色的计算属性跟它走 |
| `scene.registerBounds` | 上报你占的矩形，工作台据此自动取景 |

坐标单位是 px，原点在画板左上角。画板默认 720 × 400。

## 第三步：注册到预览槽

在 `apply` 里挂上去，跟 `overlay` 槽同一个写法：

```ts
// 文件：my-plugin/src/index.ts
import { THEME_PREVIEW_SLOT } from '@mini-canvas/canvas-render'
import ThemePreviewOutline from './ThemePreviewOutline.vue'

export function apply(ctx: Context) {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'my-plugin/preview',
    order: 150,           // 小者先画（在下面），大者后画（盖在上面）
    component: ThemePreviewOutline,
    meta: { title: '我的描边' },
  })
}
```

插件卸载时槽里的条目随作用域自动回收，不用自己写清理。

## 已经这么做的插件

| 插件 | 注册文件 | 画什么 |
| --- | --- | --- |
| `theme-components` | `src/themePreview.ts` | 两个节点、一条连线、工具条、状态色 |
| `plugin-multi-select` | `src/themePreview.ts` | 多选框（内外双框） |
| `plugin-align-guide` | `src/themePreview.ts` | 对齐参考线 |
| `plugin-edge-cutting` | `src/themePreview.ts` | 切割轨迹与刀锋 |

它们都只在 `apply` 里加了一行注册，主题页 (`ThemeStudio.vue`) 完全不认识这些插件。

## 注意事项

- 颜色字段的 `group` 必须是 `外观/主题配色` 或 `外观/暗色主题配色`，别的分组不会被收进色板。
- 两层都别写死颜色：声明过的颜色走 `useThemePreviewPluginColor`，宿主色板走 `useThemePreviewColor`。
- 图层根元素要 `pointer-events: none`，预览只用来观察，不该抢鼠标。
- 记得 `registerBounds`，否则内容超出画板时不会被自动缩放进来。
- 预览层里不要读真实画布的 `ctx.get('doc')`：工作台没有那张图，只用 `scene.nodes` 的坐标。
