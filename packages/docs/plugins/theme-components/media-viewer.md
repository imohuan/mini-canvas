# 全屏媒体预览 MediaViewer

**一句话**：点开素材后铺满整屏的预览器 —— 图片能缩放/拖拽/旋转/翻转，视频/音频/文本走各自的预览件，
左右键翻页、Esc 关闭。登记在 `ui` 目录名 `mediaViewer`。

源码：`packages/plugins/plugin-theme-default/src/components/ui/MediaViewer.vue`。
交互照 ax-ui-kit 的 AxImageViewer 复刻；底栏插件的素材预览浮层与成品应用的生成历史/资产面板都用它。

## 功能说明

## 活演示

<script setup>
import ThemeKitDemo from '../../.vitepress/theme/demos/ThemeKitDemo.vue'
</script>

<ThemeKitDemo name="mediaViewer" />

> 点"点开全屏预览"：铺满整屏，Esc 关闭。

- **四种内置类型**：`image` / `video` / `audio` / `text`（`kind` 决定用哪个渲染器）。
- **中文别名自动归一**：`'图片'` / `'视频'` / `'音频'` / `'文本'` 会自动映射成上面的英文 kind，接入方不必自己换算。
- **图片变换**：滚轮缩放、拖拽平移、`R` 旋转、`F` 翻转、`0` 重置；底部浮动控制条显示页码与缩放百分比。
- **翻页**：宿主给了 `list` 就出现"上一张/下一张"与页码，`左键` / `右键` 也能切。
- **键盘**：`Esc` 关闭、`左右键` 切换、`+` / `-` 缩放、`0` 重置、`R` 旋转、`F` 翻转。
- **优先用节点插件的预览注册件**：`audioPreview` / `videoPreview` / `textPreview` 登记了就用它们（波形播放器、自绘控件、文本排版），没登记才回落原生标签。
- **删除按钮**：宿主给了 `onDelete` 才出现（悬停显示）；删除动作由宿主定（底栏=断开连线，资产面板=调后台接口）。
- **打开时锁 body 滚动**、关闭恢复；浮层是 `role="dialog"` 加 `aria-modal="true"`。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `item` | `MediaViewerItem \| null` | `null` | 当前预览的媒体；null 表示不渲染 |
| `onDelete` | `(item) => void` | `undefined` | 给了才出现右上角删除按钮 |
| `previewComponents` | `Record<string, unknown> \| null` | `null` | 宿主自备的预览注册件（画布树外渲染时用）；键 `audioPreview` / `videoPreview` / `textPreview` |

`MediaViewerItem` 形状：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string?` | 标题（左上角悬浮显示；空则不显示） |
| `kind` | `'image' / 'video' / 'audio' / 'text' / string` | 媒体种类（也吃中文别名） |
| `url` | `string?` | 图片/视频/音频地址 |
| `text` | `string?` | 文本内容（`kind: 'text'` 用） |
| `list` | `string[]?` | 同组媒体地址；给了才出翻页与页码 |
| `index` | `number?` | 当前张在 `list` 里的下标（缺省 0） |

## Slots / 插槽

| 插槽 | 收到的 props | 说明 |
| --- | --- | --- |
| `stage` | `{ item }` | **兜底舞台**：`kind` 不是内置四种时渲染它，让你自己画（新资源类型的扩展口） |

## 事件、方法或暴露能力

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `close` | 无 | 请求关闭（Esc / 点背景 / 点关闭钮都会发） |
| `remove` | `MediaViewerItem` | 点了删除按钮 |
| `index` | `number` | 当前看的是 `list` 里的第几张（宿主传了 `list` 才有意义；删除要按它算） |

没有 `defineExpose`。

## 使用方式与示例

```vue
<!-- 文件：packages/my-plugin/src/MyGallery.vue -->
<!-- 格式：Vue 单文件组件（script setup lang="ts"） -->
<!-- 位置：插件里的素材列表 —— 点一张开全屏预览 -->
<script setup lang="ts">
import { ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'

const MediaViewer = useUiComponent('mediaViewer')

const urls = ['/a.png', '/b.png', '/c.png']
const index = ref<number | null>(null)

// item 的形状：kind 决定用哪个渲染器；list 给了就出翻页；index 是起始张
function itemOf(i: number) {
  return { name: '第 ' + (i + 1) + ' 张', kind: 'image', url: urls[i], list: urls, index: i }
}
</script>

<template>
  <div>
    <button v-for="(u, i) in urls" :key="u" type="button" @click="index = i">看第 {{ i + 1 }} 张</button>

    <!-- 预览器自己 Teleport 到 body 全屏，放在列表旁边即可 -->
    <MediaViewer
      :item="index === null ? null : itemOf(index)"
      :on-delete="(it) => console.log('删除', it.url)"
      @close="index = null"
      @index="(i) => (index = i)"
    />
  </div>
</template>
```

## 注意事项

1. **画布树外要自己传 `previewComponents`**：树外取不到 `provide`，`useUiComponent` 会抛错；宿主从自己的 ctx 里把三个预览件读出来传进去（成品应用就是这么做的）。
2. **`onDelete` 只是"给不给按钮"**：组件**不猜**删除语义，具体删什么由宿主决定。
3. **变换工具只对图片生效**：视频/音频交给插件预览件或原生播放器，底部控制条上的缩放钮不会出现。
4. **翻页依赖宿主传 `list`**：只传单条 `item` 就没有页码，也不会出现左右翻页。
5. **打开时会锁 body 滚动**：关闭时若宿主没等它销毁就直接跳转，记得自己恢复（组件在 `onBeforeUnmount` 里兜底了）。
