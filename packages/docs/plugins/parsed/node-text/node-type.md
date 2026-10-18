# 节点类型 `text`

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：往画布注册一种节点类型 `text` —— 数据（尺寸 / 端口）与展示（内容组件）一次性给全。

## 注册处

```ts
ctx.nodes.register({ type: 'text', /* ... */ })
```

## 字段逐条

| 字段 | 值 |
| --- | --- |
| `type` | `'text'` |
| `label` | `'文本'` |
| `nameTemplate` | `'文本 {{ID}}'`（`{{ID}}` 是同类递增序号） |
| `description` | `'在画布中添加一个文本节点'` |
| `icon` | 内联 SVG 字符串（T 字图标） |
| `size` | `{ w: 300, h: 200 }` |
| `produces` | `{ text: { kind: 'text', valueField: 'text' } }`（对外产出一段文本） |
| `inputs` | `[{ port: 'target', acceptsTypes: ['text'] }]` |
| `outputs` | `[{ port: 'source', contentType: 'text' }]` |
| `resizable` | `true`（右下拖柄；尺寸写回 `data.cardWidth/Height`） |
| `in` | `TextContent.vue`（内容区组件） |
| `create(position)` | 委托 `TextService.addTextNode`（单一实现） |

## 活演示

节点类型装好之后，画布上就长这样（下面是一块装了本插件的真画布，可拖动、双击编辑）：

<script setup>
import MiniCanvasStage from '../../../.vitepress/theme/demos/MiniCanvasStage.vue'
</script>

<MiniCanvasStage :height="320" />

## 注意事项

1. **文本不是资源，声明的是值字段**：`produces.text.valueField = 'text'` 告诉下游“正文在 `data.text`”。
   其它节点要读它，走 `upstream.text()`，不要直接猜字段名。见 [上游与执行顺序](/canvas-data/upstream)。
2. **`inputs` 不声明 `capacity` = 不限条数**：文本节点可以同时接多个上游素材。
3. **区域内只挂了底部生成栏**（`out:bottom`）：顶部样式条已被用户要求删除（对文本节点没有意义）。
4. **`create` 只收 `position`**：带数据建节点（导入）要靠调用方先建再调 `editText`。
5. **尺寸默认值接了设置面板**：见 [设置项](/plugins/parsed/node-text/config)。

