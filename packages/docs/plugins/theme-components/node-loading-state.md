# 节点加载态 NodeLoadingState

**一句话**：节点卡片、视频画面、状态栏里“正在处理”的那块统一长这样 —— 流光底色 + 超大进度 + 一行阶段文案。登记在 `ui` 目录名 `nodeLoadingState`。

源码：`packages/plugins/plugin-theme-components/src/components/ui/NodeLoadingState.vue`。

## 这个组件能做到什么

装上默认主题后，凡是走这套加载态的地方都长得一样：

- 节点卡片做任务时：整卡盖住，中间一个大百分比，右上角显示已经跑了多久；
- 视频帧图还没抓好、全屏视频还没解码出第一帧：同一套流光，只是底色换成视频的深色；
- 视频顶栏/底栏正在后台裁剪或剪辑：用它的紧凑形态，一行小胶囊，不挡住画面。

亮色、暗色各一套配色，跟随 `<html class="dark">` 自动切换。

## 两个形态

| `variant` | 用在哪 | 长什么样 |
| --- | --- | --- |
| `fill`（默认） | 节点内容区、预览舞台 | 盖满最近的定位容器：底色 + 3 个光斑 + 百分比 + 文案 |
| `chip` | 上下状态栏、按钮旁 | 一行 28px 小胶囊：状态点 + 状态词 + 文案 + 百分比 |

`surface="media"` 把底色固定成视频的深色，避免加载的一瞬间白闪。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `variant` | `'fill' / 'chip'` | `'fill'` | 盖满容器，还是一行小胶囊 |
| `tone` | `'loading' / 'error'` | `'loading'` | 失败态换配色和内容，版式不变 |
| `surface` | `'card' / 'media'` | `'card'` | 跟随亮暗主题，还是恒深色（视频画面里用） |
| `label` | `string` | `''` | 左上角状态词；不填按 `tone` 给「生成中」/「执行失败」 |
| `percent` | `number / null` | `null` | 0-100；给 `null` 显示 `···`，不编假数字 |
| `message` | `string` | `''` | 下方那行阶段文案 |
| `hint` | `string` | `''` | 只有失败态用：下一行小字，说明接下来能做什么 |
| `startedAt` | `number` | `0` | 计时起点（ms）。给了才显示右上角已耗时 |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| `#action` | 右下角操作位（例如任务覆盖层的「取消」按钮）。只有这里的元素接收指针 |

## 事件、方法或暴露能力

没有事件，也没有 `defineExpose`。它是纯展示件。

## 使用方式与示例

### 节点内容里盖一层

```vue
<!-- 文件：packages/my-plugin/src/MyContent.vue -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'

const NodeLoadingState = useUiComponent('nodeLoadingState')
const loading = ref(false)
const percent = ref(0)
</script>

<template>
  <div class="my-content">
    <!-- 你的真实内容 -->
    <img v-if="!loading" :src="src" />

    <!-- 加载时整块盖住；不给 percent 就是不确定态（···） -->
    <NodeLoadingState
      v-if="loading"
      :percent="percent"
      message="加载预览…"
    />
  </div>
</template>
```

外壳需要一个定位父元素（`position: relative`），组件自己是 `position: absolute; inset: 0`。

### 状态栏里表示「这一格在处理」

```vue
<NodeLoadingState v-if="pending" variant="chip" label="裁剪中" message="正在处理…" />
<Button v-else @click="confirm">确认</Button>
```

### 失败态 + 下一步

```vue
<NodeLoadingState
  tone="error"
  message="ffmpeg 退出码 1"
  hint="可再点一次发送重试"
/>
```

## 注意事项

1. **不要自己再画转圈**。加载中统一用这只件；只有“这一格正在处理”才用 `chip`。
2. **根不接指针**。加载期间节点要能拖、能选；可点的东西只有 `#action` 插槽里的按钮。
3. **圆角跟随卡片**。`fill` 会读最近 `.v2-card` 的实算圆角；找不到卡片（预览舞台）就用 0。
4. **小容器自动收紧**。容器窄于 240px 或矮于 150px 时字号降一档，108px 的小卡片也不会把文案挤没。
5. **视频里记得 `surface="media"`**。否则亮色主题下会先闪一块白。
6. **`prefers-reduced-motion` 下停动画**，只留文案与数字。

## 真实插件参照

- 任务进度覆盖层：`packages/plugins/plugin-bottom-bar/src/NodeTaskOverlay.vue`
- 视频帧图加载：`packages/plugins/plugin-node-video/src/VideoContent.vue`
- 全屏视频加载：`packages/plugins/plugin-node-video/src/VideoPreview.vue`
- 裁剪/剪辑处理中：`packages/plugins/plugin-node-video/src/VideoTopToolbar.vue`、`video-clip-panel/VideoClipDock.vue`
