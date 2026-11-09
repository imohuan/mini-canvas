# 参数说明 ToolParamHint

**一句话**：参数下面那行灰色小字 —— 告诉你这个参数是干什么的。
登记在 `ui` 目录名 `toolParamHint`。

源码：`packages/plugins/plugin-theme-components/src/components/ui/ToolParamHint.vue`。

## 用在哪

通常**不用直接拿它** —— 参数写好 `description` 后，
[参数控件 ToolParamField](/plugins/theme-components/tool-param-field) 会自己放好位置：

- 下拉：展开后的选项列表顶部（钉住，不随选项滚走）；
- 按钮网格 / 比例网格 / 滑块：标题下面；
- 文本 / 数字 / 开关：控件下面。

只有一种情况需要自己用：你在写面板，想在别的地方补一段参数说明。

## 版式

| 项 | 值 |
| --- | --- |
| 字号 | 12px（中文正文的下限） |
| 字重 | 400 |
| 颜色 | `--ui-ink-mute` |
| 行高 | 18px |
| 折行 | 允许，`word-break: break-word` |

## Props

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `text` | `string?` | `''` | 说明文字；空串或纯空格时**整行不渲染** |

## 使用方式与示例

```vue
<script setup lang="ts">
import { useUiComponent } from '@mini-canvas/canvas-render'
const ToolParamHint = useUiComponent('toolParamHint')
</script>

<template>
  <ToolParamHint text="同一个种子 + 同一段提示词，出来的画面基本一样。" />
</template>
```

## 注意事项

- 空串不会渲染成空行（占位拉低排版就白占了高度）。
- 别用它画标题或按钮文字：它专门是「说明」这一档，字号固定在 12px。
