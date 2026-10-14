# `ui` 目录组件

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：本插件往 `ui` 目录登记了 1 个纯展示件 `textPreview` —— 全屏预览、生成历史卡片都按名取它。

## 登记的组件

| 目录名 | 组件 | props | 谁在用 |
| --- | --- | --- | --- |
| `textPreview` | `TextPreview.vue` | `text?: string`、`name?: string` | 全屏媒体预览（`MediaViewer`）、生成历史卡片 |

> 为什么是"预览件"而不是节点正文：节点正文（`in` 区域）走节点类型注册（见 [节点类型](/plugins/parsed/node-text/node-type)），
> 不放目录。放进目录的是"希望被主题整体换掉"的展示件。

## 活演示

下面两个都是**真的在跑**的 `TextPreview`（左边有内容、右边空内容）：

<script setup>
import TextPreview from '@mini-canvas/plugin-node-text/TextPreview.vue'
</script>

<div style="display:flex;gap:12px;flex-wrap:wrap;padding:18px;border-radius:12px;border:1px solid var(--vp-c-divider);background:var(--vp-c-bg-soft)">
  <div style="width:260px;height:130px;border-radius:10px;border:1px solid var(--vp-c-divider);background:var(--vp-c-bg);overflow:hidden">
    <TextPreview text="这是 plugin-node-text 登记进 ui 目录的文本预览件：只读展示文本，没有编辑态、不读写节点数据。" name="note.txt" />
  </div>
  <div style="width:260px;height:130px;border-radius:10px;border:1px solid var(--vp-c-divider);background:var(--vp-c-bg);overflow:hidden">
    <TextPreview text="" />
  </div>
</div>

> 左：有内容；右：空内容（显示"（空）"）。两个都只吃 `text` / `name` 两个 props —— 所以任何宿主都能直接用。

## 使用方式与示例

按名取（不依赖本插件包）：

```vue
<!-- 文件：任意插件里的预览面板 -->
<!-- 格式：Vue 单文件组件 -->
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
const TextPreview = useUiComponent('textPreview')
</script>

<template>
  <TextPreview text="随便一段文本" name="note.txt" />
</template>
```

