# 节点类型 `ui`

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：注册一种节点类型 `ui` —— 一块面板，里面渲染 Agent 写进来的 HTML。

## 注册处

```ts
ctx.nodes.register({ type: 'ui', /* ... */ })
```

## 字段逐条

| 字段 | 值 |
| --- | --- |
| `type` | `'ui'`（`UI_NODE_TYPE`） |
| `label` | `'可视化'` |
| `nameTemplate` | `'可视化 {{ID}}'` |
| `description` | `'一块画布：内容由 Agent 生成（HTML 就地渲染）'` |
| `icon` | 内联 SVG 字符串（面板图标） |
| `size` | @@BT@{ w: 420, h: 320 }` |
| `resizable` | `true` |
| `inputs` | `[{ port: 'target', acceptsTypes: ['text', 'image', 'video', 'audio'] }]` —— 收一切素材当数据源 |
| `outputs` | `[{ port: 'source', contentType: 'image' }]` —— 可把画面导成图给下游 |
| `in` | `UiContent.vue`（把 `data.uiHtml` 渲染出来） |
| `create(position, extra)` | 委托 `UiNodeService_.addNode(position, extra)`（**extra 必须带上**） |

## 活演示

本插件是自带件，成品应用里就有它。下面这块真画布装了默认主题 + 图片 / 文本节点，
可以直接看到"节点壳 + 端口 + 连线"长什么样（可视化节点本身需要 Agent 生成内容才有画面）：

<script setup>
import MiniCanvasStage from '../../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="320" />

## 注意事项

1. **边框保留**（与图片/视频节点同口径）：空的可视化节点是一块白面板，没有边框就与画布背景分不出来。边框由共享外壳 `BaseNode` 画，本插件不自己画框。
2. **输出口是"类型级"声明**：2026-10-13 用户实测需求，从 `outputs: []` 改成声明图片输出 —— 改 HTML **改不出**这个口，必须改这里。
3. **输入口不声明 `capacity` = 不限条数**：文本/图片/视频/音频都能连进来。

