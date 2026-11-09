# 节点加载态 NodeLoadingState

**一句话**：节点卡片、视频画面、状态栏里“正在处理”的那块统一长这样 —— 流光底色 + 超大进度 + 一行阶段文案。登记在 `ui` 目录名 `nodeLoadingState`。

源码：`packages/plugins/plugin-theme-canvas/src/components/node/NodeLoadingState.vue`。

> **它住在哪**：跟着节点壳一起在「画布外观」主题包里。加载 / 失败覆盖层由 `NodeCardShell`
> 直接画，所以图片、视频、文本、可视化所有节点类型都自带加载态，**不依赖底部状态栏插件**。
> 从 `@mini-canvas/plugin-theme-canvas` 的入口导出，视频节点那几处复用的就是同一份实现。

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

## 三档（按画布缩放自动切换）

加载态长在所有节点上，所以它跟着画布缩放分档：缩小以后不该还画一整片大字。
阈值是全局一份：「设置 → 画布 → 节点 → 加载态分档」，图片 / 视频 / 可视化 / 文本节点共用。

| 档位 | 触发条件（默认阈值） | 显示什么 |
| --- | --- | --- |
| 第 1 档 | 缩放不小于 0.6 | 完整：状态词 + 耗时胶囊 + 大百分比 + 阶段文案 + 取消按钮 |
| 第 2 档 | 0.35 到 0.6 之间 | 精简：去掉耗时胶囊，数字小一号，保留状态词与文案 |
| 第 3 档 | 低于 0.35 | 极简：只留中心数字（或旋转光圈），不写状态词、文案与取消按钮 |

两个细节：

- 缩到画布最小缩放时必定进第 3 档（兜底，与配置无关）；
- 第 3 档虽然不画文案，aria-label 仍带着阶段文案，读屏用户照样能听到。

容器特别小时（例如 108px 的小卡片）另有一档「紧凑」只降字号，和上面三档叠加取更省的那个。

## 它跟哪些状态联动（全局三态）

节点卡片只有三种外观状态，所有地方读同一份判定（`canvas-data` 的 `readNodeVisualState`，
数据来自节点的 `data.runState.status`）：

| 状态 | 数据 | 卡上表现 |
| --- | --- | --- |
| 加载中 | `status: 'running'` | 整卡加载覆盖层（流光 + 进度）；**不给 resize 把手**；视频不悬停自动播 |
| 错误 | `status: 'error'` | 整卡失败覆盖层（红色感叹号 + 原因 + 下一步）；同样不给 resize 把手 |
| 加载成功 | `done` / `idle` / 没有 `runState` | 正常显示内容、resize 把手、悬停播放 |

两条容易踩的行为：

- **拖拽改尺寸时加载态不消失**。壳在 resize 期间会收起编辑类浮层，但放行声明了
  `props.keepOnResize` 的覆盖层（任务覆盖层就是这么注册的）——否则一拖尺寸就像任务断了。
- **判据只有一份**。别在插件里另写「status === 'running'」；脏值一律按「加载成功」处理，
  不会因为一个坏字段把整张卡变成加载中或报错。

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `variant` | `'fill' / 'chip'` | `'fill'` | 盖满容器，还是一行小胶囊 |
| `tone` | `'loading' / 'error'` | `'loading'` | 失败态换配色和内容，版式不变 |
| `surface` | `'card' / 'media'` | `'card'` | 跟随亮暗主题，还是恒深色（视频画面里用） |
| `label` | `string` | `''` | 左上角状态词；不填按 `tone` 给「生成中」/「执行失败」 |
| `percent` | `number / null` | `null` | 0-100；给 `null` 显示旋转的 SVG 图标，不编假数字 |
| `message` | `string` | `''` | 下方那行阶段文案 |
| `hint` | `string` | `''` | 只有失败态用：下一行小字，说明接下来能做什么 |
| `startedAt` | `number` | `0` | 计时起点（ms）。给了才显示右上角已耗时 |

## Slots / 插槽

| 插槽 | 说明 |
| --- | --- |
| `#action` | 右下角操作位（节点壳在里面放「取消」按钮）。只有这里的元素接收指针 |

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

    <!-- 加载时整块盖住；不给 percent 就是不确定态（一个旋转的 SVG 图标） -->
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
7. **别在插件里自己判缩放分档**。直接用这只件，它跟着全局阈值走；自己判会和设置面板对不上。

## 真实插件参照

- 节点壳自绘加载覆盖层：`packages/plugins/plugin-theme-canvas/src/components/node/base-node/NodeCardShell.vue`
- 视频帧图加载：`packages/plugins/plugin-node-video/src/VideoContent.vue`
- 全屏视频加载：`packages/plugins/plugin-node-video/src/VideoPreview.vue`
- 裁剪/剪辑处理中：`packages/plugins/plugin-node-video/src/VideoTopToolbar.vue`、`video-clip-panel/VideoClipDock.vue`
